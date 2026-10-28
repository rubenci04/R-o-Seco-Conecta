import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bytesToB64url } from '@shared/pushEndpoints'
import { detectSupport, disablePush, enablePush, getPushStatus, PushError, updatePushTopics } from './push'

const PUBLIC_KEY = bytesToB64url(Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i)))
const sub = (endpoint = 'https://fcm.googleapis.com/fcm/send/abc') => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: 'P', auth: 'A' } }),
  unsubscribe: vi.fn(async () => true),
})

type Sub = ReturnType<typeof sub>
interface World {
  subscription: Sub | null
  permission: NotificationPermission
  requestPermission: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  routes: Record<string, (body: Record<string, unknown>) => { status: number; body?: unknown } | 'offline'>
  fetchMock: ReturnType<typeof vi.fn>
}

function setupWorld(over: Partial<{ permission: NotificationPermission; subscription: Sub | null; ua: string; standalone: boolean; support: boolean; enabled: boolean }> = {}): World {
  const w: World = {
    subscription: over.subscription ?? null,
    permission: over.permission ?? 'default',
    requestPermission: vi.fn(),
    subscribe: vi.fn(),
    routes: {},
    fetchMock: vi.fn(),
  }
  w.requestPermission.mockImplementation(async () => {
    w.permission = 'granted'
    return 'granted'
  })
  w.subscribe.mockImplementation(async () => (w.subscription = sub('https://fcm.googleapis.com/fcm/send/new')))
  w.routes['/api/public/push/config'] = () => ({ status: 200, body: { enabled: over.enabled ?? true, publicKey: PUBLIC_KEY, topics: [] } })
  w.fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
    const handler = w.routes[path]
    if (!handler) return new Response(JSON.stringify({ error: 'no' }), { status: 404 })
    const r = handler(init?.body ? JSON.parse(String(init.body)) : {})
    if (r === 'offline') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status })
  })
  vi.stubGlobal('fetch', w.fetchMock)
  vi.stubGlobal('navigator', {
    userAgent: over.ua ?? 'Mozilla/5.0 (Linux; Android 14) Chrome/130',
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    standalone: over.standalone,
    ...(over.support === false ? {} : { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => w.subscription, subscribe: w.subscribe } }) } }),
  })
  vi.stubGlobal('Notification', Object.assign(function Notification() {}, { requestPermission: w.requestPermission }))
  Object.defineProperty(globalThis.Notification, 'permission', { get: () => w.permission, configurable: true })
  if (over.support === false) delete (window as unknown as Record<string, unknown>).PushManager
  else vi.stubGlobal('PushManager', function PushManager() {})
  return w
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('compatibilidad del navegador', () => {
  it('Android/escritorio compatibles', () => {
    setupWorld()
    expect(detectSupport()).toBe('ok')
  })
  it('navegador sin Push', async () => {
    setupWorld({ support: false })
    expect(detectSupport()).toBe('unsupported')
    expect(await getPushStatus()).toEqual({ kind: 'unsupported' })
  })
  it('iPhone sin instalar la app: pide instalarla y no consulta nada', async () => {
    const w = setupWorld({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/605', standalone: false })
    expect(await getPushStatus()).toEqual({ kind: 'ios-install' })
    expect(w.fetchMock).not.toHaveBeenCalled()
    await expect(enablePush(['agua'])).rejects.toMatchObject({ code: 'ios-install' })
  })
  it('iPhone con la app instalada puede activar', () => {
    setupWorld({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/605', standalone: true })
    expect(detectSupport()).toBe('ok')
  })
})

describe('estado de las notificaciones', () => {
  it('nunca pide permiso por sí solo al consultar el estado', async () => {
    const w = setupWorld()
    expect(await getPushStatus()).toEqual({ kind: 'off', permissionGranted: false })
    expect(w.requestPermission).not.toHaveBeenCalled()
    expect(w.subscribe).not.toHaveBeenCalled()
  })
  it('permiso ya concedido pero sin suscripción', async () => {
    setupWorld({ permission: 'granted' })
    expect(await getPushStatus()).toEqual({ kind: 'off', permissionGranted: true })
  })
  it('permiso denegado', async () => {
    setupWorld({ permission: 'denied' })
    expect(await getPushStatus()).toEqual({ kind: 'denied' })
  })
  it('servidor sin notificaciones habilitadas', async () => {
    setupWorld({ enabled: false })
    expect(await getPushStatus()).toEqual({ kind: 'unavailable' })
  })
  it('error de conexión al consultar la configuración', async () => {
    const w = setupWorld()
    w.routes['/api/public/push/config'] = () => 'offline'
    expect(await getPushStatus()).toMatchObject({ kind: 'error' })
  })
  it('suscripción vencida: había una guardada pero el navegador ya no la tiene', async () => {
    setupWorld({ permission: 'granted' })
    localStorage.setItem('rsc-push', JSON.stringify({ endpoint: 'https://fcm.googleapis.com/x', token: 't', topics: ['agua'] }))
    expect(await getPushStatus()).toEqual({ kind: 'expired' })
  })
  it('suscripción vencida en el servidor (dada de baja tras un 410)', async () => {
    const s = sub()
    const w = setupWorld({ permission: 'granted', subscription: s })
    localStorage.setItem('rsc-push', JSON.stringify({ endpoint: s.endpoint, token: 't', topics: ['agua'] }))
    w.routes['/api/public/push/status'] = () => ({ status: 200, body: { registered: true, active: false } })
    expect(await getPushStatus()).toEqual({ kind: 'expired' })
  })
  it('activa y verificada; sin conexión muestra lo último conocido avisando que no se verificó', async () => {
    const s = sub()
    const w = setupWorld({ permission: 'granted', subscription: s })
    localStorage.setItem('rsc-push', JSON.stringify({ endpoint: s.endpoint, token: 't', topics: ['agua'] }))
    w.routes['/api/public/push/status'] = () => ({ status: 200, body: { registered: true, active: true, topics: ['agua', 'urgente'] } })
    expect(await getPushStatus()).toEqual({ kind: 'on', topics: ['agua', 'urgente'], verified: true })
    w.routes['/api/public/push/status'] = () => 'offline'
    expect(await getPushStatus()).toEqual({ kind: 'on', topics: ['agua', 'urgente'], verified: false })
  })
})

describe('activar, guardar y desactivar', () => {
  it('pide el permiso UNA vez al activar, suscribe con la clave pública y guarda el token', async () => {
    const w = setupWorld()
    w.routes['/api/public/push/subscribe'] = (b) => ({ status: 201, body: { ok: true, token: 'tok-1', topics: b.topics } })
    await enablePush(['agua', 'urgente'])
    expect(w.requestPermission).toHaveBeenCalledTimes(1)
    expect(w.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) })
    expect(w.subscribe.mock.calls[0][0].applicationServerKey).toHaveLength(65)
    const sent = JSON.parse(String(w.fetchMock.mock.calls.find((c) => c[0] === '/api/public/push/subscribe')![1].body))
    expect(sent).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys: { p256dh: 'P', auth: 'A' }, topics: ['agua', 'urgente'] })
    expect(JSON.parse(localStorage.getItem('rsc-push')!)).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', token: 'tok-1', topics: ['agua', 'urgente'] })
  })

  it('si la persona rechaza el permiso, no suscribe ni registra nada', async () => {
    const w = setupWorld()
    w.requestPermission.mockResolvedValue('denied')
    await expect(enablePush(['agua'])).rejects.toMatchObject({ code: 'denied' })
    expect(w.subscribe).not.toHaveBeenCalled()
    expect(w.fetchMock.mock.calls.some((c) => c[0] === '/api/public/push/subscribe')).toBe(false)
    expect(localStorage.getItem('rsc-push')).toBeNull()
  })

  it('exige al menos un tema y que el servidor las tenga habilitadas', async () => {
    setupWorld()
    await expect(enablePush([])).rejects.toBeInstanceOf(PushError)
    const w = setupWorld({ enabled: false })
    await expect(enablePush(['agua'])).rejects.toMatchObject({ code: 'unavailable' })
    expect(w.requestPermission).not.toHaveBeenCalled()
  })

  it('error de conexión y error del servidor se informan con mensajes distintos', async () => {
    const w = setupWorld()
    w.routes['/api/public/push/subscribe'] = () => 'offline'
    await expect(enablePush(['agua'])).rejects.toMatchObject({ code: 'network' })
    w.routes['/api/public/push/subscribe'] = () => ({ status: 500 })
    await expect(enablePush(['agua'])).rejects.toMatchObject({ code: 'server' })
    w.routes['/api/public/push/subscribe'] = () => ({ status: 429, body: { error: 'x' } })
    await expect(enablePush(['agua'])).rejects.toMatchObject({ code: 'server', message: expect.stringContaining('muchos intentos') })
  })

  it('si el servidor rechaza el endpoint por token perdido (403), renueva la suscripción del navegador y reintenta', async () => {
    const old = sub('https://fcm.googleapis.com/fcm/send/old')
    const w = setupWorld({ permission: 'granted', subscription: old })
    let calls = 0
    w.routes['/api/public/push/subscribe'] = () => (++calls === 1 ? { status: 403, body: { error: 'ya registrado' } } : { status: 201, body: { token: 'nuevo' } })
    await enablePush(['agua'])
    expect(old.unsubscribe).toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('rsc-push')!)).toMatchObject({ token: 'nuevo', endpoint: 'https://fcm.googleapis.com/fcm/send/new' })
  })

  it('guardar preferencias usa el token del dispositivo; una suscripción vencida se informa', async () => {
    const w = setupWorld({ permission: 'granted', subscription: sub() })
    localStorage.setItem('rsc-push', JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', token: 'T', topics: ['agua'] }))
    w.routes['/api/public/push/preferences'] = (b) => ({ status: 200, body: { ok: true, topics: b.topics } })
    await updatePushTopics(['agua', 'salud'])
    expect(JSON.parse(String(w.fetchMock.mock.calls.at(-1)![1].body))).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', token: 'T', topics: ['agua', 'salud'] })
    expect(JSON.parse(localStorage.getItem('rsc-push')!).topics).toEqual(['agua', 'salud'])
    w.routes['/api/public/push/preferences'] = () => ({ status: 404 })
    await expect(updatePushTopics(['agua'])).rejects.toMatchObject({ message: expect.stringContaining('venció') })
    await expect(updatePushTopics([])).rejects.toBeInstanceOf(PushError)
  })

  it('desactivar da de baja en el servidor y en el navegador y borra lo guardado; sin conexión igual se desactiva acá', async () => {
    const s = sub()
    const w = setupWorld({ permission: 'granted', subscription: s })
    localStorage.setItem('rsc-push', JSON.stringify({ endpoint: s.endpoint, token: 'T', topics: ['agua'] }))
    w.routes['/api/public/push/unsubscribe'] = () => ({ status: 200, body: { ok: true } })
    expect(await disablePush()).toEqual({ serverNotified: true })
    expect(s.unsubscribe).toHaveBeenCalled()
    expect(localStorage.getItem('rsc-push')).toBeNull()

    const s2 = sub()
    const w2 = setupWorld({ permission: 'granted', subscription: s2 })
    localStorage.setItem('rsc-push', JSON.stringify({ endpoint: s2.endpoint, token: 'T', topics: ['agua'] }))
    w2.routes['/api/public/push/unsubscribe'] = () => 'offline'
    expect(await disablePush()).toEqual({ serverNotified: false })
    expect(s2.unsubscribe).toHaveBeenCalled()
    expect(localStorage.getItem('rsc-push')).toBeNull()
  })
})
