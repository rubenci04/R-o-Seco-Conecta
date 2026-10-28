import type { CategoryId, PushTopic } from '../shared/categories'
import {
  dedupeKey,
  decideAlertNotification,
  decidePostNotification,
  type Decision,
} from '../shared/notificationPolicy'
import { truncate } from '../shared/text'
import type { PushPayload, PushSender } from './push'

/**
 * Envíos por invocación. Límites del plan gratuito: ≈50 subrequests (cada envío es 1 fetch) y 10 ms de CPU. El cifrado cuesta
 * ≈0,3–0,45 ms por mensaje (medido en Node), así que 12 envíos dejan margen. Con Workers de pago (30 s de CPU) se puede subir a 40.
 */
export const PUSH_BATCH_SIZE = 12
/** Dispositivos que se asignan a un aviso por pasada (una sola consulta). */
export const FANOUT_CHUNK = 200
export const SEND_CONCURRENCY = 5
export const MAX_DELIVERY_ATTEMPTS = 4
/** Un dispositivo se desactiva tras esta cantidad de avisos consecutivos fallidos. */
export const MAX_CONSECUTIVE_PUSH_FAILURES = 5
/** Si una invocación se corta a mitad, el envío reclamado vuelve a estar disponible pasado este tiempo. */
export const CLAIM_SECONDS = 120
/** Esperas entre reintentos (segundos), según el intento que acaba de fallar. */
export const RETRY_DELAYS_SECONDS = [300, 1800, 7200]
export const URGENT_TTL_SECONDS = 3600
export const NORMAL_TTL_SECONDS = 6 * 3600

type Enqueue = { queued: true; id: number } | { queued: false; reason: string }

/** Motivos que pueden resolverse más tarde (p. ej. al aprobar un obituario): no se registra, para no bloquear un reintento. */
const RECOVERABLE = new Set(['no publicada', 'obituario pendiente de revisión', 'alerta sin confirmación editorial', 'alerta aún no vigente'])

const iso = (d: Date) => d.toISOString()
const addSec = (d: Date, s: number) => new Date(d.getTime() + s * 1000)

interface Entry {
  type: 'post' | 'alert' | 'obituary'
  id: number
  topics: PushTopic[]
  urgent: boolean
  title: string
  body: string
  url: string
}

async function insertLog(db: D1Database, now: Date, e: Entry, decision: Decision): Promise<Enqueue> {
  const key = dedupeKey(e.type, e.id)
  if (!decision.send) {
    if (RECOVERABLE.has(decision.reason)) return { queued: false, reason: decision.reason }
    await db
      .prepare(
        `INSERT OR IGNORE INTO notification_log (dedupe_key, entity_type, entity_id, topics_json, urgent, title, body, url, state, suppressed_reason, created_at, finished_at)
         VALUES (?,?,?,?,?,?,?,?, 'suppressed', ?, ?, ?)`,
      )
      .bind(key, e.type, e.id, JSON.stringify(e.topics), e.urgent ? 1 : 0, e.title, e.body, e.url, decision.reason, iso(now), iso(now))
      .run()
    return { queued: false, reason: decision.reason }
  }
  // La clave única impide notificar dos veces lo mismo, aun con ejecuciones concurrentes o reintentos.
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO notification_log (dedupe_key, entity_type, entity_id, topics_json, urgent, title, body, url, state, created_at)
       VALUES (?,?,?,?,?,?,?,?, 'pending', ?)`,
    )
    .bind(key, e.type, e.id, JSON.stringify(decision.topics), e.urgent ? 1 : 0, e.title, e.body, e.url, iso(now))
    .run()
  return r.meta.changes === 1 ? { queued: true, id: Number(r.meta.last_row_id) } : { queued: false, reason: 'ya notificada' }
}

export async function enqueuePostNotification(db: D1Database, postId: number, now: Date, importedThisRun = 1): Promise<Enqueue> {
  const post = await db
    .prepare('SELECT id, title, body, status, published_at, link_only, historical FROM posts WHERE id = ?')
    .bind(postId)
    .first<{ id: number; title: string; body: string; status: 'pending' | 'published' | 'rejected' | 'deleted'; published_at: string; link_only: number; historical: number }>()
  if (!post) return { queued: false, reason: 'no existe' }
  const cats = await db.prepare('SELECT category_id FROM post_categories WHERE post_id = ?').bind(postId).all<{ category_id: CategoryId }>()
  const pendingObit = await db.prepare("SELECT 1 AS x FROM obituaries WHERE post_id = ? AND state = 'pending' LIMIT 1").bind(postId).first()
  // Solo una alerta ya CONFIRMADA cubre a la noticia (el aviso lo da la alerta); una alerta apenas propuesta no avisa a nadie.
  const alert = await db.prepare("SELECT 1 AS x FROM alerts WHERE post_id = ? AND confirmation = 'confirmed' LIMIT 1").bind(postId).first()
  const decision = decidePostNotification(
    { status: post.status, publishedAt: post.published_at, categories: cats.results.map((c) => c.category_id), obituaryPending: !!pendingObit, coveredByAlert: !!alert, linkOnly: !!post.link_only, historical: !!post.historical },
    now,
    importedThisRun,
  )
  // Un obituario aprobado se identifica por SU registro, para abrir exactamente ese comunicado.
  if (decision.send && decision.topics.length === 1 && decision.topics[0] === 'obituarios') {
    const o = await db.prepare("SELECT id FROM obituaries WHERE post_id = ? AND state = 'approved' LIMIT 1").bind(postId).first<{ id: number }>()
    if (!o) return { queued: false, reason: 'obituario sin aprobar' }
    return insertLog(db, now, { type: 'obituary', id: o.id, topics: decision.topics, urgent: false, title: 'Comunicado fúnebre', body: truncate(post.title || post.body, 120), url: `/obituarios/${o.id}` }, decision)
  }
  return insertLog(db, now, { type: 'post', id: post.id, topics: decision.send ? decision.topics : [], urgent: false, title: post.title, body: truncate(post.body, 120), url: `/noticias/${post.id}` }, decision)
}

export async function enqueueAlertNotification(db: D1Database, alertId: number, now: Date): Promise<Enqueue> {
  const a = await db
    .prepare('SELECT id, post_id, kind, title, body, severity, confirmation, starts_at, expires_at FROM alerts WHERE id = ?')
    .bind(alertId)
    .first<{ id: number; post_id: number | null; kind: 'agua' | 'energia' | 'calles' | 'meteorologica' | 'comunicado'; title: string; body: string; severity: 'info' | 'urgente'; confirmation: 'proposed' | 'confirmed' | 'dismissed'; starts_at: string; expires_at: string | null }>()
  if (!a) return { queued: false, reason: 'no existe' }
  let decision = decideAlertNotification({ kind: a.kind, severity: a.severity, confirmation: a.confirmation, startsAt: a.starts_at, expiresAt: a.expires_at }, now)
  // Un aviso informativo cuya noticia ya fue notificada no repite el mismo hecho (las urgentes siempre salen, con prioridad).
  if (decision.send && a.severity !== 'urgente' && a.post_id) {
    const already = await db.prepare("SELECT 1 AS x FROM notification_log WHERE dedupe_key = ? AND state != 'suppressed'").bind(dedupeKey('post', a.post_id)).first()
    if (already) decision = { send: false, reason: 'ya avisado por la noticia' }
  }
  // Un aviso de servicio que nace de una publicación de residuos también llega a quien eligió ese tema.
  if (decision.send && a.post_id) {
    const waste = await db.prepare("SELECT 1 AS x FROM post_categories WHERE post_id = ? AND category_id = 'residuos'").bind(a.post_id).first()
    if (waste) decision = { send: true, topics: [...new Set([...decision.topics, 'residuos' as const])] }
  }
  return insertLog(db, now, { type: 'alert', id: a.id, topics: decision.send ? decision.topics : [], urgent: a.severity === 'urgente', title: `⚠ ${a.title}`, body: truncate(a.body, 120), url: `/alertas/${a.id}` }, decision)
}

/** Aviso de prueba dirigido a UN dispositivo de prueba registrado expresamente. Nunca llega a otros suscriptores. */
export async function enqueueTestNotification(db: D1Database, subscriptionId: number, now: Date, nonce: string): Promise<Enqueue> {
  const sub = await db.prepare('SELECT id FROM push_subscriptions WHERE id = ? AND is_test = 1 AND active = 1').bind(subscriptionId).first()
  if (!sub) return { queued: false, reason: 'no es un dispositivo de prueba activo' }
  const r = await db
    .prepare(
      `INSERT INTO notification_log (dedupe_key, entity_type, entity_id, topics_json, urgent, title, body, url, state, created_at, test_subscription_id)
       VALUES (?, 'alert', 0, '[]', 0, 'Notificación de prueba', 'Si ves este mensaje, las notificaciones de Río Seco Conecta funcionan en este dispositivo.', '/configuracion/notificaciones', 'pending', ?, ?)`,
    )
    .bind(`test:${subscriptionId}:${nonce}`, iso(now), subscriptionId)
    .run()
  return { queued: true, id: Number(r.meta.last_row_id) }
}

interface LogRow {
  id: number
  entity_type: 'post' | 'alert' | 'obituary'
  entity_id: number
  topics_json: string
  urgent: number
  title: string
  body: string
  url: string
  test_subscription_id: number | null
}

export interface ProcessResult {
  processed: boolean
  attempted: number
  succeeded: number
  failed: number
  retrying: number
  assigned: number
  note?: string
}

const payloadOf = (n: LogRow & { id: number }): PushPayload => ({
  v: 1,
  id: n.id,
  type: n.test_subscription_id ? 'test' : n.entity_type,
  title: n.title,
  body: n.body,
  url: n.url,
  urgent: !!n.urgent,
})

/** Asigna dispositivos interesados a los avisos pendientes (un lote por pasada). Idempotente. */
async function fanOut(db: D1Database, now: Date): Promise<number> {
  const log = await db
    .prepare("SELECT id, topics_json, test_subscription_id FROM notification_log WHERE state IN ('pending','sending') AND fanout_done = 0 ORDER BY id LIMIT 1")
    .first<{ id: number; topics_json: string; test_subscription_id: number | null }>()
  if (!log) return 0
  await db.prepare("UPDATE notification_log SET state = 'sending' WHERE id = ? AND state = 'pending'").bind(log.id).run()
  if (log.test_subscription_id) {
    const r = await db
      .prepare("INSERT OR IGNORE INTO notification_deliveries (notification_id, subscription_id, next_attempt_at, created_at) SELECT ?, id, ?, ? FROM push_subscriptions WHERE id = ? AND is_test = 1 AND active = 1")
      .bind(log.id, iso(now), iso(now), log.test_subscription_id)
      .run()
    await db.prepare('UPDATE notification_log SET fanout_done = 1 WHERE id = ?').bind(log.id).run()
    return r.meta.changes
  }
  const cursor = await db.prepare('SELECT COALESCE(MAX(subscription_id), 0) AS c FROM notification_deliveries WHERE notification_id = ?').bind(log.id).first<{ c: number }>()
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO notification_deliveries (notification_id, subscription_id, next_attempt_at, created_at)
       SELECT ?, s.id, ?, ? FROM push_subscriptions s
       WHERE s.active = 1 AND s.is_test = 0 AND s.id > ?
         AND EXISTS (SELECT 1 FROM json_each(s.topics_json) j WHERE j.value IN (SELECT value FROM json_each(?)))
       ORDER BY s.id LIMIT ?`,
    )
    .bind(log.id, iso(now), iso(now), cursor?.c ?? 0, log.topics_json, FANOUT_CHUNK)
    .run()
  if (r.meta.changes < FANOUT_CHUNK) await db.prepare('UPDATE notification_log SET fanout_done = 1 WHERE id = ?').bind(log.id).run()
  return r.meta.changes
}

interface DueRow {
  delivery_id: number
  attempts: number
  notification_id: number
  created_at: string
  subscription_id: number
  endpoint: string
  p256dh: string
  auth: string
  failure_count: number
}

/** Recalcula contadores y cierra los avisos sin envíos pendientes. */
async function settle(db: D1Database, now: Date): Promise<void> {
  await db
    .prepare(
      `UPDATE notification_log SET
         attempted = (SELECT COUNT(*) FROM notification_deliveries d WHERE d.notification_id = notification_log.id AND d.state != 'pending'),
         succeeded = (SELECT COUNT(*) FROM notification_deliveries d WHERE d.notification_id = notification_log.id AND d.state = 'sent'),
         failed    = (SELECT COUNT(*) FROM notification_deliveries d WHERE d.notification_id = notification_log.id AND d.state IN ('failed','gone')),
         last_error = COALESCE((SELECT d.last_error FROM notification_deliveries d WHERE d.notification_id = notification_log.id AND d.last_error IS NOT NULL ORDER BY d.id DESC LIMIT 1), last_error)
       WHERE state = 'sending'`,
    )
    .run()
  await db
    .prepare(
      `UPDATE notification_log SET state = 'done', finished_at = ?
       WHERE state = 'sending' AND fanout_done = 1 AND NOT EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.notification_id = notification_log.id AND d.state = 'pending')`,
    )
    .bind(iso(now))
    .run()
}

/**
 * Procesa una tanda: asigna dispositivos, reclama envíos vencidos de forma atómica (dos ejecuciones simultáneas
 * jamás envían el mismo aviso al mismo dispositivo), envía, registra el resultado individual y programa reintentos.
 * Sin remitente (VAPID sin configurar) los avisos se marcan «suppressed»: jamás se declaran enviados.
 */
export async function processNotifications(db: D1Database, sender: PushSender | null, now: Date, batch = PUSH_BATCH_SIZE): Promise<ProcessResult> {
  const result: ProcessResult = { processed: false, attempted: 0, succeeded: 0, failed: 0, retrying: 0, assigned: 0 }
  const open = await db.prepare("SELECT COUNT(*) AS n FROM notification_log WHERE state IN ('pending','sending')").first<{ n: number }>()
  if (!open || open.n === 0) return result
  result.processed = true

  if (!sender) {
    await db.prepare("UPDATE notification_log SET state='suppressed', suppressed_reason='Web Push no configurado (faltan claves VAPID)', finished_at=? WHERE state IN ('pending','sending')").bind(iso(now)).run()
    return { ...result, note: 'Web Push no configurado' }
  }

  result.assigned = await fanOut(db, now)

  // Reclamo atómico: una sola sentencia marca los envíos como «en curso» hasta CLAIM_SECONDS.
  const claimed = await db
    .prepare(
      `UPDATE notification_deliveries SET next_attempt_at = ?, attempts = attempts + 1
       WHERE id IN (
         SELECT d.id FROM notification_deliveries d JOIN notification_log n ON n.id = d.notification_id
         WHERE d.state = 'pending' AND d.next_attempt_at <= ? ORDER BY n.urgent DESC, d.id LIMIT ?)
       RETURNING id`,
    )
    .bind(iso(addSec(now, CLAIM_SECONDS)), iso(now), batch)
    .all<{ id: number }>()
  const ids = claimed.results.map((r) => r.id)
  if (ids.length) {
    const marks = ids.map(() => '?').join(',')
    const due = await db
      .prepare(
        `SELECT d.id AS delivery_id, d.attempts, d.notification_id, n.created_at, s.id AS subscription_id, s.endpoint, s.p256dh, s.auth, s.failure_count
         FROM notification_deliveries d JOIN notification_log n ON n.id = d.notification_id JOIN push_subscriptions s ON s.id = d.subscription_id
         WHERE d.id IN (${marks})`,
      )
      .bind(...ids)
      .all<DueRow>()
    const logs = new Map<number, LogRow>()
    const logIds = [...new Set(due.results.map((d) => d.notification_id))]
    if (logIds.length) {
      const rows = await db.prepare(`SELECT id, entity_type, entity_id, topics_json, urgent, title, body, url, test_subscription_id FROM notification_log WHERE id IN (${logIds.map(() => '?').join(',')})`).bind(...logIds).all<LogRow>()
      for (const l of rows.results) logs.set(l.id, l)
    }

    const updates: D1PreparedStatement[] = []
    const send = async (d: DueRow) => {
      const log = logs.get(d.notification_id)!
      const ttl = log.urgent ? URGENT_TTL_SECONDS : NORMAL_TTL_SECONDS
      // Un aviso que ya venció no se entrega tarde: llegaría desactualizado.
      if (now.getTime() - new Date(d.created_at).getTime() > ttl * 1000) {
        updates.push(db.prepare("UPDATE notification_deliveries SET state='failed', last_error='vencido antes de entregarse' WHERE id = ?").bind(d.delivery_id))
        result.failed++
        return
      }
      const out = await sender({ endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth }, payloadOf(log), { urgent: !!log.urgent })
      result.attempted++
      if (out.status >= 200 && out.status < 300) {
        result.succeeded++
        updates.push(
          db.prepare("UPDATE notification_deliveries SET state='sent', last_status=?, last_error=NULL, sent_at=? WHERE id = ?").bind(out.status, iso(now), d.delivery_id),
          db.prepare('UPDATE push_subscriptions SET failure_count = 0, last_success_at = ?, last_error = NULL WHERE id = ?').bind(iso(now), d.subscription_id),
        )
        return
      }
      const err = out.error ?? `HTTP ${out.status}`
      if (out.status === 404 || out.status === 410) {
        // El navegador revocó la suscripción: se da de baja y no se reintenta.
        result.failed++
        updates.push(
          db.prepare("UPDATE notification_deliveries SET state='gone', last_status=?, last_error=? WHERE id = ?").bind(out.status, err, d.delivery_id),
          db.prepare("UPDATE push_subscriptions SET active = 0, last_error = 'suscripción vencida o revocada', updated_at = ? WHERE id = ?").bind(iso(now), d.subscription_id),
        )
        return
      }
      const transient = out.status === 0 || out.status === 429 || out.status >= 500
      if (transient && d.attempts < MAX_DELIVERY_ATTEMPTS) {
        result.retrying++
        updates.push(db.prepare("UPDATE notification_deliveries SET last_status=?, last_error=?, next_attempt_at=? WHERE id = ?").bind(out.status, err, iso(addSec(now, RETRY_DELAYS_SECONDS[Math.min(d.attempts - 1, RETRY_DELAYS_SECONDS.length - 1)])), d.delivery_id))
        return
      }
      result.failed++
      const exhausted = d.failure_count + 1 >= MAX_CONSECUTIVE_PUSH_FAILURES
      updates.push(
        db.prepare("UPDATE notification_deliveries SET state='failed', last_status=?, last_error=? WHERE id = ?").bind(out.status, err, d.delivery_id),
        db.prepare('UPDATE push_subscriptions SET failure_count = failure_count + 1, active = ?, last_error = ?, updated_at = ? WHERE id = ?').bind(exhausted ? 0 : 1, err, iso(now), d.subscription_id),
      )
    }
    for (let i = 0; i < due.results.length; i += SEND_CONCURRENCY) await Promise.all(due.results.slice(i, i + SEND_CONCURRENCY).map(send))
    if (updates.length) await db.batch(updates)
  }

  await settle(db, now)
  return result
}

/** Limpieza periódica: dispositivos dados de baja, envíos y avisos antiguos y contadores de abuso. */
export async function cleanupPush(db: D1Database, now: Date): Promise<void> {
  const days = (n: number) => iso(new Date(now.getTime() - n * 86_400_000))
  await db.batch([
    db.prepare("DELETE FROM push_subscriptions WHERE active = 0 AND COALESCE(updated_at, created_at) < ?").bind(days(30)),
    db.prepare("DELETE FROM notification_log WHERE state IN ('done','suppressed') AND created_at < ?").bind(days(90)),
    db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(days(1)),
  ])
}
