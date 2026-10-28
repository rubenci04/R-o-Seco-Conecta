import { bytesToB64url } from '../shared/pushEndpoints'
import { HttpError, type Ctx } from './http'

export const sha256 = async (text: string): Promise<string> => bytesToB64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))

/** Comparación en tiempo constante de dos textos (hashes). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Límite de solicitudes por acción y origen dentro de una ventana fija. Se guarda un hash (no la dirección IP en claro)
 * y se limpia a diario. Lanza 429 al superar `max`.
 */
export async function rateLimit(ctx: Ctx, action: string, max: number, windowSeconds: number): Promise<void> {
  const ip = ctx.req.headers.get('cf-connecting-ip') ?? 'local'
  const windowStart = new Date(Math.floor(ctx.now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString()
  const key = `${action}:${await sha256(ip)}`
  const row = await ctx.env.DB.prepare(
    'INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1) ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1 RETURNING count',
  )
    .bind(key, windowStart)
    .first<{ count: number }>()
  if (row && row.count > max) throw new HttpError(429, 'Demasiados intentos. Probá de nuevo más tarde.')
}
