import { webcrypto as crypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'

/**
 * Notificaciones push de punta a punta contra el Worker REAL (wrangler dev, D1 local aislada, claves VAPID efímeras) y un
 * servidor push SIMULADO (e2e/worker-server.mjs). El navegador no se suscribe a un servicio push real: la API de suscripción
 * del navegador está reemplazada por una simulada con claves P-256 reales, de modo que el contenido cifrado que envía el
 * Worker se descifra acá exactamente como lo haría un teléfono. NO prueba la recepción en Android ni en iPhone.
 */
test.describe.configure({ mode: 'serial', timeout: 90_000 })

const MOCK = 'http://127.0.0.1:8799'
const creds = () => JSON.parse(readFileSync('.wrangler/e2e-admin.json', 'utf8')) as { email: string; password: string }
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url')
const fromB64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url')) as Uint8Array<ArrayBuffer>

interface Device {
  name: string
  endpoint: string
  p256dh: string
  auth: string
  privateKey: CryptoKey
  publicRaw: Uint8Array<ArrayBuffer>
}
async function makeDevice(name: string): Promise<Device> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)) as Uint8Array<ArrayBuffer>
  return { name, endpoint: `${MOCK}/push/${name}`, p256dh: b64u(publicRaw), auth: b64u(crypto.getRandomValues(new Uint8Array(16))), privateKey: kp.privateKey, publicRaw }
}
const hkdf = async (salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, len: number) =>
  new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), len * 8))
const cat = (...p: Uint8Array[]) => Uint8Array.from(p.flatMap((x) => [...x])) as Uint8Array<ArrayBuffer>
const text = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>

async function decrypt(bodyB64: string, dev: Device) {
  const body = fromB64u(bodyB64)
  const salt = body.slice(0, 16)
  const asPublic = body.slice(21, 21 + body[20])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, dev.privateKey, 256))
  const ikm = await hkdf(fromB64u(dev.auth), ecdh, cat(text('WebPush: info\0'), dev.publicRaw, asPublic), 32)
  const cek = await hkdf(salt, ikm, text('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, text('Content-Encoding: nonce\0'), 12)
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), body.slice(21 + body[20])))
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1))) as { id: number; type: string; title: string; body: string; url: string; urgent: boolean }
}

interface Hit {
  path: string
  status: number
  headers: Record<string, string>
  body: string
}
const hits = async (request: APIRequestContext, device: Device): Promise<Hit[]> => ((await (await request.get(`${MOCK}/__received`)).json()) as Hit[]).filter((h) => h.path === `/push/${device.name}`)
async function waitForHits(request: APIRequestContext, device: Device, n: number) {
  await expect.poll(async () => (await hits(request, device)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(n)
  return hits(request, device)
}
/** Margen para confirmar que NO llegó nada (el envío inmediato ocurre en segundo plano al publicar). */
const settle = (page: Page) => page.waitForTimeout(1500)

async function adminLogin(request: APIRequestContext) {
  const { email, password } = creds()
  const res = await request.post('/api/admin/login', { headers: { 'x-rsc-csrf': '1' }, data: { email, password } })
  expect(res.status()).toBe(200)
}
const api = (request: APIRequestContext) => ({
  post: async (path: string, data: unknown = {}) => request.post(`/api/admin${path}`, { headers: { 'x-rsc-csrf': '1' }, data }),
  get: async (path: string) => request.get(`/api/admin${path}`, { headers: { 'x-rsc-csrf': '1' } }),
})

/** Reemplaza la API de suscripción push del navegador por una simulada con las claves del dispositivo de prueba. */
async function fakeBrowserPush(target: Page | BrowserContext, d: Device) {
  await target.addInitScript((dev) => {
    const makeSub = () => ({
      endpoint: dev.endpoint,
      toJSON: () => ({ endpoint: dev.endpoint, keys: { p256dh: dev.p256dh, auth: dev.auth } }),
      unsubscribe: async () => {
        localStorage.removeItem('__fakeSub')
        return true
      },
    })
    PushManager.prototype.getSubscription = async () => (localStorage.getItem('__fakeSub') ? (makeSub() as unknown as PushSubscription) : null)
    PushManager.prototype.subscribe = async () => {
      localStorage.setItem('__fakeSub', '1')
      return makeSub() as unknown as PushSubscription
    }
    Object.defineProperty(Notification, 'permission', { get: () => localStorage.getItem('__perm') ?? 'default', configurable: true })
    Notification.requestPermission = async () => {
      localStorage.setItem('__perm', 'granted')
      return 'granted'
    }
  }, { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth })
}

let dev1: Device
let dev2: Device
let dev3: Device
// El teléfono de dev1 es UN navegador que persiste entre pruebas (guarda su token y su suscripción, como en la vida real).
let phone: BrowserContext
let page1: Page
test.beforeAll(async ({ request, browser }) => {
  ;[dev1, dev2, dev3] = await Promise.all([makeDevice('dev1'), makeDevice('dev2'), makeDevice('dev3')])
  await request.get(`${MOCK}/__reset`)
  phone = await browser.newContext({ baseURL: 'http://localhost:8787' })
  await fakeBrowserPush(phone, dev1)
  page1 = await phone.newPage()
})
test.afterAll(async () => {
  await phone?.close()
})

const publishNews = async (request: APIRequestContext, title: string, body: string, categories: string[]) => {
  const res = await api(request).post('/posts', { title, body, status: 'published', categories })
  expect(res.status()).toBe(201)
  return ((await res.json()) as { postId: number }).postId
}
const stamp = Date.now()

test('el vecino activa las notificaciones desde la pantalla; el permiso solo se pide al tocar el botón', async ({ request }) => {
  const page = page1
  await adminLogin(request)
  await page.goto('/configuracion/notificaciones')
  await expect(page.getByRole('heading', { name: 'Mis notificaciones' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Activar notificaciones/ })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('__perm'))).toBeNull() // abrir la pantalla no pidió permiso
  await page.getByRole('checkbox', { name: /Noticias institucionales/ }).check()
  await page.getByRole('button', { name: /Activar notificaciones/ }).click()
  await expect(page.getByText(/las notificaciones quedaron activadas/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Desactivar notificaciones' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('__perm'))).toBe('granted')

  const overview = await (await api(request).get('/notifications')).json()
  expect(overview.subscriptions).toMatchObject({ active: 1 })
  expect(overview.topics.map((t: { topic: string }) => t.topic)).toEqual(expect.arrayContaining(['institucional', 'urgente', 'agua']))

  // Un segundo dispositivo, con otros intereses (se registra por la API pública, como lo haría otro navegador).
  const reg = await request.post('/api/public/push/subscribe', { data: { endpoint: dev2.endpoint, keys: { p256dh: dev2.p256dh, auth: dev2.auth }, topics: ['agua', 'salud'] } })
  expect(reg.status()).toBe(201)
  expect((await (await api(request).get('/notifications')).json()).subscriptions.active).toBe(2)
})

test('al publicar una noticia institucional llega SOLO al dispositivo suscripto, cifrada y con el contenido exacto; la notificación abre esa noticia', async ({ page, request }) => {
  await adminLogin(request)
  const title = `Horario especial de la Comuna ${stamp}`
  const id = await publishNews(request, title, 'La Comuna informa que la oficina de atención al vecino atenderá en horario especial toda la semana próxima.', ['institucional'])

  const got = await waitForHits(request, dev1, 1)
  await settle(page)
  expect(await hits(request, dev2)).toHaveLength(0) // eligió otros temas
  expect(await hits(request, dev3)).toHaveLength(0)
  expect(got).toHaveLength(1)
  expect(got[0].headers['content-encoding']).toBe('aes128gcm')
  expect(got[0].headers.authorization).toMatch(/^vapid t=.+, k=.+/)
  expect(got[0].body).not.toContain(Buffer.from(title).toString('base64url').slice(0, 12)) // el servicio push no ve el texto

  const payload = await decrypt(got[0].body, dev1)
  expect(payload).toMatchObject({ type: 'post', title, url: `/noticias/${id}`, urgent: false })
  expect(payload.body).toContain('horario especial')

  // «Tocar» la notificación = abrir la dirección del aviso: debe mostrar exactamente esa noticia.
  await page.goto(payload.url)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByText('atenderá en horario especial')).toBeVisible()
})

test('otra categoría llega solo a quien la eligió; cada aviso trae su propio contenido', async ({ request }) => {
  await adminLogin(request)
  const title = `Corte de agua barrio Norte ${stamp}`
  const id = await publishNews(request, title, 'Mañana habrá interrupción del suministro de agua en barrio Norte por trabajos de reparación en la red.', ['agua'])
  const got = await waitForHits(request, dev2, 1)
  const payload = await decrypt(got[0].body, dev2)
  expect(payload).toMatchObject({ title, url: `/noticias/${id}` })
  // dev1 también eligió «Cortes de agua» (configuración inicial) y recibe este aviso, además del institucional anterior; cada uno con SU contenido.
  const first = await waitForHits(request, dev1, 2)
  expect(await decrypt(first[0].body, dev1)).toMatchObject({ title: `Horario especial de la Comuna ${stamp}` })
  expect(await decrypt(first[1].body, dev1)).toMatchObject({ title: `Corte de agua barrio Norte ${stamp}`, url: `/noticias/${id}` })
})

test('una alerta urgente confirmada respeta la audiencia y la prioridad; sin confirmar no sale nada', async ({ request, page }) => {
  await adminLogin(request)
  const before1 = (await hits(request, dev1)).length
  const before2 = (await hits(request, dev2)).length
  const title = `Alerta naranja por tormentas ${stamp}`
  const created = await api(request).post('/alerts', { kind: 'meteorologica', severity: 'urgente', title, body: 'Se esperan tormentas fuertes con granizo. Evitá circular por rutas.' })
  expect(created.status()).toBe(201)
  const alertId = ((await created.json()) as { id: number }).id
  await settle(page)
  expect((await hits(request, dev1)).length).toBe(before1) // aún no confirmada
  expect((await api(request).post(`/alerts/${alertId}/confirm`)).status()).toBe(200)
  const got = await waitForHits(request, dev1, before1 + 1)
  await settle(page)
  const last = got[got.length - 1]
  expect(last.headers.urgency).toBe('high')
  expect(last.headers.ttl).toBe('3600')
  expect(await decrypt(last.body, dev1)).toMatchObject({ type: 'alert', urgent: true, url: `/alertas/${alertId}` })
  expect((await hits(request, dev2)).length).toBe(before2) // dev2 no eligió ni «urgente» ni meteorológicas
  await page.goto(`/alertas/${alertId}`)
  await expect(page.getByText(title)).toBeVisible()
})

test('cambiar las preferencias desde la pantalla cambia quién recibe los avisos', async ({ request }) => {
  const page = page1
  await adminLogin(request)
  await page.goto('/configuracion/notificaciones')
  const checkbox = page.getByRole('checkbox', { name: /Noticias institucionales/ })
  await expect(checkbox).toBeChecked()
  await checkbox.uncheck()
  await page.getByRole('button', { name: 'Guardar preferencias' }).click()
  await expect(page.getByText('Guardamos tus preferencias.')).toBeVisible()
  const before = (await hits(request, dev1)).length
  await publishNews(request, `Otra noticia institucional ${stamp}`, 'Nueva novedad institucional de la Comuna para todos los vecinos del pueblo y la zona.', ['institucional'])
  await settle(page)
  expect((await hits(request, dev1)).length).toBe(before)
})

test('una suscripción revocada por el servicio push (410) se da de baja y deja de recibir', async ({ page, request }) => {
  await adminLogin(request)
  await request.get(`${MOCK}/__fail?path=/push/dev2&status=410`)
  const inactiveBefore = (await (await api(request).get('/notifications')).json()).subscriptions.inactive
  await publishNews(request, `Salud: vacunación ${stamp}`, 'Jornada de vacunación en el centro de salud del pueblo con atención por orden de llegada para todos.', ['salud'])
  await expect.poll(async () => (await (await api(request).get('/notifications')).json()).subscriptions.inactive, { timeout: 15_000 }).toBe(inactiveBefore + 1)
  await settle(page)
  const count = (await hits(request, dev2)).length
  await request.get(`${MOCK}/__fail?path=/push/dev2&status=201`)
  await publishNews(request, `Salud: campaña ${stamp}`, 'Campaña de control de salud en la plaza principal del pueblo durante toda la semana próxima.', ['salud'])
  await settle(page)
  expect((await hits(request, dev2)).length).toBe(count) // dado de baja: no se le vuelve a intentar
})

test('el administrador registra su dispositivo de prueba y recibe SOLO la prueba (no los avisos reales)', async ({ page, request }) => {
  await fakeBrowserPush(page, dev3)
  const { email, password } = creds()
  await page.goto('/admin')
  await page.getByLabel('Correo electrónico').fill(email)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.getByRole('link', { name: 'Notificaciones' }).click()
  await expect(page.getByRole('heading', { name: 'Notificaciones', exact: true })).toBeVisible()
  await expect(page.getByText('Dispositivos activos')).toBeVisible()
  await page.getByLabel('Nombre de este dispositivo').fill('Celular de prueba E2E')
  await page.getByRole('button', { name: 'Registrar este navegador' }).click()
  await expect(page.getByText('Este navegador quedó registrado como dispositivo de prueba.')).toBeVisible()
  await page.getByRole('button', { name: 'Enviar prueba' }).click()
  await expect(page.getByText('Prueba enviada. Revisá el dispositivo.')).toBeVisible()
  const got = await waitForHits(request, dev3, 1)
  expect(await decrypt(got[0].body, dev3)).toMatchObject({ type: 'test', title: 'Notificación de prueba', url: '/configuracion/notificaciones' })

  await adminLogin(request)
  await publishNews(request, `Evento comunitario ${stamp}`, 'Gran festival comunitario en la plaza con música, feria de artesanos y comidas típicas para toda la familia.', ['eventos'])
  await settle(page)
  expect(await hits(request, dev3)).toHaveLength(1) // el dispositivo de prueba no recibe avisos masivos
  // El historial muestra el aviso y su resultado.
  await page.reload()
  await expect(page.getByText('Notificación de prueba').first()).toBeVisible()
  await page.locator('li', { hasText: 'Notificación de prueba' }).getByRole('button', { name: 'Ver historial de intentos' }).click()
  await expect(page.getByText(/Dispositivo #\d+/).first()).toBeVisible()
})

test('desactivar las notificaciones borra la suscripción del servidor', async ({ request }) => {
  const page = page1
  await adminLogin(request)
  const before = (await (await api(request).get('/notifications')).json()).subscriptions.active
  await page.goto('/configuracion/notificaciones')
  await page.getByRole('button', { name: 'Desactivar notificaciones' }).click()
  await expect(page.getByText(/Desactivamos las notificaciones en este dispositivo/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Activar notificaciones/ })).toBeVisible()
  expect((await (await api(request).get('/notifications')).json()).subscriptions.active).toBe(before - 1)
  const count = (await hits(request, dev1)).length
  await publishNews(request, `Noticia institucional tras la baja ${stamp}`, 'Comunicado institucional posterior a la baja de las notificaciones de este dispositivo de prueba.', ['institucional'])
  await settle(page)
  expect((await hits(request, dev1)).length).toBe(count)
})

test('iPhone sin la app instalada: explica cómo instalarla y no ofrece activar', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: 'http://localhost:8787', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1' })
  const page = await ctx.newPage()
  await page.goto('/configuracion/notificaciones')
  await expect(page.getByText('En iPhone y iPad, primero instalá la aplicación')).toBeVisible()
  await expect(page.getByRole('button', { name: /Activar notificaciones/ })).toHaveCount(0)
  await ctx.close()
})

test('sin conexión la aplicación sigue abriendo y la pantalla informa el error de conexión', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state)
  await page.reload() // el service worker ya controla la página
  await context.setOffline(true)
  await page.goto('/configuracion/notificaciones')
  await expect(page.getByRole('heading', { name: 'Mis notificaciones' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await context.setOffline(false)
  await page.getByRole('button', { name: 'Reintentar' }).click()
  await expect(page.getByRole('button', { name: /Activar notificaciones/ })).toBeVisible()
})
