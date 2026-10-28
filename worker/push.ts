import type { Env } from './env'

export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushOutcome {
  status: number
  error?: string
}

export type PushSender = (target: PushTarget, opts: { urgent: boolean }) => Promise<PushOutcome>

const enc = new TextEncoder()
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

/** JWT VAPID (ES256) para el origen del servicio push. WebCrypto devuelve la firma en formato r||s, el que exige JWS. */
export async function vapidJwt(privateKeyJwk: JsonWebKey, audience: string, subject: string, now: Date, ttlSeconds = 12 * 3600): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(now.getTime() / 1000) + ttlSeconds, sub: subject })))
  const key = await crypto.subtle.importKey('jwk', privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`))
  return `${header}.${claims}.${b64url(sig)}`
}

export function pushConfigured(env: Env): boolean {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY_JWK && env.VAPID_SUBJECT)
}

/**
 * Remitente Web Push SIN carga útil: se envía una señal autenticada con VAPID y el service worker
 * consulta `/api/public/notifications/latest` para mostrar el texto. Evita implementar el cifrado RFC 8291
 * y no expone contenido a terceros (el servicio push solo ve una señal vacía).
 * Devuelve null si falta configuración: en ese caso nada se marca como enviado.
 */
export function createVapidSender(env: Env, now: () => Date = () => new Date(), fetchImpl: typeof fetch = fetch): PushSender | null {
  if (!pushConfigured(env)) return null
  let jwk: JsonWebKey
  try {
    jwk = JSON.parse(env.VAPID_PRIVATE_KEY_JWK!)
  } catch {
    return null
  }
  return async (target, { urgent }) => {
    try {
      const audience = new URL(target.endpoint).origin
      const jwt = await vapidJwt(jwk, audience, env.VAPID_SUBJECT!, now())
      const res = await fetchImpl(target.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
          TTL: urgent ? '3600' : '21600',
          Urgency: urgent ? 'high' : 'low',
          'Content-Length': '0',
        },
      })
      return { status: res.status, error: res.ok ? undefined : `HTTP ${res.status}` }
    } catch (e) {
      return { status: 0, error: e instanceof Error ? e.message : 'error de red' }
    }
  }
}
