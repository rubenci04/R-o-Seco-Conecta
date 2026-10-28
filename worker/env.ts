/// <reference types="@cloudflare/workers-types" />

/**
 * Bindings y secretos del Worker. Los secretos se cargan con `wrangler secret put` (nunca en el repositorio ni en el frontend).
 */
export interface Env {
  DB: D1Database
  ASSETS: Fetcher

  // Web Push (VAPID). Generar con `npm run vapid:generate`.
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY_JWK?: string // secreto
  VAPID_SUBJECT?: string // mailto: o https: de contacto
  /** Solo pruebas: hosts (host:puerto) de un servidor push simulado. En producción NO se define. */
  PUSH_TEST_HOSTS?: string

  // Meta Graph API. Todos opcionales: sin ellos los conectores quedan en "not-configured".
  META_GRAPH_VERSION?: string
  META_FACEBOOK_PAGE_ID?: string
  META_PAGE_ACCESS_TOKEN?: string // secreto
  META_INSTAGRAM_USER_ID?: string
  META_INSTAGRAM_ACCESS_TOKEN?: string // secreto
  META_INSTAGRAM_TARGET_USERNAME?: string // solo para Business Discovery
}

export interface Actor {
  id: number | null
  label: string
}

export const SYSTEM_ACTOR: Actor = { id: null, label: 'sistema' }
