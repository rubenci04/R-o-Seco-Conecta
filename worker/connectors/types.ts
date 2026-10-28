import type { Env } from '../env'
import type { RawPost, SourceRow } from '../ingest'

export interface Readiness {
  ready: boolean
  /** Qué falta para activar el conector (nombres de secretos / permisos). Se muestra en el panel. */
  missing: string[]
}

export interface FetchResult {
  /** Publicaciones posteriores al cursor, en cualquier orden. */
  posts: RawPost[]
  /** Segundos extra de espera recomendados por el uso de cuota (cabeceras del proveedor). */
  throttleSeconds?: number
}

export interface FetchContext {
  env: Env
  source: SourceRow
  /** Instante ISO de la última publicación procesada (consulta incremental), o null la primera vez. */
  since: string | null
  fetchImpl: typeof fetch
  limit: number
}

/**
 * Un conector por fuente. Cada implementación decide cómo leer SOLO por vías oficiales y autorizadas.
 * `fetchNew` lanza `SyncError` tipado (límite de API, credenciales, permisos).
 */
export interface SourceConnector {
  readonly kind: 'facebook' | 'instagram'
  readiness(env: Env, source: SourceRow): Readiness
  fetchNew(ctx: FetchContext): Promise<FetchResult>
}
