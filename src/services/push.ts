import type { PushTopic } from '@shared/categories'
import { b64urlToBytes } from '@shared/pushEndpoints'
import type { TopicInfo } from '@shared/pushTopics'

/**
 * Notificaciones push desde el navegador. Principios:
 *  - Nunca se pide el permiso por sí solo: `enable()` solo se llama desde un botón que toca la persona.
 *  - El token de gestión del dispositivo se guarda solo acá (localStorage); el servidor guarda únicamente su hash.
 *  - No hay cuentas ni datos personales: el servidor conoce el endpoint del navegador y los temas elegidos.
 */
const STORAGE_KEY = 'rsc-push'

export type PushStatus =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'ios-install' }
  | { kind: 'unavailable' }
  | { kind: 'denied' }
  | { kind: 'off'; permissionGranted: boolean }
  | { kind: 'on'; topics: PushTopic[]; verified: boolean }
  | { kind: 'expired' }
  | { kind: 'error'; message: string }

export class PushError extends Error {
  constructor(
    readonly code: 'unsupported' | 'ios-install' | 'unavailable' | 'denied' | 'network' | 'server' | 'browser',
    message: string,
  ) {
    super(message)
    this.name = 'PushError'
  }
}

export const MESSAGES = {
  network: 'No pudimos conectar con el servidor. Revisá tu conexión e intentá de nuevo.',
  server: 'El servidor tuvo un problema. Intentá de nuevo en unos minutos.',
  denied: 'El permiso de notificaciones está bloqueado para este sitio.',
  browser: 'Tu navegador no pudo activar las notificaciones. Intentá de nuevo.',
} as const

interface Stored {
  endpoint: string
  token: string
  topics: PushTopic[]
}

function loadStored(): Stored | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Stored | null
    return raw && typeof raw.endpoint === 'string' && typeof raw.token === 'string' && Array.isArray(raw.topics) ? raw : null
  } catch {
    return null
  }
}
function saveStored(s: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // Sin almacenamiento disponible: la suscripción sigue funcionando, pero no se podrá administrar luego.
  }
}
function clearStored(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // nada que limpiar
  }
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true

/** ¿Este navegador puede recibir push? En iPhone/iPad solo con la app instalada en la pantalla de inicio (iOS 16.4+). */
export function detectSupport(): 'ok' | 'unsupported' | 'ios-install' {
  if (isIos() && !isInstalled()) return 'ios-install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'ok'
}

export interface PushConfig {
  enabled: boolean
  publicKey: string | null
  topics: Array<{ id: PushTopic } & TopicInfo>
}

async function api<T>(path: string, init?: { method: 'GET' | 'POST'; body?: unknown }): Promise<{ status: number; data: T }> {
  let res: Response
  try {
    res = await fetch(path, {
      method: init?.method ?? 'GET',
      headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new PushError('network', MESSAGES.network)
  }
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // respuesta sin cuerpo
  }
  return { status: res.status, data: data as T }
}

export const fetchPushConfig = async (): Promise<PushConfig> => {
  const r = await api<PushConfig>('/api/public/push/config')
  if (r.status >= 500) throw new PushError('server', MESSAGES.server)
  if (r.status !== 200 || !r.data) throw new PushError('unavailable', 'Las notificaciones todavía no están disponibles.')
  return r.data
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]).catch(() => null)
  if (!reg) throw new PushError('browser', 'La aplicación todavía no terminó de prepararse. Recargá la página e intentá de nuevo.')
  return reg
}

/** Estado actual de este dispositivo. No muestra ningún diálogo ni pide permisos. */
export async function getPushStatus(): Promise<PushStatus> {
  const support = detectSupport()
  if (support !== 'ok') return { kind: support }
  let config: PushConfig
  try {
    config = await fetchPushConfig()
  } catch (e) {
    if (e instanceof PushError && e.code === 'unavailable') return { kind: 'unavailable' }
    return { kind: 'error', message: e instanceof Error ? e.message : MESSAGES.network }
  }
  if (!config.enabled) return { kind: 'unavailable' }
  if (Notification.permission === 'denied') return { kind: 'denied' }
  let sub: PushSubscription | null
  try {
    sub = await (await registration()).pushManager.getSubscription()
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : MESSAGES.browser }
  }
  const stored = loadStored()
  if (!sub) return stored ? { kind: 'expired' } : { kind: 'off', permissionGranted: Notification.permission === 'granted' }
  if (!stored || stored.endpoint !== sub.endpoint) return { kind: 'expired' }
  try {
    const r = await api<{ registered: boolean; active?: boolean; topics?: PushTopic[] }>('/api/public/push/status', { method: 'POST', body: { endpoint: stored.endpoint, token: stored.token } })
    if (r.status === 200 && r.data.registered && r.data.active) {
      saveStored({ ...stored, topics: r.data.topics ?? stored.topics })
      return { kind: 'on', topics: r.data.topics ?? stored.topics, verified: true }
    }
    return { kind: 'expired' }
  } catch {
    // Sin conexión: se muestra lo último que sabemos, avisando que no se pudo verificar.
    return { kind: 'on', topics: stored.topics, verified: false }
  }
}

async function subscribeBrowser(reg: ServiceWorkerRegistration, publicKey: string): Promise<PushSubscription> {
  try {
    return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(publicKey) })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotAllowedError') throw new PushError('denied', MESSAGES.denied)
    throw new PushError('browser', MESSAGES.browser)
  }
}

function keysOf(sub: PushSubscription): { p256dh: string; auth: string } {
  const json = sub.toJSON()
  return { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' }
}

/** Activa las notificaciones con los temas elegidos. LLAMAR SOLO DESDE UN CLIC: acá se pide el permiso del navegador. */
export async function enablePush(topics: PushTopic[]): Promise<void> {
  const support = detectSupport()
  if (support !== 'ok') throw new PushError(support, support === 'ios-install' ? 'Instalá la aplicación en la pantalla de inicio para recibir notificaciones.' : 'Este navegador no permite recibir notificaciones.')
  if (!topics.length) throw new PushError('browser', 'Elegí al menos un tema.')
  const config = await fetchPushConfig()
  if (!config.enabled || !config.publicKey) throw new PushError('unavailable', 'Las notificaciones todavía no están disponibles.')
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') throw new PushError('denied', MESSAGES.denied)
  const reg = await registration()
  let sub = (await reg.pushManager.getSubscription()) ?? (await subscribeBrowser(reg, config.publicKey))
  const send = async (s: PushSubscription, token?: string) =>
    api<{ token?: string }>('/api/public/push/subscribe', { method: 'POST', body: { endpoint: s.endpoint, keys: keysOf(s), topics, ...(token ? { token } : {}) } })
  const stored = loadStored()
  let res = await send(sub, stored?.endpoint === sub.endpoint ? stored.token : undefined)
  if (res.status === 403) {
    // Esta suscripción ya existía pero se perdió el token: se renueva la suscripción del navegador y se registra de nuevo.
    await sub.unsubscribe().catch(() => false)
    sub = await subscribeBrowser(reg, config.publicKey)
    res = await send(sub)
  }
  if (res.status >= 500 || res.status === 429) throw new PushError('server', res.status === 429 ? 'Hiciste muchos intentos. Esperá un rato y probá de nuevo.' : MESSAGES.server)
  if (res.status === 503) throw new PushError('unavailable', 'Las notificaciones todavía no están disponibles.')
  if (res.status >= 400) throw new PushError('server', (res.data as { error?: string } | null)?.error ?? MESSAGES.server)
  const token = res.data?.token ?? (stored?.endpoint === sub.endpoint ? stored.token : '')
  if (!token) throw new PushError('server', MESSAGES.server)
  saveStored({ endpoint: sub.endpoint, token, topics })
}

export async function updatePushTopics(topics: PushTopic[]): Promise<void> {
  const stored = loadStored()
  if (!stored) throw new PushError('browser', 'Este dispositivo no tiene notificaciones activadas.')
  if (!topics.length) throw new PushError('browser', 'Elegí al menos un tema o desactivá las notificaciones.')
  const r = await api('/api/public/push/preferences', { method: 'POST', body: { endpoint: stored.endpoint, token: stored.token, topics } })
  if (r.status === 404 || r.status === 403) throw new PushError('server', 'La suscripción venció. Activá las notificaciones de nuevo.')
  if (r.status >= 400) throw new PushError('server', MESSAGES.server)
  saveStored({ ...stored, topics })
}

/** Desactiva en este dispositivo y en el servidor. Si no hay conexión, igualmente se desactiva acá y se informa. */
export async function disablePush(): Promise<{ serverNotified: boolean }> {
  const stored = loadStored()
  let serverNotified = true
  if (stored) {
    try {
      await api('/api/public/push/unsubscribe', { method: 'POST', body: { endpoint: stored.endpoint, token: stored.token } })
    } catch {
      serverNotified = false
    }
  }
  try {
    const sub = await (await registration()).pushManager.getSubscription()
    await sub?.unsubscribe()
  } catch {
    // el navegador ya no tiene la suscripción
  }
  clearStored()
  return { serverNotified }
}
