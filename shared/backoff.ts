/** Errores tipados de un conector: determinan cómo reintenta el sincronizador. */
export type SyncFailureKind = 'rate-limited' | 'auth-error' | 'permission-missing' | 'error'

export class SyncError extends Error {
  constructor(
    public readonly kind: SyncFailureKind,
    message: string,
    /** Segundos indicados por el proveedor (Retry-After), si los hay. */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'SyncError'
  }
}

export const BACKOFF_BASE_SECONDS = 60
export const BACKOFF_MAX_SECONDS = 60 * 60 // 1 h
export const RATE_LIMIT_MIN_SECONDS = 15 * 60

/**
 * Espera antes del próximo intento. Exponencial con tope y "jitter" inyectable (testeable).
 * - Límite de la API: al menos 15 min o lo que indique el proveedor.
 * - Credenciales/permisos: no tiene sentido reintentar cada minuto; se espera 6 h hasta que alguien corrija.
 */
export function nextDelaySeconds(kind: SyncFailureKind, consecutiveFailures: number, retryAfterSeconds?: number, random: () => number = Math.random): number {
  if (kind === 'auth-error' || kind === 'permission-missing') return 6 * 60 * 60
  if (kind === 'rate-limited') return Math.max(retryAfterSeconds ?? 0, RATE_LIMIT_MIN_SECONDS)
  const exp = Math.min(BACKOFF_BASE_SECONDS * 2 ** Math.max(consecutiveFailures - 1, 0), BACKOFF_MAX_SECONDS)
  return Math.round(exp * (0.8 + random() * 0.4))
}

export const addSeconds = (iso: string, seconds: number) => new Date(new Date(iso).getTime() + seconds * 1000).toISOString()
