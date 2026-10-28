import type { Actor, Env } from './env'
import type { Role } from '../shared/permissions'

export interface AdminSession {
  id: number
  email: string
  displayName: string
  role: Role
}

export interface Ctx {
  req: Request
  env: Env
  url: URL
  params: Record<string, string>
  now: Date
  admin?: AdminSession
  /** Cuerpo JSON ya leído (solo en métodos con cuerpo). */
  body: () => Promise<Record<string, unknown>>
}

export type Handler = (ctx: Ctx) => Promise<Response> | Response

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const json = (data: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(init.headers ?? {}) },
  })

/**
 * Respuesta pública con ETag: el navegador siempre revalida (lo publicado se ve al instante) y, si no cambió,
 * recibe 304 sin cuerpo. Así no hay un retraso de caché tras publicar y se ahorra ancho de banda.
 */
export async function etagJson(ctx: Ctx, data: unknown): Promise<Response> {
  const body = JSON.stringify(data)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  const etag = '"' + [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('') + '"'
  const headers = { etag, 'cache-control': 'public, no-cache' }
  if (ctx.req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
  return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', ...headers } })
}

export const actorOf = (admin: AdminSession): Actor => ({ id: admin.id, label: admin.email })

interface Route {
  method: string
  parts: string[]
  handler: Handler
}

/** Router mínimo: patrones con `:param`. */
export class Router {
  private routes: Route[] = []

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler })
    return this
  }
  get = (p: string, h: Handler) => this.add('GET', p, h)
  post = (p: string, h: Handler) => this.add('POST', p, h)
  patch = (p: string, h: Handler) => this.add('PATCH', p, h)
  put = (p: string, h: Handler) => this.add('PUT', p, h)
  delete = (p: string, h: Handler) => this.add('DELETE', p, h)

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | 'method-not-allowed' | null {
    const segs = pathname.split('/').filter(Boolean)
    let pathMatched = false
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue
      const params: Record<string, string> = {}
      const ok = r.parts.every((p, i) => {
        if (p.startsWith(':')) {
          params[p.slice(1)] = decodeURIComponent(segs[i])
          return true
        }
        return p === segs[i]
      })
      if (!ok) continue
      pathMatched = true
      if (r.method === method) return { handler: r.handler, params }
    }
    return pathMatched ? 'method-not-allowed' : null
  }
}

export function makeBody(req: Request): () => Promise<Record<string, unknown>> {
  let cached: Promise<Record<string, unknown>> | undefined
  return () =>
    (cached ??= req
      .json()
      .then((b) => {
        if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'Se esperaba un objeto JSON')
        return b as Record<string, unknown>
      })
      .catch((e) => {
        throw e instanceof HttpError ? e : new HttpError(400, 'JSON inválido')
      }))
}

// ---- Validadores mínimos de entrada ----
export function str(v: unknown, field: string, opts: { max?: number; optional?: boolean } = {}): string {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return ''
    throw new HttpError(400, `Falta el campo «${field}»`)
  }
  if (typeof v !== 'string') throw new HttpError(400, `«${field}» debe ser texto`)
  const t = v.trim()
  if (!t && !opts.optional) throw new HttpError(400, `Falta el campo «${field}»`)
  if (t.length > (opts.max ?? 10_000)) throw new HttpError(400, `«${field}» es demasiado largo`)
  return t
}

export function httpUrl(v: unknown, field: string, optional = false): string | null {
  if ((v === undefined || v === null || v === '') && optional) return null
  const s = str(v, field, { max: 2048 })
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error()
    return u.toString()
  } catch {
    throw new HttpError(400, `«${field}» debe ser una URL http(s) válida`)
  }
}

export function isoDate(v: unknown, field: string): string {
  const s = str(v, field)
  if (Number.isNaN(Date.parse(s))) throw new HttpError(400, `«${field}» debe ser una fecha válida`)
  return new Date(s).toISOString()
}
