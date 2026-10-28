import { z, type ZodType } from 'zod'
import { alertsFileSchema, eventsFileSchema, newsFileSchema, obituariesFileSchema } from '@/domain/schemas'
import type { AlertItem, EventItem, NewsItem, Obituary } from '@/domain/types'
import type { NewsQuery } from './types'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Cliente de la API pública (/api/public/*) para los módulos dinámicos: noticias, alertas, agenda y obituarios.
 * Valida cada respuesta con los MISMOS esquemas Zod del frontend: si el contrato se rompe, falla de forma explícita
 * en lugar de mostrar datos corruptos. No sustituye a los módulos estáticos (horarios, mapa, lugares, etc.).
 */
export class HttpRepository {
  constructor(
    private readonly base = '',
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  private async get<T>(path: string, schema: ZodType<T>): Promise<T> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(`${this.base}${path}`, { headers: { accept: 'application/json' }, signal: ctrl.signal })
    } catch (e) {
      throw new ApiError(e instanceof DOMException && e.name === 'AbortError' ? 'El servidor tardó demasiado en responder.' : 'No pudimos conectar con el servidor. Revisá tu conexión.', null)
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new ApiError(res.status >= 500 ? 'El servidor tuvo un problema. Probá de nuevo en unos minutos.' : `No se pudo obtener la información (error ${res.status}).`, res.status)
    let data: unknown
    try {
      data = await res.json()
    } catch {
      throw new ApiError('El servidor devolvió una respuesta ilegible.', res.status)
    }
    const parsed = schema.safeParse(data)
    if (!parsed.success) throw new ApiError('La respuesta del servidor no tiene el formato esperado.', res.status)
    return parsed.data
  }

  getNews(q: NewsQuery = {}): Promise<NewsItem[]> {
    const p = new URLSearchParams()
    if (q.category) p.set('categoria', q.category)
    if (q.before) p.set('antes', q.before)
    if (q.limit) p.set('limite', String(q.limit))
    const qs = p.toString()
    return this.get(`/api/public/feed${qs ? `?${qs}` : ''}`, newsFileSchema)
  }
  getAlerts(): Promise<AlertItem[]> {
    return this.get('/api/public/alerts', alertsFileSchema)
  }
  getEvents(): Promise<EventItem[]> {
    return this.get('/api/public/events', eventsFileSchema)
  }
  getObituaries(): Promise<Obituary[]> {
    return this.get('/api/public/obituaries', obituariesFileSchema)
  }
  health(): Promise<{ ok: boolean; database: string }> {
    return this.get('/api/health', z.object({ ok: z.boolean(), database: z.string(), now: z.string().optional() }))
  }
}
