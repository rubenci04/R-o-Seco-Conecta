import { SyncError } from '../../shared/backoff'
import type { Env } from '../env'
import type { RawPost, SourceRow } from '../ingest'
import type { FetchContext, FetchResult, Readiness, SourceConnector } from './types'

export const DEFAULT_GRAPH_VERSION = 'v23.0' // configurable con META_GRAPH_VERSION; verificar la versión vigente en Meta for Developers

const graphBase = (env: Env) => `https://graph.facebook.com/${env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION}`
const cfg = (s: SourceRow): Record<string, unknown> => {
  try {
    return JSON.parse(s.config_json)
  } catch {
    return {}
  }
}

// Códigos de error de la Graph API (https://developers.facebook.com/docs/graph-api/guides/error-handling)
const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014])
const PERMISSION_CODES = new Set([3, 10])
const isPermissionCode = (c: number) => PERMISSION_CODES.has(c) || (c >= 200 && c <= 299)

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string }
}

/** Traduce una respuesta de error de Graph API a un `SyncError` tipado. */
export function mapGraphError(status: number, body: GraphErrorBody | null, headers: Headers): SyncError {
  const code = body?.error?.code ?? 0
  const message = body?.error?.message ?? `HTTP ${status}`
  const retryHeader = Number(headers.get('retry-after'))
  const usage = parseUsageHeaders(headers)
  if (status === 429 || RATE_LIMIT_CODES.has(code)) {
    return new SyncError('rate-limited', `Límite de la API de Meta (${code || status}): ${message}`, retryHeader > 0 ? retryHeader : usage.regainSeconds)
  }
  if (code === 190 || status === 401) return new SyncError('auth-error', `Token inválido o vencido (${code || status}): ${message}`)
  if (isPermissionCode(code) || status === 403) return new SyncError('permission-missing', `Falta un permiso o función aprobada (${code || status}): ${message}`)
  return new SyncError('error', `Error de Graph API (${code || status}): ${message}`)
}

/** Lee `x-app-usage` / `x-business-use-case-usage` para frenar antes de llegar al límite. */
export function parseUsageHeaders(headers: Headers): { maxPercent: number; regainSeconds?: number } {
  let max = 0
  let regain: number | undefined
  const scan = (v: unknown) => {
    if (!v || typeof v !== 'object') return
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'number' && /call_count|total_cputime|total_time/.test(k)) max = Math.max(max, val)
      if (k === 'estimated_time_to_regain_access' && typeof val === 'number' && val > 0) regain = val * 60
      if (val && typeof val === 'object') scan(val)
    }
  }
  for (const h of ['x-app-usage', 'x-business-use-case-usage']) {
    const raw = headers.get(h)
    if (!raw) continue
    try {
      scan(JSON.parse(raw))
    } catch {
      /* cabecera inválida: se ignora */
    }
  }
  return { maxPercent: max, regainSeconds: regain }
}

/** Si el uso de cuota supera este porcentaje, se pide al sincronizador que espere antes del próximo ciclo. */
export const THROTTLE_AT_PERCENT = 80
export const THROTTLE_SECONDS = 15 * 60

async function graphGet<T>(ctx: FetchContext, url: string, token: string): Promise<{ data: T; headers: Headers }> {
  const res = await ctx.fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* sin cuerpo JSON */
  }
  if (!res.ok) throw mapGraphError(res.status, body as GraphErrorBody, res.headers)
  if ((body as GraphErrorBody | null)?.error) throw mapGraphError(res.status, body as GraphErrorBody, res.headers)
  return { data: body as T, headers: res.headers }
}

const throttleFor = (headers: Headers) => (parseUsageHeaders(headers).maxPercent >= THROTTLE_AT_PERCENT ? THROTTLE_SECONDS : undefined)

// ---------------------------------------------------------------- Facebook

interface FbPost {
  id: string
  message?: string
  created_time: string
  permalink_url?: string
  full_picture?: string
}

/**
 * Facebook · Página de la Comuna.
 * Vía oficial: `GET /{page-id}/published_posts` con un TOKEN DE PÁGINA de una persona con rol en la Página
 * (permisos `pages_read_engagement` + `pages_show_list`), o la función aprobada "Page Public Content Access".
 */
export class FacebookPageConnector implements SourceConnector {
  readonly kind = 'facebook' as const

  readiness(env: Env, source: SourceRow): Readiness {
    const missing: string[] = []
    if (!(cfg(source).pageId || env.META_FACEBOOK_PAGE_ID)) missing.push('META_FACEBOOK_PAGE_ID (o config.pageId)')
    if (!env.META_PAGE_ACCESS_TOKEN) missing.push('META_PAGE_ACCESS_TOKEN (secreto)')
    return { ready: missing.length === 0, missing }
  }

  async fetchNew(ctx: FetchContext): Promise<FetchResult> {
    const pageId = String(cfg(ctx.source).pageId || ctx.env.META_FACEBOOK_PAGE_ID)
    const params = new URLSearchParams({ fields: 'id,message,created_time,permalink_url,full_picture', limit: String(ctx.limit) })
    if (ctx.since) params.set('since', String(Math.floor(new Date(ctx.since).getTime() / 1000) + 1))
    const { data, headers } = await graphGet<{ data: FbPost[] }>(ctx, `${graphBase(ctx.env)}/${encodeURIComponent(pageId)}/published_posts?${params}`, ctx.env.META_PAGE_ACCESS_TOKEN!)
    const posts: RawPost[] = (data.data ?? [])
      .filter((p) => p.message?.trim())
      .map((p) => ({ externalId: p.id, url: p.permalink_url ?? null, body: p.message!, publishedAt: new Date(p.created_time).toISOString(), media: p.full_picture ? [p.full_picture] : [] }))
    return { posts, throttleSeconds: throttleFor(headers) }
  }
}

// --------------------------------------------------------------- Instagram

interface IgMedia {
  id: string
  caption?: string
  media_type?: string
  media_url?: string
  thumbnail_url?: string
  permalink?: string
  timestamp: string
}

const IG_FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp'

/**
 * Instagram · @comunaderioseco. Dos modos oficiales (config.mode):
 *  - 'own' (por defecto): `GET /{ig-user-id}/media` sobre una cuenta profesional que administramos (requiere acceso de la Comuna).
 *  - 'business-discovery': `GET /{ig-user-id}?fields=business_discovery.username(X){media{…}}` desde NUESTRA cuenta profesional,
 *    leyendo contenido público de otra cuenta Business/Creator (requiere app aprobada con `instagram_basic` y `pages_read_engagement`).
 */
export class InstagramConnector implements SourceConnector {
  readonly kind = 'instagram' as const

  private mode(source: SourceRow): 'own' | 'business-discovery' {
    return cfg(source).mode === 'business-discovery' ? 'business-discovery' : 'own'
  }

  readiness(env: Env, source: SourceRow): Readiness {
    const missing: string[] = []
    if (!(cfg(source).igUserId || env.META_INSTAGRAM_USER_ID)) missing.push('META_INSTAGRAM_USER_ID (o config.igUserId)')
    if (!env.META_INSTAGRAM_ACCESS_TOKEN) missing.push('META_INSTAGRAM_ACCESS_TOKEN (secreto)')
    if (this.mode(source) === 'business-discovery' && !(cfg(source).targetUsername || env.META_INSTAGRAM_TARGET_USERNAME)) {
      missing.push('META_INSTAGRAM_TARGET_USERNAME (o config.targetUsername)')
    }
    return { ready: missing.length === 0, missing }
  }

  async fetchNew(ctx: FetchContext): Promise<FetchResult> {
    const c = cfg(ctx.source)
    const igId = String(c.igUserId || ctx.env.META_INSTAGRAM_USER_ID)
    const token = ctx.env.META_INSTAGRAM_ACCESS_TOKEN!
    let media: IgMedia[]
    let headers: Headers

    if (this.mode(ctx.source) === 'business-discovery') {
      const target = String(c.targetUsername || ctx.env.META_INSTAGRAM_TARGET_USERNAME).replace(/[^A-Za-z0-9._]/g, '')
      const fields = `business_discovery.username(${target}){media.limit(${ctx.limit}){${IG_FIELDS}}}`
      const r = await graphGet<{ business_discovery?: { media?: { data: IgMedia[] } } }>(ctx, `${graphBase(ctx.env)}/${encodeURIComponent(igId)}?${new URLSearchParams({ fields })}`, token)
      media = r.data.business_discovery?.media?.data ?? []
      headers = r.headers
      // Business Discovery no admite `since`: se filtra por fecha.
      if (ctx.since) media = media.filter((m) => new Date(m.timestamp) > new Date(ctx.since!))
    } else {
      const params = new URLSearchParams({ fields: IG_FIELDS, limit: String(ctx.limit) })
      if (ctx.since) params.set('since', String(Math.floor(new Date(ctx.since).getTime() / 1000) + 1))
      const r = await graphGet<{ data: IgMedia[] }>(ctx, `${graphBase(ctx.env)}/${encodeURIComponent(igId)}/media?${params}`, token)
      media = r.data.data ?? []
      headers = r.headers
    }

    const posts: RawPost[] = media
      .filter((m) => m.caption?.trim())
      .map((m) => ({
        externalId: m.id,
        url: m.permalink ?? null,
        body: m.caption!,
        publishedAt: new Date(m.timestamp).toISOString(),
        media: [m.media_url ?? m.thumbnail_url].filter((x): x is string => !!x),
      }))
    return { posts, throttleSeconds: throttleFor(headers) }
  }
}

export const defaultConnectors: Record<'facebook' | 'instagram', SourceConnector> = {
  facebook: new FacebookPageConnector(),
  instagram: new InstagramConnector(),
}
