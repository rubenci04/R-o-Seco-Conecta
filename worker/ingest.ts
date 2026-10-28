import { defaultClassifier, type Classifier } from '../shared/classifier'
import { contentHash, isNearDuplicate } from '../shared/dedupe'
import { deriveTitle, truncate } from '../shared/text'
import type { Actor } from './env'
import { historyStatement } from './history'

export type Origin = 'api' | 'assisted' | 'manual'

export interface SourceRow {
  id: string
  kind: 'facebook' | 'instagram' | 'manual'
  name: string
  url: string | null
  mode: 'api' | 'assisted' | 'manual'
  enabled: number
  trusted: number
  config_json: string
  poll_interval_seconds: number
  cursor: string | null
  status: string
  last_checked_at: string | null
  last_success_at: string | null
  last_error: string | null
  consecutive_failures: number
  next_attempt_at: string | null
}

/** Publicación normalizada, independiente de la fuente de origen. */
export interface RawPost {
  externalId: string
  url?: string | null
  title?: string
  body: string
  publishedAt: string
  media?: string[]
}

export type IngestResult =
  | { outcome: 'inserted'; postId: number; status: 'published' | 'pending'; categories: string[]; alertId: number | null; obituaryId: number | null }
  | { outcome: 'duplicate'; reason: 'external-id' | 'url' | 'content-hash' | 'near-duplicate'; ofPostId: number }

export interface IngestOptions {
  source: SourceRow
  origin: Origin
  actor: Actor
  now: Date
  classifier?: Classifier
}

/** Cuántas publicaciones recientes se comparan por similitud (acota el costo de lectura en D1). */
const NEAR_DUPLICATE_WINDOW = 40

/**
 * Pipeline de ingesta (idéntico para API, importación asistida y carga manual):
 * 1) deduplicar (id estable, URL, huella, similitud)  2) clasificar  3) decidir visibilidad
 * 4) guardar publicación + categorías + propuestas (alerta/obituario) + historial, en un único lote.
 */
export async function ingestPost(db: D1Database, raw: RawPost, opts: IngestOptions): Promise<IngestResult> {
  const { source, origin, actor, now } = opts
  const classifier = opts.classifier ?? defaultClassifier
  const body = raw.body.trim()
  const title = (raw.title?.trim() || deriveTitle(body)).slice(0, 200)

  // ---- 1) deduplicación ----
  const byId = await db.prepare('SELECT id FROM posts WHERE source_id = ? AND external_id = ?').bind(source.id, raw.externalId).first<{ id: number }>()
  if (byId) return { outcome: 'duplicate', reason: 'external-id', ofPostId: byId.id }

  if (raw.url) {
    const byUrl = await db.prepare('SELECT id FROM posts WHERE url = ? LIMIT 1').bind(raw.url).first<{ id: number }>()
    if (byUrl) return { outcome: 'duplicate', reason: 'url', ofPostId: byUrl.id }
  }

  const hash = await contentHash(`${title}\n${body}`)
  const byHash = await db.prepare("SELECT id FROM posts WHERE content_hash = ? AND status != 'deleted' LIMIT 1").bind(hash).first<{ id: number }>()
  if (byHash) return { outcome: 'duplicate', reason: 'content-hash', ofPostId: byHash.id }

  const recent = await db
    .prepare("SELECT id, title, body FROM posts WHERE status != 'deleted' ORDER BY published_at DESC LIMIT ?")
    .bind(NEAR_DUPLICATE_WINDOW)
    .all<{ id: number; title: string; body: string }>()
  const similar = recent.results.find((p) => isNearDuplicate(`${p.title} ${p.body}`, `${title} ${body}`))
  if (similar) return { outcome: 'duplicate', reason: 'near-duplicate', ofPostId: similar.id }

  // ---- 2) clasificación ----
  const result = classifier.classify({ title, body })
  const isObituary = result.obituary !== null

  // ---- 3) visibilidad ----
  // Posibles obituarios y fuentes no confiables quedan ocultos hasta que una persona los apruebe.
  const status: 'published' | 'pending' = isObituary || !source.trusted ? 'pending' : 'published'
  const reviewState = result.needsReview || status === 'pending' ? 'needs_review' : origin === 'manual' ? 'approved' : 'unreviewed'

  // ---- 4) persistencia ----
  const nowIso = now.toISOString()
  const insert = await db
    .prepare(
      `INSERT INTO posts (source_id, external_id, url, title, body, media_json, published_at, imported_at, origin, content_hash, status, review_state, classifier, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(source.id, raw.externalId, raw.url ?? null, title, body, JSON.stringify(raw.media ?? []), raw.publishedAt, nowIso, origin, hash, status, reviewState, result.classifier, actor.id)
    .run()
  const postId = Number(insert.meta.last_row_id)

  const statements: D1PreparedStatement[] = result.categories.map((c) =>
    db
      .prepare('INSERT INTO post_categories (post_id, category_id, confidence, proposed_by, confirmed, reasons_json) VALUES (?,?,?,?,0,?)')
      .bind(postId, c.id, c.confidence, 'rules', JSON.stringify(c.reasons)),
  )

  let alertId: number | null = null
  let obituaryId: number | null = null
  const sourceUrl = raw.url ?? source.url

  if (result.alert) {
    const a = result.alert
    const expires = new Date(new Date(raw.publishedAt).getTime() + a.suggestedHours * 3_600_000).toISOString()
    const r = await db
      .prepare(
        `INSERT INTO alerts (post_id, kind, severity, priority, title, body, source_url, starts_at, expires_at, confirmation, proposed_reason, created_at)
         VALUES (?,?,?,?,?,?,?,?,?, 'proposed', ?, ?)`,
      )
      .bind(postId, a.kind, a.severity, a.priority, title, truncate(body, 600), sourceUrl, raw.publishedAt, expires, a.reason, nowIso)
      .run()
    alertId = Number(r.meta.last_row_id)
    statements.push(historyStatement(db, { entityType: 'alert', entityId: alertId, action: 'proposed', actor, after: { severity: a.severity, kind: a.kind }, note: a.reason }, now))
  }

  if (result.obituary) {
    const r = await db
      .prepare(`INSERT INTO obituaries (post_id, name, message, source_url, state, created_at) VALUES (?,?,?,?, 'pending', ?)`)
      .bind(postId, result.obituary.nameSuggestion ?? '', truncate(body, 600), sourceUrl, nowIso)
      .run()
    obituaryId = Number(r.meta.last_row_id)
    statements.push(historyStatement(db, { entityType: 'obituary', entityId: obituaryId, action: 'proposed', actor, note: 'Detectado automáticamente; requiere validación humana' }, now))
  }

  statements.push(
    historyStatement(db, { entityType: 'post', entityId: postId, action: 'ingested', actor, after: { origin, status, categories: result.categories.map((c) => c.id) }, note: `clasificador ${result.classifier}` }, now),
  )
  await db.batch(statements)

  return { outcome: 'inserted', postId, status, categories: result.categories.map((c) => c.id), alertId, obituaryId }
}
