import type { CategoryId, PushTopic } from '../shared/categories'
import {
  dedupeKey,
  decideAlertNotification,
  decidePostNotification,
  subscriptionMatches,
  type Decision,
} from '../shared/notificationPolicy'
import { truncate } from '../shared/text'
import type { PushSender } from './push'

/** Suscripciones procesadas por invocación: acota las consultas/solicitudes del plan gratuito (≈50 por invocación). */
export const PUSH_BATCH_SIZE = 25
export const MAX_CONSECUTIVE_PUSH_FAILURES = 5

type Enqueue = { queued: true; id: number } | { queued: false; reason: string }

/** Motivos que pueden resolverse más tarde (p. ej. al aprobar un obituario): no se registra, para no bloquear un reintento. */
const RECOVERABLE = new Set(['no publicada', 'obituario pendiente de revisión', 'alerta sin confirmación editorial'])

async function insertLog(
  db: D1Database,
  now: Date,
  e: { type: 'post' | 'alert' | 'obituary'; id: number; topics: PushTopic[]; urgent: boolean; title: string; body: string; url: string },
  decision: Decision,
): Promise<Enqueue> {
  const key = dedupeKey(e.type, e.id)
  if (!decision.send) {
    if (RECOVERABLE.has(decision.reason)) return { queued: false, reason: decision.reason }
    await db
      .prepare(
        `INSERT OR IGNORE INTO notification_log (dedupe_key, entity_type, entity_id, topics_json, urgent, title, body, url, state, suppressed_reason, created_at, finished_at)
         VALUES (?,?,?,?,?,?,?,?, 'suppressed', ?, ?, ?)`,
      )
      .bind(key, e.type, e.id, JSON.stringify(e.topics), e.urgent ? 1 : 0, e.title, e.body, e.url, decision.reason, now.toISOString(), now.toISOString())
      .run()
    return { queued: false, reason: decision.reason }
  }
  // La clave única impide notificar dos veces lo mismo, aun con ejecuciones concurrentes.
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO notification_log (dedupe_key, entity_type, entity_id, topics_json, urgent, title, body, url, state, created_at)
       VALUES (?,?,?,?,?,?,?,?, 'pending', ?)`,
    )
    .bind(key, e.type, e.id, JSON.stringify(decision.topics), e.urgent ? 1 : 0, e.title, e.body, e.url, now.toISOString())
    .run()
  return r.meta.changes === 1 ? { queued: true, id: Number(r.meta.last_row_id) } : { queued: false, reason: 'ya notificada' }
}

export async function enqueuePostNotification(db: D1Database, postId: number, now: Date, importedThisRun = 1): Promise<Enqueue> {
  const post = await db.prepare('SELECT id, title, body, status, published_at FROM posts WHERE id = ?').bind(postId).first<{ id: number; title: string; body: string; status: 'pending' | 'published' | 'rejected' | 'deleted'; published_at: string }>()
  if (!post) return { queued: false, reason: 'no existe' }
  const cats = await db.prepare('SELECT category_id FROM post_categories WHERE post_id = ?').bind(postId).all<{ category_id: CategoryId }>()
  const pendingObit = await db.prepare("SELECT 1 AS x FROM obituaries WHERE post_id = ? AND state = 'pending' LIMIT 1").bind(postId).first()
  const decision = decidePostNotification(
    { status: post.status, publishedAt: post.published_at, categories: cats.results.map((c) => c.category_id), obituaryPending: !!pendingObit },
    now,
    importedThisRun,
  )
  return insertLog(db, now, { type: 'post', id: post.id, topics: decision.send ? decision.topics : [], urgent: false, title: post.title, body: truncate(post.body, 120), url: '/noticias' }, decision)
}

export async function enqueueAlertNotification(db: D1Database, alertId: number, now: Date): Promise<Enqueue> {
  const a = await db
    .prepare('SELECT id, title, body, severity, confirmation, expires_at FROM alerts WHERE id = ?')
    .bind(alertId)
    .first<{ id: number; title: string; body: string; severity: 'info' | 'urgente'; confirmation: 'proposed' | 'confirmed' | 'dismissed'; expires_at: string | null }>()
  if (!a) return { queued: false, reason: 'no existe' }
  const decision = decideAlertNotification({ severity: a.severity, confirmation: a.confirmation, expiresAt: a.expires_at }, now)
  return insertLog(db, now, { type: 'alert', id: a.id, topics: ['urgente'], urgent: a.severity === 'urgente', title: `⚠ ${a.title}`, body: truncate(a.body, 120), url: '/alertas' }, decision)
}

interface LogRow {
  id: number
  topics_json: string
  urgent: number
  cursor_id: number
  attempted: number
  succeeded: number
  failed: number
}
interface SubRow {
  id: number
  endpoint: string
  p256dh: string
  auth: string
  topics_json: string
  failure_count: number
}

export interface ProcessResult {
  processed: boolean
  logId?: number
  attempted: number
  succeeded: number
  failed: number
  note?: string
}

/**
 * Envía el siguiente aviso pendiente, por lotes, registrando intentos, resultados y errores.
 * Sin remitente (VAPID sin configurar) el aviso se marca "suppressed": jamás se declara enviado.
 */
export async function processNotifications(db: D1Database, sender: PushSender | null, now: Date): Promise<ProcessResult> {
  const row = await db.prepare("SELECT id, topics_json, urgent, cursor_id, attempted, succeeded, failed FROM notification_log WHERE state IN ('pending','sending') ORDER BY id LIMIT 1").first<LogRow>()
  if (!row) return { processed: false, attempted: 0, succeeded: 0, failed: 0 }

  if (!sender) {
    await db.prepare("UPDATE notification_log SET state='suppressed', suppressed_reason='Web Push no configurado (faltan claves VAPID)', finished_at=? WHERE id=?").bind(now.toISOString(), row.id).run()
    return { processed: true, logId: row.id, attempted: 0, succeeded: 0, failed: 0, note: 'Web Push no configurado' }
  }

  const topics = JSON.parse(row.topics_json) as PushTopic[]
  const subs = await db
    .prepare('SELECT id, endpoint, p256dh, auth, topics_json, failure_count FROM push_subscriptions WHERE active = 1 AND id > ? ORDER BY id LIMIT ?')
    .bind(row.cursor_id, PUSH_BATCH_SIZE)
    .all<SubRow>()

  let ok = 0
  let bad = 0
  let lastError: string | null = null
  const updates: D1PreparedStatement[] = []
  for (const s of subs.results) {
    if (!subscriptionMatches(JSON.parse(s.topics_json) as string[], topics)) continue
    const out = await sender({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, { urgent: !!row.urgent })
    if (out.status >= 200 && out.status < 300) {
      ok++
      updates.push(db.prepare('UPDATE push_subscriptions SET failure_count = 0, last_success_at = ? WHERE id = ?').bind(now.toISOString(), s.id))
    } else {
      bad++
      lastError = out.error ?? `HTTP ${out.status}`
      const gone = out.status === 404 || out.status === 410
      const exhausted = s.failure_count + 1 >= MAX_CONSECUTIVE_PUSH_FAILURES
      updates.push(db.prepare('UPDATE push_subscriptions SET failure_count = failure_count + 1, active = ? WHERE id = ?').bind(gone || exhausted ? 0 : 1, s.id))
    }
  }

  const finished = subs.results.length < PUSH_BATCH_SIZE
  const nextCursor = subs.results.length ? subs.results[subs.results.length - 1].id : row.cursor_id
  updates.push(
    db
      .prepare(
        `UPDATE notification_log SET state = ?, cursor_id = ?, attempted = attempted + ?, succeeded = succeeded + ?, failed = failed + ?,
           last_error = COALESCE(?, last_error), finished_at = ? WHERE id = ?`,
      )
      .bind(finished ? 'done' : 'sending', nextCursor, ok + bad, ok, bad, lastError, finished ? now.toISOString() : null, row.id),
  )
  await db.batch(updates)
  return { processed: true, logId: row.id, attempted: ok + bad, succeeded: ok, failed: bad }
}
