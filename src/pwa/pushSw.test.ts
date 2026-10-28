import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pwaOptions } from '../../pwa/pwa.config'

type Listener = (event: unknown) => void
interface FakeClient {
  url: string
  focus: ReturnType<typeof vi.fn>
  navigate?: ReturnType<typeof vi.fn>
  postMessage: ReturnType<typeof vi.fn>
}

const ORIGIN = 'https://app.test'
const listeners: Record<string, Listener> = {}
const showNotification = vi.fn()
const matchAll = vi.fn<() => Promise<FakeClient[]>>()
const openWindow = vi.fn()

const fakeSelf: Record<string, unknown> = {
  registration: { showNotification },
  location: { origin: ORIGIN },
  clients: { matchAll, openWindow },
  addEventListener: (type: string, fn: Listener) => {
    listeners[type] = fn
  },
}
vi.stubGlobal('self', fakeSelf)
createRequire(import.meta.url)('../../public/push-sw.js')
const sw = fakeSelf.rscPush as {
  parsePushPayload: (d: unknown) => { id: number; title: string; body: string; url: string; urgent: boolean }
  safeAppPath: (v: unknown) => string
  PUSH_FALLBACK: { title: string; url: string }
}

/** Dispara el evento `push` como lo haría el navegador y espera a que el service worker termine de trabajar. */
async function push(data: unknown, opts: { raw?: string; noData?: boolean } = {}) {
  let pending: Promise<unknown> = Promise.resolve()
  listeners.push({
    data: opts.noData ? null : { json: () => (opts.raw !== undefined ? JSON.parse(opts.raw) : data) },
    waitUntil: (p: Promise<unknown>) => (pending = p),
  })
  await pending
}
async function click(notification: { data?: { url?: string }; close?: () => void }) {
  let pending: Promise<unknown> = Promise.resolve()
  const close = notification.close ?? vi.fn()
  listeners.notificationclick({ notification: { ...notification, close }, waitUntil: (p: Promise<unknown>) => (pending = p) })
  await pending
  return close
}

const payload = (over: Record<string, unknown> = {}) => ({ v: 1, id: 12, type: 'post', title: 'Horario especial de la Comuna', body: 'La oficina atenderá en horario especial.', url: '/noticias/12', urgent: false, ...over })

beforeEach(() => {
  showNotification.mockReset()
  matchAll.mockReset()
  openWindow.mockReset()
})

describe('service worker: push', () => {
  it('registra los manejadores en el MISMO service worker (importScripts), sin un segundo SW', () => {
    expect(typeof listeners.push).toBe('function')
    expect(typeof listeners.notificationclick).toBe('function')
    expect(pwaOptions.workbox?.importScripts).toEqual(['push-sw.js'])
    expect(pwaOptions.registerType).toBe('autoUpdate')
  })

  it('muestra el título, el texto y la dirección de ESE aviso, con identificador propio', async () => {
    await push(payload())
    expect(showNotification).toHaveBeenCalledTimes(1)
    const [title, opts] = showNotification.mock.calls[0]
    expect(title).toBe('Horario especial de la Comuna')
    expect(opts).toMatchObject({ body: 'La oficina atenderá en horario especial.', tag: 'rsc-12', lang: 'es-AR', requireInteraction: false, data: { url: '/noticias/12', id: 12 } })
  })

  it('dos avisos distintos nunca comparten contenido ni etiqueta', async () => {
    await push(payload({ id: 1, title: 'Torneo de fútbol', url: '/noticias/1' }))
    await push(payload({ id: 2, title: 'Corte de agua', url: '/noticias/2', body: 'Barrio Norte' }))
    expect(showNotification.mock.calls.map((c) => [c[0], c[1].tag, c[1].data.url])).toEqual([
      ['Torneo de fútbol', 'rsc-1', '/noticias/1'],
      ['Corte de agua', 'rsc-2', '/noticias/2'],
    ])
  })

  it('una alerta urgente exige interacción', async () => {
    await push(payload({ id: 5, type: 'alert', urgent: true, url: '/alertas/5' }))
    expect(showNotification.mock.calls[0][1]).toMatchObject({ requireInteraction: true, data: { url: '/alertas/5' } })
  })

  it('jamás es silenciosa: si el mensaje no se puede interpretar, muestra un aviso genérico que solo abre la app', async () => {
    await push(null, { noData: true })
    await push(null, { raw: '{no es json' })
    await push({ v: 2, title: 'versión desconocida' })
    await push({ v: 1, title: '   ' })
    expect(showNotification).toHaveBeenCalledTimes(4)
    for (const c of showNotification.mock.calls) {
      expect(c[0]).toBe(sw.PUSH_FALLBACK.title)
      expect(c[1].data.url).toBe('/')
    }
  })

  it('solo acepta direcciones internas: un enlace externo o con esquema se reemplaza por el inicio', () => {
    for (const bad of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '\\evil', undefined, 5, '']) expect(sw.safeAppPath(bad)).toBe('/')
    expect(sw.safeAppPath('/noticias/9?x=1')).toBe('/noticias/9?x=1')
    expect(sw.parsePushPayload(payload({ url: 'https://evil.example' })).url).toBe('/')
  })

  it('recorta títulos y textos excesivos', () => {
    const p = sw.parsePushPayload(payload({ title: 'a'.repeat(500), body: 'b'.repeat(900) }))
    expect(p.title).toHaveLength(120)
    expect(p.body).toHaveLength(240)
  })
})

describe('service worker: toque en la notificación', () => {
  const client = (url: string, withNavigate = true): FakeClient => ({ url, focus: vi.fn(async () => undefined), navigate: withNavigate ? vi.fn(async () => undefined) : undefined, postMessage: vi.fn() })

  it('sin ventanas abiertas, abre el contenido exacto', async () => {
    matchAll.mockResolvedValue([])
    const close = await click({ data: { url: '/noticias/12' } })
    expect(close).toHaveBeenCalled()
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/noticias/12`)
  })

  it('con la app abierta reutiliza la ventana (no duplica) y navega a la publicación', async () => {
    const c = client(`${ORIGIN}/agenda`)
    matchAll.mockResolvedValue([c])
    await click({ data: { url: '/alertas/5' } })
    expect(c.focus).toHaveBeenCalled()
    expect(c.navigate).toHaveBeenCalledWith(`${ORIGIN}/alertas/5`)
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('si el navegador no permite navigate(), avisa a la app por mensaje', async () => {
    const c = client(`${ORIGIN}/`, false)
    matchAll.mockResolvedValue([c])
    await click({ data: { url: '/noticias/7' } })
    expect(c.postMessage).toHaveBeenCalledWith({ type: 'rsc-open', url: `${ORIGIN}/noticias/7` })
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('ignora ventanas de otros orígenes y, si una ventana falla, abre una nueva', async () => {
    const foreign = client('https://otro.example/')
    const broken = client(`${ORIGIN}/`)
    broken.focus.mockRejectedValue(new Error('cerrada'))
    matchAll.mockResolvedValue([foreign, broken])
    await click({ data: { url: '/noticias/3' } })
    expect(foreign.focus).not.toHaveBeenCalled()
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/noticias/3`)
  })

  it('una notificación sin dirección o con dirección externa abre el inicio', async () => {
    matchAll.mockResolvedValue([])
    await click({})
    await click({ data: { url: 'https://evil.example' } })
    expect(openWindow.mock.calls.map((c) => c[0])).toEqual([`${ORIGIN}/`, `${ORIGIN}/`])
  })
})

describe('configuración del service worker (caché y rutas)', () => {
  const wb = pwaOptions.workbox!
  it('conserva la exclusión de la API del fallback, el mapa fuera del precaché y nunca guarda la API administrativa', () => {
    expect(wb.navigateFallbackDenylist).toEqual([/^\/api\//])
    expect(wb.globIgnores).toEqual(expect.arrayContaining(['**/PlacesMap-*.{js,css}', '**/AdminApp-*.js']))
    const rules = (wb.runtimeCaching ?? []) as Array<{ urlPattern: (a: { url: URL; sameOrigin: boolean }) => boolean; handler: string }>
    const handles = (path: string) => rules.filter((r) => r.urlPattern({ url: new URL(path, ORIGIN), sameOrigin: true })).map((r) => r.handler)
    expect(handles('/api/admin/notifications')).toEqual([])
    expect(handles('/api/admin/me')).toEqual([])
    expect(handles('/api/public/push/status')).toEqual(['NetworkFirst']) // solo GET se guarda; los POST de suscripción nunca pasan por la caché
  })
})
