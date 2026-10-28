import { addSeconds, nextDelaySeconds, SyncError } from '../shared/backoff'
import { defaultConnectors } from './connectors/meta'
import type { SourceConnector } from './connectors/types'
import { SYSTEM_ACTOR, type Env } from './env'
import { ingestPost, type SourceRow } from './ingest'
import { enqueuePostNotification } from './notify'

/** Publicaciones procesadas por fuente y ciclo: mantiene cada invocación dentro del límite de consultas del plan gratuito. */
export const MAX_POSTS_PER_RUN = 5

export interface SyncDeps {
  connectors?: Record<string, SourceConnector>
  fetchImpl?: typeof fetch
  random?: () => number
}

export interface SourceSyncReport {
  sourceId: string
  outcome: 'success' | 'rate-limited' | 'auth-error' | 'permission-missing' | 'error' | 'skipped'
  fetched: number
  inserted: number
  duplicates: number
  detail?: string
}

function due(s: SourceRow, now: Date): string | null {
  if (!s.enabled) return 'deshabilitada'
  if (s.mode !== 'api') return 'modo no automático'
  if (s.next_attempt_at && new Date(s.next_attempt_at) > now) return 'en espera (retroceso)'
  if (s.last_checked_at && new Date(s.last_checked_at).getTime() + s.poll_interval_seconds * 1000 > now.getTime()) return 'aún no toca'
  return null
}

/** Sincroniza una fuente. Nunca lanza: todo resultado queda en `sources` y `sync_runs`. */
export async function syncSource(env: Env, source: SourceRow, now: Date, deps: SyncDeps = {}): Promise<SourceSyncReport> {
  const connectors = deps.connectors ?? defaultConnectors
  const connector = source.kind === 'manual' ? undefined : connectors[source.kind]
  const nowIso = now.toISOString()
  const report: SourceSyncReport = { sourceId: source.id, outcome: 'skipped', fetched: 0, inserted: 0, duplicates: 0 }
  if (!connector) return { ...report, detail: 'sin conector' }

  const readiness = connector.readiness(env, source)
  if (!readiness.ready) {
    // Falta configuración: se refleja en el estado, SIN fingir sincronización ni reintentar en bucle.
    const msg = `Faltan credenciales: ${readiness.missing.join(', ')}`
    if (source.status !== 'not-configured' || source.last_error !== msg) {
      await env.DB.prepare("UPDATE sources SET status='not-configured', last_error=?, last_checked_at=? WHERE id=?").bind(msg, nowIso, source.id).run()
    }
    return { ...report, detail: msg }
  }

  const started = nowIso
  try {
    const result = await connector.fetchNew({ env, source, since: source.cursor, fetchImpl: deps.fetchImpl ?? fetch, limit: 25 })
    const ordered = [...result.posts].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
    // Primero las más antiguas: el cursor avanza hasta donde se procesó y el resto queda para el próximo ciclo.
    const batch = ordered.slice(0, MAX_POSTS_PER_RUN)
    let cursor = source.cursor
    const inserted: number[] = []
    for (const raw of batch) {
      const r = await ingestPost(env.DB, raw, { source, origin: 'api', actor: SYSTEM_ACTOR, now })
      if (r.outcome === 'inserted') inserted.push(r.postId)
      else report.duplicates++
      cursor = !cursor || raw.publishedAt > cursor ? raw.publishedAt : cursor
    }
    report.fetched = ordered.length
    report.inserted = inserted.length
    for (const id of inserted) await enqueuePostNotification(env.DB, id, now, inserted.length)

    const throttle = result.throttleSeconds ? addSeconds(nowIso, result.throttleSeconds) : null
    await env.DB.prepare(
      `UPDATE sources SET status='ok', cursor=?, last_checked_at=?, last_success_at=?, last_error=NULL, consecutive_failures=0, next_attempt_at=? WHERE id=?`,
    )
      .bind(cursor, nowIso, nowIso, throttle, source.id)
      .run()
    if (ordered.length > 0) {
      await env.DB.prepare(`INSERT INTO sync_runs (source_id, started_at, finished_at, outcome, fetched, inserted, duplicates, retry_after) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(source.id, started, nowIso, 'success', ordered.length, report.inserted, report.duplicates, throttle)
        .run()
    }
    return { ...report, outcome: 'success', detail: throttle ? 'cuota alta: se espaciará la consulta' : undefined }
  } catch (e) {
    const err = e instanceof SyncError ? e : new SyncError('error', e instanceof Error ? e.message : 'error desconocido')
    const failures = source.consecutive_failures + 1
    const retryAt = addSeconds(nowIso, nextDelaySeconds(err.kind, failures, err.retryAfterSeconds, deps.random))
    const message = err.message.slice(0, 500)
    await env.DB.batch([
      env.DB.prepare('UPDATE sources SET status=?, last_checked_at=?, last_error=?, consecutive_failures=?, next_attempt_at=? WHERE id=?').bind(err.kind, nowIso, message, failures, retryAt, source.id),
      env.DB.prepare(`INSERT INTO sync_runs (source_id, started_at, finished_at, outcome, error, retry_after) VALUES (?,?,?,?,?,?)`).bind(source.id, started, nowIso, err.kind, message, retryAt),
    ])
    return { ...report, outcome: err.kind, detail: message }
  }
}

/** Ciclo completo (lo invoca el cron cada minuto). */
export async function runSyncCycle(env: Env, now: Date, deps: SyncDeps = {}): Promise<SourceSyncReport[]> {
  const sources = await env.DB.prepare("SELECT * FROM sources WHERE enabled = 1 AND mode = 'api'").all<SourceRow>()
  const reports: SourceSyncReport[] = []
  for (const s of sources.results) {
    const skip = due(s, now)
    if (skip) {
      reports.push({ sourceId: s.id, outcome: 'skipped', fetched: 0, inserted: 0, duplicates: 0, detail: skip })
      continue
    }
    reports.push(await syncSource(env, s, now, deps))
  }
  return reports
}
