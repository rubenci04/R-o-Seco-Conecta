import { b64urlToBytes, bytesToB64url, checkPushEndpoint } from '../shared/pushEndpoints'
import type { Env } from './env'

export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

/** Contenido que recibe el service worker. Cada aviso lleva SU PROPIO texto y SU PROPIA dirección: no hay ambigüedad. */
export interface PushPayload {
  v: 1
  /** id del aviso (notification_log) */
  id: number
  type: 'post' | 'alert' | 'obituary' | 'test'
  title: string
  body: string
  /** Ruta de la app que abre el aviso, p. ej. /noticias/12 */
  url: string
  urgent: boolean
}

export interface PushOutcome {
  status: number
  error?: string
}

export interface SendOptions {
  urgent: boolean
}

export type PushSender = (target: PushTarget, payload: PushPayload, opts: SendOptions) => Promise<PushOutcome>

const enc = new TextEncoder()
/** WebCrypto exige vistas sobre ArrayBuffer (no SharedArrayBuffer): todos los buffers de este módulo lo son. */
const ab = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>
const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** JWT VAPID (ES256, RFC 8292). WebCrypto devuelve la firma como r||s, el formato que exige JWS. */
export async function vapidJwt(privateKeyJwk: JsonWebKey, audience: string, subject: string, now: Date, ttlSeconds = 12 * 3600): Promise<string> {
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = bytesToB64url(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(now.getTime() / 1000) + ttlSeconds, sub: subject })))
  const key = await crypto.subtle.importKey('jwk', privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`))
  return `${header}.${claims}.${bytesToB64url(new Uint8Array(sig))}`
}

const RECORD_SIZE = 4096
/** Tope del texto claro: el servicio push admite 4096 bytes de registro y hay 86 de cabecera + 17 de relleno/etiqueta. */
export const MAX_PLAINTEXT_BYTES = 3993

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ab(ikm), 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: ab(salt), info: ab(info) }, key, bytes * 8))
}

/**
 * Cifrado de la carga útil Web Push (RFC 8291, contenido `aes128gcm` de RFC 8188), un solo registro.
 * `fixed.salt` y `fixed.ephemeral` verifican la implementación contra el vector de prueba del RFC; además, el remitente
 * reutiliza UNA clave efímera para todos los mensajes de una misma invocación (la clave vive solo en memoria, cada mensaje
 * lleva su propia sal aleatoria y cada destinatario deriva un secreto distinto): ahorra ~30 % de CPU, que en el plan gratuito
 * (10 ms por invocación) decide cuántos dispositivos se atienden por tanda.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  p256dh: string,
  authSecret: string,
  fixed?: { ephemeral?: CryptoKeyPair; salt?: Uint8Array },
): Promise<Uint8Array<ArrayBuffer>> {
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('La carga útil supera el máximo permitido')
  const uaPublic = b64urlToBytes(p256dh)
  const auth = b64urlToBytes(authSecret)
  const ephemeral = fixed?.ephemeral ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', ephemeral.publicKey)) as ArrayBuffer)
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16))

  const uaKey = await crypto.subtle.importKey('raw', ab(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, ephemeral.privateKey, 256))

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(auth, ecdh, keyInfo, 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ab(nonce) }, aes, concat(plaintext, Uint8Array.of(0x02))))

  const header = new Uint8Array(21 + asPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = asPublic.length
  header.set(asPublic, 21)
  return concat(header, cipher)
}

export function pushConfigured(env: Env): boolean {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY_JWK && env.VAPID_SUBJECT)
}

export const testHosts = (env: Env): string[] => (env.PUSH_TEST_HOSTS ? env.PUSH_TEST_HOSTS.split(',').map((h) => h.trim()).filter(Boolean) : [])

/**
 * Remitente Web Push estándar: carga útil cifrada de extremo a extremo (el servicio push no puede leerla),
 * autenticada con VAPID. Devuelve null si falta configuración: entonces nada se marca como enviado.
 */
export function createVapidSender(env: Env, now: () => Date = () => new Date(), fetchImpl: typeof fetch = fetch): PushSender | null {
  if (!pushConfigured(env)) return null
  let jwk: JsonWebKey
  try {
    jwk = JSON.parse(env.VAPID_PRIVATE_KEY_JWK!)
  } catch {
    return null
  }
  const extra = testHosts(env)
  const jwtCache = new Map<string, string>() // un JWT por origen dentro de la misma invocación
  let ephemeral: Promise<CryptoKeyPair> | undefined
  return async (target, payload, { urgent }) => {
    try {
      // Defensa en profundidad: aunque la base se alterara, jamás se envía a un servidor que no sea un servicio push conocido.
      const check = checkPushEndpoint(target.endpoint, extra)
      if (!check.ok) return { status: 0, error: check.reason }
      const audience = new URL(target.endpoint).origin
      let jwt = jwtCache.get(audience)
      if (!jwt) {
        jwt = await vapidJwt(jwk, audience, env.VAPID_SUBJECT!, now())
        jwtCache.set(audience, jwt)
      }
      ephemeral ??= crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as Promise<CryptoKeyPair>
      const body = await encryptPayload(enc.encode(JSON.stringify(payload)), target.p256dh, target.auth, { ephemeral: await ephemeral })
      const res = await fetchImpl(target.endpoint, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: urgent ? '3600' : '21600',
          Urgency: urgent ? 'high' : 'normal',
        },
        body,
      })
      return { status: res.status, error: res.status >= 200 && res.status < 300 ? undefined : `HTTP ${res.status}` }
    } catch (e) {
      return { status: 0, error: e instanceof Error ? e.message : 'error de red' }
    }
  }
}
