/**
 * Validación de los endpoints de suscripción Web Push. El servidor hace una solicitud HTTPS a cada endpoint guardado,
 * así que solo se aceptan los servicios de push de los navegadores conocidos: impide usar la API para pedirle
 * solicitudes a direcciones arbitrarias (SSRF) o internas.
 */
export interface PushService {
  id: 'fcm' | 'mozilla' | 'apple' | 'windows' | 'otro'
  label: string
  /** Sufijos de nombre de host permitidos (el host debe ser igual al sufijo o terminar en «.sufijo»). */
  hosts: string[]
}

export const PUSH_SERVICES: PushService[] = [
  { id: 'fcm', label: 'Chrome / Android (FCM)', hosts: ['fcm.googleapis.com'] },
  { id: 'mozilla', label: 'Firefox', hosts: ['push.services.mozilla.com'] },
  { id: 'apple', label: 'Safari / iPhone (Apple)', hosts: ['push.apple.com'] },
  { id: 'windows', label: 'Edge / Windows', hosts: ['notify.windows.com'] },
]

export const MAX_ENDPOINT_LENGTH = 1024

const hostMatches = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`)

export type EndpointCheck = { ok: true; service: PushService } | { ok: false; reason: string }

/**
 * `extraHosts`: hosts adicionales SOLO para entornos de prueba (variable PUSH_TEST_HOSTS, formato `host:puerto`).
 * En producción no se define.
 */
export function checkPushEndpoint(raw: unknown, extraHosts: string[] = []): EndpointCheck {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_ENDPOINT_LENGTH) return { ok: false, reason: 'Endpoint inválido' }
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, reason: 'Endpoint inválido' }
  }
  if (u.username || u.password) return { ok: false, reason: 'Endpoint con credenciales no permitido' }
  if (u.hash) return { ok: false, reason: 'Endpoint inválido' }
  const test = extraHosts.includes(u.host)
  if (test) return { ok: true, service: { id: 'otro', label: 'Servicio de prueba', hosts: [u.host] } }
  if (u.protocol !== 'https:') return { ok: false, reason: 'El endpoint debe usar HTTPS' }
  if (u.port && u.port !== '443') return { ok: false, reason: 'Puerto no permitido' }
  const host = u.hostname.toLowerCase()
  const service = PUSH_SERVICES.find((s) => s.hosts.some((h) => hostMatches(host, h)))
  if (!service) return { ok: false, reason: 'Servicio de notificaciones no permitido' }
  return { ok: true, service }
}

// ---- Claves de la suscripción (RFC 8291) ----
const B64URL = /^[A-Za-z0-9_-]+$/

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** p256dh: punto P-256 sin comprimir (65 bytes, 0x04…); auth: 16 bytes. Devuelve null si es inválida. */
export function checkSubscriptionKeys(p256dh: unknown, auth: unknown): { p256dh: string; auth: string } | null {
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !B64URL.test(p256dh) || !B64URL.test(auth)) return null
  try {
    const k = b64urlToBytes(p256dh)
    const a = b64urlToBytes(auth)
    if (k.length !== 65 || k[0] !== 0x04 || a.length !== 16) return null
  } catch {
    return null
  }
  return { p256dh, auth }
}
