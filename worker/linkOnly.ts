import { defaultClassifier, type Classifier } from '../shared/classifier'
import { contentHash } from '../shared/dedupe'
import { deriveTitle, truncate } from '../shared/text'
import type { Actor } from './env'
import { historyStatement } from './history'
import type { Duplicate, RawPost } from './ingest'
import { parsePostLink } from '../shared/dedupe'

// Tarjetas individuales creadas SOLO con el enlace (sin texto original). No hay clasificación automática, ni alertas,
// ni obituarios: lo que se muestre como categoría lo decidió una persona que vio la publicación.

export interface LinkOnlyInput {
  sourceId: string
  externalId: string
  url: string
  title: string
  contentType: string
  /** Solo si la fecha original fue comprobada por la persona. Si falta, se guarda la fecha de registro y se marca sin verificar. */
  publishedAt?: string
  categories: string[]
  /** La persona vio el contenido y confirma título y categorías. */
  reviewed: boolean
}

export type LinkOnlyResult = { outcome: 'inserted'; postId: number; status: 'published' | 'draft' | 'pending' } | Duplicate

export async function findLinkDuplicate(db: D1Database, sourceId: string, externalId: string, url: string): Promise<Duplicate | null> {
  const byId = await db.prepare('SELECT id FROM posts WHERE source_id = ? AND external_id = ?').bind(sourceId, externalId).first<{ id: number }>()
  if (byId) return { outcome: 'duplicate', reason: 'external-id', ofPostId: byId.id }
  const byUrl = await db.prepare('SELECT id FROM posts WHERE url = ? LIMIT 1').bind(url).first<{ id: number }>()
  return byUrl ? { outcome: 'duplicate', reason: 'url', ofPostId: byUrl.id } : null
}

export async function ingestLinkOnly(
  db: D1Database,
  input: LinkOnlyInput,
  opts: { actor: Actor; now: Date; status: 'published' | 'draft' | 'pending'; historical?: boolean },
): Promise<LinkOnlyResult> {
  const dup = await findLinkDuplicate(db, input.sourceId, input.externalId, input.url)
  if (dup) return dup
  const nowIso = opts.now.toISOString()
  const hash = await contentHash(`enlace ${input.url}`)
  const insert = await db
    .prepare(
      `INSERT INTO posts (source_id, external_id, url, title, body, media_json, published_at, imported_at, origin, content_hash, status, review_state, classifier, created_by, link_only, date_verified, historical, content_type)
       VALUES (?,?,?,?, '', '[]', ?,?, 'assisted', ?,?,?, NULL, ?, 1, ?, ?, ?)`,
    )
    .bind(
      input.sourceId, input.externalId, input.url, input.title.slice(0, 200), input.publishedAt ?? nowIso, nowIso, hash, opts.status, input.reviewed ? 'approved' : 'unreviewed',
      opts.actor.id, input.publishedAt ? 1 : 0, opts.historical ? 1 : 0, input.contentType,
    )
    .run()
  const postId = Number(insert.meta.last_row_id)
  await db.batch([
    ...input.categories.map((c) => db.prepare("INSERT INTO post_categories (post_id, category_id, confidence, proposed_by, confirmed, reasons_json) VALUES (?,?,1,'editor',1,'[]')").bind(postId, c)),
    historyStatement(
      db,
      { entityType: 'post', entityId: postId, action: 'registered-link', actor: opts.actor, after: { status: opts.status, categories: input.categories, dateVerified: !!input.publishedAt, historical: !!opts.historical }, note: 'Tarjeta creada solo con el enlace (sin texto original)' },
      opts.now,
    ),
  ])
  return { outcome: 'inserted', postId, status: opts.status }
}

/** Tarjeta creada solo con enlace que corresponde a una publicación obtenida después por una fuente autorizada (misma URL normalizada o mismo id). */
export async function findLinkCard(db: D1Database, sourceId: string, raw: RawPost): Promise<number | null> {
  const link = raw.url ? parsePostLink(raw.url) : null
  if (!link) return null
  const row = await db
    .prepare('SELECT id FROM posts WHERE link_only = 1 AND source_id = ? AND (url = ? OR (external_id = ? AND ? IS NOT NULL)) LIMIT 1')
    .bind(sourceId, link.canonicalUrl, link.externalId, link.externalId)
    .first<{ id: number }>()
  return row?.id ?? null
}

export type EnrichResult =
  | { outcome: 'enriched'; postId: number; status: string; categories: string[]; alertId: number | null; obituaryId: number | null }
  | { outcome: 'not-link-only' | 'not-found' | 'duplicate'; ofPostId?: number }

/** Completa una tarjeta creada solo con enlace con el texto original: clasifica con las reglas existentes, sin crear otra noticia. */
export async function enrichLinkOnly(
  db: D1Database,
  postId: number,
  input: { text: string; title?: string; publishedAt?: string },
  opts: { actor: Actor; now: Date; classifier?: Classifier },
): Promise<EnrichResult> {
  const post = await db.prepare('SELECT id, url, title, status, historical, link_only FROM posts WHERE id = ?').bind(postId).first<{ id: number; url: string | null; title: string; status: string; historical: number; link_only: number }>()
  if (!post) return { outcome: 'not-found' }
  if (!post.link_only) return { outcome: 'not-link-only' }
  const body = input.text.trim()
  // El título que escribió la persona se conserva salvo que indique otro (solo se deriva del texto si no había ninguno).
  const title = (input.title?.trim() || post.title || deriveTitle(body)).slice(0, 200)
  const hash = await contentHash(`${title}\n${body}`)
  const same = await db.prepare("SELECT id FROM posts WHERE content_hash = ? AND id != ? AND status != 'deleted' LIMIT 1").bind(hash, postId).first<{ id: number }>()
  if (same) return { outcome: 'duplicate', ofPostId: same.id }
  const result = (opts.classifier ?? defaultClassifier).classify({ title, body })
  const nowIso = opts.now.toISOString()
  // Un posible obituario sale del feed hasta que una persona lo confirme; el resto conserva su estado.
  const status = result.obituary ? 'pending' : post.status
  const sets = ['body = ?', 'title = ?', 'content_hash = ?', 'link_only = 0', 'classifier = ?', 'status = ?', 'review_state = ?']
  const binds: unknown[] = [body, title, hash, result.classifier, status, result.obituary || result.needsReview ? 'needs_review' : 'unreviewed']
  if (input.publishedAt) {
    sets.push('published_at = ?', 'date_verified = 1')
    binds.push(input.publishedAt)
  }
  const startsAt = input.publishedAt ?? nowIso
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, postId),
    // Las categorías que ya confirmó una persona se conservan; el clasificador agrega las que falten.
    ...result.categories.map((c) =>
      db.prepare("INSERT OR IGNORE INTO post_categories (post_id, category_id, confidence, proposed_by, confirmed, reasons_json) VALUES (?,?,?,'rules',0,?)").bind(postId, c.id, c.confidence, JSON.stringify(c.reasons)),
    ),
  ]
  let alertId: number | null = null
  let obituaryId: number | null = null
  if (result.alert && !post.historical) {
    const a = result.alert
    const expires = new Date(new Date(startsAt).getTime() + a.suggestedHours * 3_600_000).toISOString()
    const r = await db
      .prepare(
        `INSERT INTO alerts (post_id, kind, severity, priority, title, body, source_url, starts_at, expires_at, confirmation, proposed_reason, created_at)
         VALUES (?,?,?,?,?,?,?,?,?, 'proposed', ?, ?)`,
      )
      .bind(postId, a.kind, a.severity, a.priority, title, truncate(body, 600), post.url, startsAt, expires, a.reason, nowIso)
      .run()
    alertId = Number(r.meta.last_row_id)
  }
  if (result.obituary) {
    const r = await db
      .prepare("INSERT INTO obituaries (post_id, name, message, source_url, state, created_at) VALUES (?,?,?,?, 'pending', ?)")
      .bind(postId, result.obituary.nameSuggestion ?? '', truncate(body, 600), post.url, nowIso)
      .run()
    obituaryId = Number(r.meta.last_row_id)
  }
  statements.push(
    historyStatement(db, { entityType: 'post', entityId: postId, action: 'enriched', actor: opts.actor, after: { categories: result.categories.map((c) => c.id), status }, note: 'Tarjeta completada con el texto original' }, opts.now),
  )
  await db.batch(statements)
  const cats = await db.prepare('SELECT category_id FROM post_categories WHERE post_id = ?').bind(postId).all<{ category_id: string }>()
  return { outcome: 'enriched', postId, status, categories: cats.results.map((c) => c.category_id), alertId, obituaryId }
}
