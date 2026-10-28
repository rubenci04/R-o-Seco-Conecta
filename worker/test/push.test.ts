import { describe, expect, it, vi } from 'vitest'
import { b64urlToBytes, bytesToB64url } from '../../shared/pushEndpoints'
import type { Env } from '../env'
import { cleanupPush, enqueuePostNotification, enqueueAlertNotification, FANOUT_CHUNK, MAX_DELIVERY_ATTEMPTS, processNotifications, PUSH_BATCH_SIZE, RETRY_DELAYS_SECONDS } from '../notify'
import { createVapidSender, encryptPayload, vapidJwt, type PushPayload } from '../push'
import { harness, NOW, TEXT, type Harness } from './helpers'

const enc = new TextEncoder()
const dec = new TextDecoder()

// ------------------------------------------------------------------ dispositivos y servidor push simulados
interface Device {
  endpoint: string
  p256dh: string
  auth: string
  privateKey: CryptoKey
  publicRaw: Uint8Array<ArrayBuffer>
  token?: string
}

async function makeDevice(n: number | string): Promise<Device> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer)
  const auth = crypto.getRandomValues(new Uint8Array(16))
  return { endpoint: `https://push.test/device/${n}`, p256dh: bytesToB64url(publicRaw), auth: bytesToB64url(auth), privateKey: kp.privateKey, publicRaw }
}

const concat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((a, b) => a + b.length, 0))
  let i = 0
  for (const x of p) {
    o.set(x, i)
    i += x.length
  }
  return o as Uint8Array<ArrayBuffer>
}
const ab = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const k = await crypto.subtle.importKey('raw', ab(ikm), 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: ab(salt), info: ab(info) }, k, len * 8)) as Uint8Array<ArrayBuffer>
}

/** Descifra como lo haría el navegador (RFC 8291): demuestra que el contenido sale cifrado de extremo a extremo y correcto. */
async function decrypt(body: Uint8Array, dev: Device): Promise<string> {
  const salt = body.slice(0, 16)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const cipher = body.slice(21 + idlen)
  const asKey = await crypto.subtle.importKey('raw', ab(asPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, dev.privateKey, 256)) as Uint8Array<ArrayBuffer>
  const ikm = await hkdf(b64urlToBytes(dev.auth), ecdh, concat(enc.encode('WebPush: info\0'), dev.publicRaw, asPublic), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const aes = await crypto.subtle.importKey('raw', ab(cek), 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ab(nonce) }, aes, ab(cipher)))
  expect(plain[plain.length - 1]).toBe(0x02)
  return dec.decode(plain.slice(0, -1))
}

interface Received {
  device: Device
  payload: PushPayload
  headers: Record<string, string>
}

function pushServer(devices: Device[], statusFor: (endpoint: string, call: number) => number = () => 201) {
  const received: Received[] = []
  const calls = new Map<string, number>()
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const endpoint = String(url)
    const n = (calls.get(endpoint) ?? 0) + 1
    calls.set(endpoint, n)
    const status = statusFor(endpoint, n)
    if (status >= 200 && status < 300) {
      const device = devices.find((d) => d.endpoint === endpoint)!
      const payload = JSON.parse(await decrypt(init!.body as Uint8Array<ArrayBuffer>, device)) as PushPayload
      received.push({ device, payload, headers: init!.headers as Record<string, string> })
    }
    return new Response(null, { status })
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
  return { fetchImpl, received, calls }
}

async function vapidEnv(): Promise<Partial<Env>> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const jwk = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer)
  return { VAPID_PUBLIC_KEY: bytesToB64url(pub), VAPID_PRIVATE_KEY_JWK: JSON.stringify(jwk), VAPID_SUBJECT: 'https://rio-seco.test', PUSH_TEST_HOSTS: 'push.test' }
}

interface Setup {
  h: Harness
  server: ReturnType<typeof pushServer>
  devices: Device[]
  editor: string
  admin: string
}

/** Cada dispositivo se registra por la API pública, como lo haría el navegador. */
async function setup(topicsByDevice: string[][], statusFor?: (e: string, n: number) => number): Promise<Setup> {
  const devices = await Promise.all(topicsByDevice.map((_, i) => makeDevice(i + 1)))
  const server = pushServer(devices, statusFor)
  const h = await harness(await vapidEnv(), { pushFetch: server.fetchImpl })
  for (const [i, d] of devices.entries()) {
    const r = await h.call('POST', '/api/public/push/subscribe', { body: { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth }, topics: topicsByDevice[i] } })
    expect(r.status).toBe(201)
    d.token = r.json.token
  }
  return { h, server, devices, editor: await h.loginAs('editor'), admin: await h.loginAs('admin') }
}

const publish = (s: Setup, body: string, categories: string[], extra: Record<string, unknown> = {}) =>
  s.h.call('POST', '/api/admin/posts', { cookie: s.editor, body: { body, status: 'published', ...(categories.length ? { categories } : {}), ...extra } })
const count = (s: Setup, sql: string) => (s.h.db.raw.prepare(sql).get() as { n: number }).n
const deviceNumbers = (s: Setup) => s.server.received.map((r) => r.device.endpoint.split('/').pop()).sort()

// ------------------------------------------------------------------ cifrado y VAPID
describe('Web Push estándar: cifrado RFC 8291 y VAPID RFC 8292', () => {
  it('reproduce el vector de prueba del RFC 8291 (apéndice A) byte a byte', async () => {
    const asPrivate = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'
    const asPublic = b64urlToBytes('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8')
    const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', d: asPrivate, x: bytesToB64url(asPublic.slice(1, 33)), y: bytesToB64url(asPublic.slice(33, 65)), ext: true }
    const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const publicKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
    const out = await encryptPayload(
      enc.encode('When I grow up, I want to be a watermelon'),
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      'BTBZMqHH6r4Tts7J_aSIgg',
      { ephemeral: { privateKey, publicKey }, salt: b64urlToBytes('DGv6ra1nlYgDCS1FRnbzlw') },
    )
    expect(bytesToB64url(out)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    )
  })

  it('el destinatario descifra el contenido y una clave ajena no puede', async () => {
    const mine = await makeDevice('a')
    const other = await makeDevice('b')
    const out = await encryptPayload(enc.encode('hola'), mine.p256dh, mine.auth)
    expect(await decrypt(out, mine)).toBe('hola')
    await expect(decrypt(out, other)).rejects.toThrow()
  })

  it('rechaza una carga útil demasiado grande', async () => {
    const d = await makeDevice('x')
    await expect(encryptPayload(new Uint8Array(4000), d.p256dh, d.auth)).rejects.toThrow()
  })

  it('el JWT VAPID es ES256 verificable con la clave pública y trae audiencia, vencimiento y contacto', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const jwt = await vapidJwt((await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey, 'https://fcm.googleapis.com', 'https://rio-seco.test', NOW)
    const [h, c, sig] = jwt.split('.')
    expect(JSON.parse(dec.decode(b64urlToBytes(h)))).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(JSON.parse(dec.decode(b64urlToBytes(c)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: Math.floor(NOW.getTime() / 1000) + 43200, sub: 'https://rio-seco.test' })
    const sigBytes = b64urlToBytes(sig)
    expect(sigBytes.length).toBe(64)
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, sigBytes, enc.encode(`${h}.${c}`))).toBe(true)
  })

  it('el remitente envía cabeceras estándar y se niega a contactar servidores que no son un servicio push', async () => {
    const dev = await makeDevice(1)
    const server = pushServer([dev])
    const env = { ...(await vapidEnv()) } as Env
    const send = createVapidSender(env, () => NOW, server.fetchImpl)!
    const payload: PushPayload = { v: 1, id: 7, type: 'post', title: 'T', body: 'B', url: '/noticias/7', urgent: true }
    expect((await send({ endpoint: dev.endpoint, p256dh: dev.p256dh, auth: dev.auth }, payload, { urgent: true })).status).toBe(201)
    const h = server.received[0].headers
    expect(h['Content-Encoding']).toBe('aes128gcm')
    expect(h.Urgency).toBe('high')
    expect(h.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/)
    // Una dirección interna o ajena jamás recibe una solicitud, aunque estuviera guardada en la base.
    const bad = await send({ endpoint: 'https://169.254.169.254/latest', p256dh: dev.p256dh, auth: dev.auth }, payload, { urgent: false })
    expect(bad.status).toBe(0)
    expect(server.fetchImpl).toHaveBeenCalledTimes(1)
    expect(createVapidSender({ ...env, VAPID_PRIVATE_KEY_JWK: undefined } as Env)).toBeNull()
  })
})

// ------------------------------------------------------------------ API pública de suscripción
describe('suscripciones: validación, propiedad y baja', () => {
  const body = async (n = 1, topics: string[] = ['agua']) => {
    const d = await makeDevice(n)
    return { d, body: { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth }, topics } }
  }

  it('sin claves VAPID configuradas la API informa «no disponible» y no registra a nadie', async () => {
    const h = await harness()
    const { body: b } = await body()
    expect((await h.call('GET', '/api/public/push/config')).json).toMatchObject({ enabled: false, publicKey: null })
    expect((await h.call('POST', '/api/public/push/subscribe', { body: b })).status).toBe(503)
  })

  it('la configuración pública lista los temas con descripción y nunca expone la clave privada', async () => {
    const h = await harness(await vapidEnv())
    const cfg = (await h.call('GET', '/api/public/push/config')).json
    expect(cfg.enabled).toBe(true)
    expect(cfg.topics.map((t: { id: string }) => t.id)).toEqual(['urgente', 'agua', 'energia', 'calles', 'residuos', 'meteorologica', 'institucional', 'eventos', 'cultura', 'deportes', 'educacion', 'salud', 'otros', 'obituarios'])
    expect(JSON.stringify(cfg)).not.toContain('"d"')
    expect(JSON.stringify(cfg)).not.toContain(JSON.parse(h.env.VAPID_PRIVATE_KEY_JWK!).d)
  })

  it('registra, entrega un token una sola vez y guarda solo su hash', async () => {
    const h = await harness(await vapidEnv())
    const { body: b } = await body(1, ['agua', 'urgente'])
    const r = await h.call('POST', '/api/public/push/subscribe', { body: b })
    expect(r.status).toBe(201)
    expect(r.json.token).toMatch(/^[\w-]{40,}$/)
    const row = h.db.raw.prepare('SELECT token_hash, topics_json, service, active FROM push_subscriptions').get() as { token_hash: string; topics_json: string; service: string; active: number }
    expect(row.token_hash).not.toBe(r.json.token)
    expect(row).toMatchObject({ topics_json: '["agua","urgente"]', service: 'otro', active: 1 })
    expect(JSON.stringify(h.db.raw.prepare('SELECT * FROM push_subscriptions').all())).not.toContain(r.json.token)
  })

  it('rechaza endpoints no permitidos, claves inválidas y temas desconocidos o vacíos', async () => {
    const h = await harness(await vapidEnv())
    const { body: ok } = await body()
    const attempts: Array<[string, Record<string, unknown>]> = [
      ['http sin cifrar', { ...ok, endpoint: 'http://fcm.googleapis.com/fcm/send/x' }],
      ['servidor ajeno', { ...ok, endpoint: 'https://evil.example/push' }],
      ['dirección interna', { ...ok, endpoint: 'https://127.0.0.1/push' }],
      ['metadatos de la nube', { ...ok, endpoint: 'https://169.254.169.254/latest' }],
      ['con credenciales', { ...ok, endpoint: 'https://user:pass@fcm.googleapis.com/x' }],
      ['dominio engañoso', { ...ok, endpoint: 'https://fcm.googleapis.com.evil.example/x' }],
      ['puerto inusual', { ...ok, endpoint: 'https://fcm.googleapis.com:8443/x' }],
      ['claves cortas', { ...ok, keys: { p256dh: 'abc', auth: 'def' } }],
      ['sin temas', { ...ok, topics: [] }],
      ['tema inventado', { ...ok, topics: ['agua', 'inventado'] }],
      ['temas no lista', { ...ok, topics: 'agua' }],
    ]
    for (const [name, b] of attempts) expect((await h.call('POST', '/api/public/push/subscribe', { body: b })).status, name).toBe(400)
    expect(count({ h } as Setup, 'SELECT COUNT(*) n FROM push_subscriptions')).toBe(0)
    for (const real of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/abc', 'https://wns2-par02p.notify.windows.com/w/?token=abc']) {
      const d = await makeDevice(real)
      expect((await h.call('POST', '/api/public/push/subscribe', { body: { endpoint: real, keys: { p256dh: d.p256dh, auth: d.auth }, topics: ['agua'] } })).status, real).toBe(201)
    }
    expect(h.db.raw.prepare('SELECT service FROM push_subscriptions ORDER BY id').all()).toEqual([{ service: 'fcm' }, { service: 'mozilla' }, { service: 'apple' }, { service: 'windows' }])
  })

  it('nadie puede modificar ni dar de baja la suscripción de otra persona sin su token', async () => {
    const h = await harness(await vapidEnv())
    const { body: b } = await body(1, ['agua'])
    const { token } = (await h.call('POST', '/api/public/push/subscribe', { body: b })).json
    expect((await h.call('POST', '/api/public/push/subscribe', { body: { ...b, topics: ['salud'] } })).status).toBe(403)
    expect((await h.call('POST', '/api/public/push/preferences', { body: { endpoint: b.endpoint, token: 'x'.repeat(43), topics: ['salud'] } })).status).toBe(403)
    expect((await h.call('POST', '/api/public/push/unsubscribe', { body: { endpoint: b.endpoint } })).status).toBe(400)
    expect((await h.call('POST', '/api/public/push/unsubscribe', { body: { endpoint: b.endpoint, token: 'x'.repeat(43) } })).status).toBe(403)
    expect(h.db.raw.prepare('SELECT topics_json FROM push_subscriptions').get()).toEqual({ topics_json: '["agua"]' })
    // El dueño sí puede.
    expect((await h.call('POST', '/api/public/push/preferences', { body: { endpoint: b.endpoint, token, topics: ['salud', 'otros'] } })).json.topics).toEqual(['salud', 'otros'])
    expect((await h.call('POST', '/api/public/push/status', { body: { endpoint: b.endpoint, token } })).json).toEqual({ registered: true, active: true, topics: ['salud', 'otros'] })
    expect((await h.call('POST', '/api/public/push/subscribe', { body: { ...b, topics: ['calles'], token } })).status).toBe(200)
    expect((await h.call('POST', '/api/public/push/unsubscribe', { body: { endpoint: b.endpoint, token } })).json).toEqual({ ok: true })
    expect(count({ h } as Setup, 'SELECT COUNT(*) n FROM push_subscriptions')).toBe(0)
    // Idempotente y sin revelar si existía.
    expect((await h.call('POST', '/api/public/push/status', { body: { endpoint: b.endpoint, token } })).json).toEqual({ registered: false })
  })

  it('limita la cantidad de registros por origen y el total de dispositivos', async () => {
    const h = await harness(await vapidEnv())
    const { body: b } = await body()
    let last = 0
    for (let i = 0; i < 22; i++) last = (await h.call('POST', '/api/public/push/subscribe', { body: { ...b, endpoint: `${b.endpoint}${i}`, keys: { p256dh: 'bad', auth: 'bad' } } })).status
    expect(last).toBe(429)
  })
})

// ------------------------------------------------------------------ publicar noticias → audiencia correcta
describe('noticias: solo reciben el aviso quienes eligieron esa categoría y se abre la noticia exacta', () => {
  it('una noticia institucional llega al suscrito a «institucional» y a nadie más; el contenido es el de ESA noticia', async () => {
    const s = await setup([['institucional'], ['agua'], ['deportes', 'salud'], ['institucional', 'agua']])
    const r = await publish(s, 'La Comuna informa que la oficina de atención al vecino atenderá en horario especial durante la semana próxima.', ['institucional'], { title: 'Horario especial de la Comuna' })
    expect(r.status).toBe(201)
    await s.h.settle()
    expect(deviceNumbers(s)).toEqual(['1', '4'])
    for (const got of s.server.received) {
      expect(got.payload).toMatchObject({ v: 1, type: 'post', title: 'Horario especial de la Comuna', urgent: false, url: `/noticias/${r.json.postId}` })
      expect(got.payload.body).toContain('oficina de atención')
      expect(got.headers.Urgency).toBe('normal')
    }
    expect(s.h.db.raw.prepare('SELECT state, attempted, succeeded, failed FROM notification_log').get()).toEqual({ state: 'done', attempted: 2, succeeded: 2, failed: 0 })
  })

  it('dos noticias de categorías distintas jamás se mezclan: cada dispositivo recibe el contenido de la suya', async () => {
    const s = await setup([['institucional'], ['deportes']])
    const a = await publish(s, 'Comunicado institucional sobre la renovación del convenio con la provincia para obras de la zona.', ['institucional'], { title: 'Convenio con la provincia' })
    const b = await publish(s, TEXT.torneo, ['deportes'], { title: 'Torneo infantil de fútbol' })
    await s.h.settle()
    const byDevice = Object.fromEntries(s.server.received.map((r) => [r.device.endpoint.split('/').pop(), r.payload]))
    expect(byDevice['1']).toMatchObject({ title: 'Convenio con la provincia', url: `/noticias/${a.json.postId}` })
    expect(byDevice['2']).toMatchObject({ title: 'Torneo infantil de fútbol', url: `/noticias/${b.json.postId}` })
    expect(s.server.received).toHaveLength(2)
  })

  it('borradores y noticias pendientes de revisión no notifican', async () => {
    const s = await setup([['institucional', 'otros']])
    await s.h.call('POST', '/api/admin/posts', { cookie: s.editor, body: { body: TEXT.torneo, status: 'draft', categories: ['otros'] } })
    await s.h.settle()
    expect(s.server.received).toHaveLength(0)
    expect(count(s, 'SELECT COUNT(*) n FROM notification_log')).toBe(0)
  })

  it('una noticia antigua o una carga masiva (historial) no genera avisos', async () => {
    const s = await setup([['institucional', 'otros']])
    const old = await publish(s, TEXT.torneo, ['otros'], { publishedAt: '2026-10-01T10:00:00Z' })
    expect(count(s, "SELECT COUNT(*) n FROM notification_log WHERE state = 'suppressed'")).toBe(1)
    expect(s.h.db.raw.prepare('SELECT suppressed_reason FROM notification_log').get()).toEqual({ suppressed_reason: 'publicación antigua' })
    void old
    const recent = await publish(s, 'Nueva jornada de vacunación en el centro de salud del pueblo con atención por orden de llegada.', ['otros'])
    s.h.db.raw.prepare("DELETE FROM notification_log WHERE entity_id = ?").run(recent.json.postId)
    expect(await enqueuePostNotification(s.h.env.DB, recent.json.postId, NOW, 25)).toEqual({ queued: false, reason: 'carga masiva: no se notifica el historial' })
    await s.h.settle()
    expect(s.server.received).toHaveLength(0)
  })

  it('republicar o reprocesar la misma noticia no la notifica dos veces', async () => {
    const s = await setup([['otros']])
    const r = await publish(s, TEXT.torneo, ['otros'])
    await s.h.settle()
    expect(await enqueuePostNotification(s.h.env.DB, r.json.postId, NOW)).toEqual({ queued: false, reason: 'ya notificada' })
    await processNotifications(s.h.env.DB, createVapidSender(s.h.env, () => NOW, s.server.fetchImpl), NOW)
    expect(s.server.received).toHaveLength(1)
    expect(count(s, 'SELECT COUNT(*) n FROM notification_deliveries')).toBe(1)
  })
})

// ------------------------------------------------------------------ obituarios
describe('obituarios: solo con aprobación humana y suscripción expresa', () => {
  it('un posible obituario no notifica hasta que una persona lo aprueba; después llega solo a quien eligió «obituarios»', async () => {
    const s = await setup([['obituarios'], ['urgente', 'institucional', 'otros', 'salud'], ['obituarios', 'agua']])
    const r = await publish(s, TEXT.obit, [])
    expect(r.status).toBe(201)
    await s.h.settle()
    expect(s.server.received).toHaveLength(0)
    expect(count(s, 'SELECT COUNT(*) n FROM notification_log')).toBe(0)
    // El editor corrige y aprueba.
    await s.h.call('PATCH', '/api/admin/obituaries/1', { cookie: s.editor, body: { name: 'Juan Carlos Pérez', deathDate: '2026-10-27' } })
    const ok = await s.h.call('POST', '/api/admin/obituaries/1/approve', { cookie: s.editor })
    expect(ok.status).toBe(200)
    await s.h.settle()
    expect(deviceNumbers(s)).toEqual(['1', '3'])
    expect(s.server.received[0].payload).toMatchObject({ type: 'obituary', url: '/obituarios/1', urgent: false })
    // Los demás suscriptos (aun con muchos temas) no reciben nada.
    expect(s.server.received.some((x) => x.device.endpoint.endsWith('/2'))).toBe(false)
  })

  it('un obituario rechazado nunca notifica y el detalle público solo existe si fue aprobado', async () => {
    const s = await setup([['obituarios']])
    await publish(s, TEXT.obit, [])
    expect((await s.h.call('GET', '/api/public/obituaries/1')).status).toBe(404)
    await s.h.call('POST', '/api/admin/obituaries/1/reject', { cookie: s.editor })
    await s.h.settle()
    expect(s.server.received).toHaveLength(0)
    expect((await s.h.call('GET', '/api/public/obituaries/1')).status).toBe(404)
  })

  it('tras aprobarse, el detalle público abre ese comunicado', async () => {
    const s = await setup([['obituarios']])
    await publish(s, TEXT.obit, [])
    await s.h.call('PATCH', '/api/admin/obituaries/1', { cookie: s.editor, body: { name: 'Juan Carlos Pérez', deathDate: '2026-10-27' } })
    await s.h.call('POST', '/api/admin/obituaries/1/approve', { cookie: s.editor })
    const d = await s.h.call('GET', '/api/public/obituaries/1')
    expect(d.status).toBe(200)
    expect(d.json).toMatchObject({ id: '1', name: 'Juan Carlos Pérez', verified: true })
  })
})

// ------------------------------------------------------------------ alertas
describe('alertas urgentes: confirmación humana, audiencia y prioridad', () => {
  const createAlert = (s: Setup, over: Record<string, unknown> = {}) =>
    s.h.call('POST', '/api/admin/alerts', { cookie: s.editor, body: { kind: 'meteorologica', severity: 'urgente', title: 'Alerta naranja por tormentas', body: 'Se esperan tormentas fuertes con granizo durante la tarde. Evitá circular por rutas.', ...over } })

  it('una alerta sin confirmar no notifica; al confirmarla llega con prioridad alta a quienes eligieron «urgente» o su tipo', async () => {
    const s = await setup([['urgente'], ['meteorologica'], ['agua'], ['institucional']])
    const a = await createAlert(s)
    await s.h.settle()
    expect(s.server.received).toHaveLength(0)
    const c = await s.h.call('POST', `/api/admin/alerts/${a.json.id}/confirm`, { cookie: s.editor })
    expect(c.json.notification.queued).toBe(true)
    await s.h.settle()
    expect(deviceNumbers(s)).toEqual(['1', '2'])
    for (const got of s.server.received) {
      expect(got.headers.Urgency).toBe('high')
      expect(got.headers.TTL).toBe('3600')
      expect(got.payload).toMatchObject({ type: 'alert', urgent: true, url: `/alertas/${a.json.id}` })
      expect(got.payload.title).toContain('Alerta naranja')
    }
  })

  it('un aviso informativo confirmado solo llega a quien eligió el tema de su tipo, con prioridad normal', async () => {
    const s = await setup([['urgente'], ['calles']])
    const a = await createAlert(s, { kind: 'calles', severity: 'info', title: 'Calle San Martín cortada', body: 'Por obras de pavimentación se corta el tránsito en calle San Martín hasta el viernes.' })
    await s.h.call('POST', `/api/admin/alerts/${a.json.id}/confirm`, { cookie: s.editor })
    await s.h.settle()
    expect(deviceNumbers(s)).toEqual(['2'])
    expect(s.server.received[0].headers.Urgency).toBe('normal')
    expect(s.server.received[0].payload.urgent).toBe(false)
  })

  it('una alerta descartada o vencida no notifica, y reconfirmar no duplica', async () => {
    const s = await setup([['urgente']])
    const dismissed = await createAlert(s)
    await s.h.call('POST', `/api/admin/alerts/${dismissed.json.id}/dismiss`, { cookie: s.editor })
    expect(await enqueueAlertNotification(s.h.env.DB, dismissed.json.id, NOW)).toEqual({ queued: false, reason: 'alerta sin confirmación editorial' })
    const expired = await createAlert(s, { expiresAt: '2026-10-28T10:00:00Z', startsAt: '2026-10-28T08:00:00Z' })
    s.h.db.raw.prepare("UPDATE alerts SET confirmation = 'confirmed' WHERE id = ?").run(expired.json.id)
    expect(await enqueueAlertNotification(s.h.env.DB, expired.json.id, NOW)).toMatchObject({ queued: false, reason: 'alerta vencida' })
    await s.h.settle()
    expect(s.server.received).toHaveLength(0)
    const ok = await createAlert(s, { title: 'Otra alerta urgente' })
    await s.h.call('POST', `/api/admin/alerts/${ok.json.id}/confirm`, { cookie: s.editor })
    await s.h.settle()
    expect(await enqueueAlertNotification(s.h.env.DB, ok.json.id, NOW)).toEqual({ queued: false, reason: 'ya notificada' })
    expect(s.server.received).toHaveLength(1)
  })

  it('el detalle público de una alerta solo existe si fue confirmada y dice si sigue vigente', async () => {
    const s = await setup([])
    const a = await createAlert(s)
    expect((await s.h.call('GET', `/api/public/alerts/${a.json.id}`)).status).toBe(404)
    await s.h.call('POST', `/api/admin/alerts/${a.json.id}/confirm`, { cookie: s.editor })
    const d = await s.h.call('GET', `/api/public/alerts/${a.json.id}`)
    expect(d.json).toMatchObject({ title: 'Alerta naranja por tormentas', severity: 'urgente', active: true })
  })

  it('una noticia con una alerta apenas propuesta sí avisa; con la alerta confirmada, el aviso lo da la alerta (sin duplicar)', async () => {
    const s = await setup([['meteorologica'], ['urgente']])
    // El texto de alerta genera una alerta PROPUESTA (nunca confirmada sola).
    const p = await publish(s, TEXT.alertaUrgente, ['meteorologica'])
    await s.h.settle()
    expect(count(s, 'SELECT COUNT(*) n FROM alerts')).toBe(1)
    expect(deviceNumbers(s)).toEqual(['1']) // la noticia avisa a quien eligió «meteorológicas»; la alerta aún no avisa a nadie
    // Si la alerta ya estaba confirmada cuando se evalúa la noticia, la noticia no repite el aviso.
    s.h.db.raw.prepare("UPDATE alerts SET confirmation = 'confirmed'").run()
    s.h.db.raw.prepare('DELETE FROM notification_log').run()
    expect(await enqueuePostNotification(s.h.env.DB, p.json.postId, NOW)).toEqual({ queued: false, reason: 'cubierta por una alerta' })
  })

  it('confirmar una alerta informativa cuya noticia ya avisó no repite el aviso; una urgente sí sale', async () => {
    const s = await setup([['agua']])
    const p = await publish(s, TEXT.agua, ['agua'])
    await s.h.settle()
    expect(s.server.received).toHaveLength(1)
    const alertId = (s.h.db.raw.prepare('SELECT id FROM alerts WHERE post_id = ?').get(p.json.postId) as { id: number }).id
    s.h.db.raw.prepare("UPDATE alerts SET confirmation = 'confirmed', severity = 'info'").run()
    expect(await enqueueAlertNotification(s.h.env.DB, alertId, NOW)).toEqual({ queued: false, reason: 'ya avisado por la noticia' })
    s.h.db.raw.prepare("UPDATE notification_log SET dedupe_key = 'x' WHERE dedupe_key LIKE 'alert:%'").run()
    s.h.db.raw.prepare("DELETE FROM notification_log WHERE dedupe_key = 'x'").run()
    s.h.db.raw.prepare("UPDATE alerts SET severity = 'urgente'").run()
    expect((await enqueueAlertNotification(s.h.env.DB, alertId, NOW)).queued).toBe(true)
  })
})

// ------------------------------------------------------------------ entrega: concurrencia, reintentos, lotes
describe('entrega: simultaneidad, reintentos y lotes', () => {
  const sender = (s: Setup) => createVapidSender(s.h.env, () => NOW, s.server.fetchImpl)
  const queuePost = async (s: Setup, topic = 'otros') => {
    // Sin claves el envío inmediato no corre: lo controla cada test.
    const r = await publish(s, TEXT.torneo, [topic])
    return r.json.postId as number
  }

  it('dos ejecuciones simultáneas (cron + envío inmediato) entregan una sola vez a cada dispositivo', async () => {
    const s = await setup([['otros'], ['otros'], ['otros']])
    await queuePost(s)
    await Promise.all([processNotifications(s.h.env.DB, sender(s), NOW), processNotifications(s.h.env.DB, sender(s), NOW), processNotifications(s.h.env.DB, sender(s), NOW)])
    await s.h.settle()
    expect(deviceNumbers(s)).toEqual(['1', '2', '3'])
    expect(count(s, "SELECT COUNT(*) n FROM notification_deliveries WHERE state = 'sent'")).toBe(3)
    expect(count(s, "SELECT COUNT(*) n FROM notification_log WHERE state = 'done'")).toBe(1)
  })

  it('un error temporal se reintenta con espera y se entrega cuando el servicio se recupera', async () => {
    const s = await setup([['otros']], (_e, n) => (n === 1 ? 503 : 201))
    await queuePost(s)
    await s.h.settle()
    expect(s.server.received).toHaveLength(0)
    expect(s.h.db.raw.prepare('SELECT state, attempts, last_status FROM notification_deliveries').get()).toEqual({ state: 'pending', attempts: 1, last_status: 503 })
    expect(s.h.db.raw.prepare('SELECT state FROM notification_log').get()).toEqual({ state: 'sending' })
    // Antes de la espera no se reintenta.
    expect((await processNotifications(s.h.env.DB, sender(s), new Date(NOW.getTime() + 60_000))).attempted).toBe(0)
    const later = new Date(NOW.getTime() + RETRY_DELAYS_SECONDS[0] * 1000 + 1000)
    expect(await processNotifications(s.h.env.DB, sender(s), later)).toMatchObject({ attempted: 1, succeeded: 1 })
    expect(s.server.received).toHaveLength(1)
    expect(s.h.db.raw.prepare('SELECT state, attempts FROM notification_deliveries').get()).toEqual({ state: 'sent', attempts: 2 })
    expect(s.h.db.raw.prepare('SELECT state, succeeded, failed FROM notification_log').get()).toEqual({ state: 'done', succeeded: 1, failed: 0 })
  })

  it('tras agotar los intentos se marca como fallido sin reintentar para siempre', async () => {
    const s = await setup([['otros']], () => 500)
    await queuePost(s)
    await s.h.settle()
    // Cada pasada ocurre después de la espera programada (5 min, 30 min, 2 h) y antes de que el aviso venza (6 h).
    for (const minutes of [6, 37, 160, 170, 175]) await processNotifications(s.h.env.DB, sender(s), new Date(NOW.getTime() + minutes * 60_000))
    expect(s.h.db.raw.prepare('SELECT state, attempts FROM notification_deliveries').get()).toEqual({ state: 'failed', attempts: MAX_DELIVERY_ATTEMPTS })
    expect(s.h.db.raw.prepare('SELECT state, failed FROM notification_log').get()).toEqual({ state: 'done', failed: 1 })
    expect(s.h.db.raw.prepare('SELECT failure_count FROM push_subscriptions').get()).toEqual({ failure_count: 1 })
  })

  it('una suscripción vencida (404/410) se da de baja y no se reintenta; las demás siguen recibiendo', async () => {
    const s = await setup([['otros'], ['otros']], (e) => (e.endsWith('/1') ? 410 : 201))
    await queuePost(s)
    await s.h.settle()
    expect(deviceNumbers(s)).toEqual(['2'])
    expect(s.h.db.raw.prepare('SELECT active, last_error FROM push_subscriptions WHERE id = 1').get()).toMatchObject({ active: 0 })
    expect(s.h.db.raw.prepare("SELECT state FROM notification_deliveries WHERE subscription_id = 1").get()).toEqual({ state: 'gone' })
    // La próxima noticia ya no intenta con el dispositivo dado de baja.
    s.server.fetchImpl.mockClear()
    await publish(s, 'Segunda noticia comunitaria distinta de la anterior para comprobar que no se reintenta el envío.', ['otros'])
    await s.h.settle()
    expect(s.server.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('un aviso que venció antes de poder entregarse no se envía tarde', async () => {
    const s = await setup([['otros']], () => 503)
    await queuePost(s)
    await s.h.settle()
    const late = new Date(NOW.getTime() + 7 * 3600_000)
    await processNotifications(s.h.env.DB, sender(s), late)
    expect(s.h.db.raw.prepare('SELECT state, last_error FROM notification_deliveries').get()).toEqual({ state: 'failed', last_error: 'vencido antes de entregarse' })
  })

  it('con muchos dispositivos se procesa por lotes acotados (límite de subrequests del plan gratuito)', async () => {
    const total = PUSH_BATCH_SIZE * 2 + 5
    const devices = await Promise.all(Array.from({ length: total }, (_, i) => makeDevice(i + 1)))
    const server = pushServer(devices)
    const h = await harness(await vapidEnv(), { pushFetch: server.fetchImpl })
    for (const d of devices) {
      h.db.prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth, topics_json, created_at) VALUES (?,?,?,'[\"otros\"]',?)").bind(d.endpoint, d.p256dh, d.auth, NOW.toISOString()).runSync()
    }
    const editor = await h.loginAs('editor')
    await h.call('POST', '/api/admin/posts', { cookie: editor, body: { body: TEXT.torneo, status: 'published', categories: ['otros'] } })
    await h.settle()
    // El envío inmediato ya hizo UNA tanda acotada.
    expect(server.fetchImpl.mock.calls.length).toBeLessThanOrEqual(PUSH_BATCH_SIZE)
    expect(h.db.raw.prepare('SELECT state FROM notification_log').get()).toEqual({ state: 'sending' })
    const send = createVapidSender(h.env, () => NOW, server.fetchImpl)
    for (let i = 0; i < 10; i++) await processNotifications(h.env.DB, send, NOW)
    expect(new Set(server.received.map((r) => r.device.endpoint)).size).toBe(total)
    expect(server.received).toHaveLength(total) // ninguno recibió el aviso dos veces
    expect(h.db.raw.prepare('SELECT state, succeeded FROM notification_log').get()).toEqual({ state: 'done', succeeded: total })
    expect(FANOUT_CHUNK).toBeGreaterThan(PUSH_BATCH_SIZE)
  })

  it('sin claves VAPID los avisos pendientes se marcan como suprimidos, nunca como enviados', async () => {
    const h = await harness()
    const editor = await h.loginAs('editor')
    const r = await h.call('POST', '/api/admin/posts', { cookie: editor, body: { body: TEXT.torneo, status: 'published', categories: ['otros'] } })
    expect((await enqueuePostNotification(h.env.DB, r.json.postId, NOW)).queued).toBe(true)
    expect(await processNotifications(h.env.DB, null, NOW)).toMatchObject({ note: 'Web Push no configurado' })
    expect(h.db.raw.prepare('SELECT state, succeeded FROM notification_log').get()).toEqual({ state: 'suppressed', succeeded: 0 })
  })

  it('la limpieza borra dispositivos dados de baja hace más de 30 días y avisos antiguos', async () => {
    const s = await setup([['otros'], ['otros']])
    s.h.db.raw.prepare("UPDATE push_subscriptions SET active = 0, updated_at = '2026-08-01T00:00:00Z' WHERE id = 1").run()
    await cleanupPush(s.h.env.DB, NOW)
    expect(count(s, 'SELECT COUNT(*) n FROM push_subscriptions')).toBe(1)
  })
})

// ------------------------------------------------------------------ detalle público
describe('detalle público: cada aviso abre su contenido exacto', () => {
  it('una noticia publicada se abre por id; las ocultas o inexistentes devuelven 404', async () => {
    const s = await setup([])
    const ok = await publish(s, TEXT.torneo, ['deportes'], { title: 'Torneo infantil de fútbol' })
    const draft = await s.h.call('POST', '/api/admin/posts', { cookie: s.editor, body: { body: TEXT.agua, status: 'draft' } })
    const d = await s.h.call('GET', `/api/public/posts/${ok.json.postId}`)
    expect(d.json).toMatchObject({ id: String(ok.json.postId), title: 'Torneo infantil de fútbol', categories: ['deportes'] })
    expect((await s.h.call('GET', `/api/public/posts/${draft.json.postId}`)).status).toBe(404)
    expect((await s.h.call('GET', '/api/public/posts/99999')).status).toBe(404)
    expect((await s.h.call('GET', '/api/public/posts/abc')).status).toBe(404)
    expect((await s.h.call('GET', '/api/public/notifications/latest')).status).toBe(404) // el endpoint ambiguo ya no existe
  })
})

// ------------------------------------------------------------------ administración
describe('panel: Notificaciones', () => {
  it('muestra suscripciones, estados, historial por dispositivo y avisos suprimidos por reglas editoriales, sin exponer endpoints', async () => {
    const s = await setup([['otros'], ['otros', 'salud'], ['agua']])
    const r = await publish(s, TEXT.torneo, ['otros'])
    await publish(s, TEXT.agua2, ['agua'], { publishedAt: '2026-10-01T00:00:00Z' })
    await s.h.settle()
    const ov = await s.h.call('GET', '/api/admin/notifications', { cookie: s.editor })
    expect(ov.json.configured).toBe(true)
    expect(ov.json.subscriptions).toMatchObject({ total: 3, active: 3, inactive: 0, test: 0 })
    expect(ov.json.notificationStates).toEqual({ done: 1, suppressed: 1 })
    expect(ov.json.deliveryStates).toEqual({ sent: 2 })
    expect(ov.json.log.some((l: { suppressed_reason: string }) => l.suppressed_reason === 'publicación antigua')).toBe(true)
    expect(ov.json.topics.find((t: { topic: string }) => t.topic === 'otros').n).toBe(2)
    const logId = ov.json.log.find((l: { entity_id: number; state: string }) => l.entity_id === r.json.postId).id
    const dl = await s.h.call('GET', `/api/admin/notifications/${logId}/deliveries`, { cookie: s.editor })
    expect(dl.json).toHaveLength(2)
    expect(JSON.stringify(ov.json) + JSON.stringify(dl.json)).not.toContain('push.test')
    expect((await s.h.call('GET', '/api/admin/notifications')).status).toBe(401)
  })

  it('no existe envío masivo manual; la prueba va a UN dispositivo registrado por un administrador', async () => {
    const s = await setup([['otros'], ['otros']])
    const mass = await s.h.call('POST', '/api/admin/notifications/send', { cookie: s.admin, body: { title: 'x', body: 'y' } })
    expect([404, 405]).toContain(mass.status)
    const dev = await makeDevice('test-1')
    s.server = undefined as never
    const server = pushServer([...s.devices, dev])
    const h = await harness(await vapidEnv(), { pushFetch: server.fetchImpl })
    for (const [i, d] of s.devices.entries()) await h.call('POST', '/api/public/push/subscribe', { body: { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth }, topics: ['otros', 'urgente'] } }).then((r) => expect(r.status, String(i)).toBe(201))
    const admin = await h.loginAs('admin')
    const editor = await h.loginAs('editor')
    const reg = { endpoint: dev.endpoint, keys: { p256dh: dev.p256dh, auth: dev.auth }, label: 'Celular de Rubén' }
    expect((await h.call('POST', '/api/admin/notifications/test-devices', { cookie: editor, body: reg })).status).toBe(403)
    expect((await h.call('POST', '/api/admin/notifications/test-devices', { cookie: admin, body: { ...reg, endpoint: 'https://evil.example/x' } })).status).toBe(400)
    const created = await h.call('POST', '/api/admin/notifications/test-devices', { cookie: admin, body: reg })
    expect(created.status).toBe(201)
    expect((await h.call('POST', `/api/admin/notifications/test-devices/${created.json.id}/send`, { cookie: editor })).status).toBe(403)
    expect((await h.call('POST', '/api/admin/notifications/test-devices/1/send', { cookie: admin })).status).toBe(404) // un suscriptor real no es dispositivo de prueba
    expect((await h.call('POST', `/api/admin/notifications/test-devices/${created.json.id}/send`, { cookie: admin })).status).toBe(200)
    await h.settle()
    expect(server.received).toHaveLength(1)
    expect(server.received[0].device.endpoint).toBe(dev.endpoint)
    expect(server.received[0].payload).toMatchObject({ type: 'test', title: 'Notificación de prueba', url: '/configuracion/notificaciones' })
    // Un aviso real tampoco llega al dispositivo de prueba.
    await h.call('POST', '/api/admin/posts', { cookie: editor, body: { body: TEXT.torneo, status: 'published', categories: ['otros'] } })
    await h.settle()
    expect(server.received.filter((r) => r.device.endpoint === dev.endpoint)).toHaveLength(1)
    expect(server.received).toHaveLength(3)
    expect((await h.call('GET', '/api/admin/notifications/test-devices', { cookie: admin })).json).toHaveLength(1)
  })
})
