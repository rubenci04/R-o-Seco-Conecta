import { describe, expect, it, vi } from 'vitest'
import { createRepository } from './DataContext'
import { ApiError, HttpRepository } from './httpRepository'
import { HybridRepository } from './hybridRepository'
import { LocalJsonRepository } from './localJsonRepository'

const news = [{ id: '1', title: 'Nota', publishedAt: '2026-10-28T10:00:00.000Z', source: { label: 'Redacción Río Seco Conecta' }, verified: true, origin: 'manual', categories: ['institucional'] }]
const ok = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
/** Devuelve el error con el que se rechaza la promesa (o null si se resolvió). */
const rejection = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as ApiError)
const repoWith = (impl: (url: string) => Promise<Response>) => new HttpRepository('', ((u: string) => impl(String(u))) as unknown as typeof fetch)

describe('HttpRepository (API pública)', () => {
  it('lee y valida el feed con los esquemas del frontend; arma la consulta con categoría y cursor', async () => {
    const urls: string[] = []
    const r = repoWith(async (u) => (urls.push(u), ok(news)))
    expect(await r.getNews({ category: 'agua', before: '2026-10-30T00:00:00.000Z', limit: 10 })).toHaveLength(1)
    expect(urls[0]).toBe('/api/public/feed?categoria=agua&antes=2026-10-30T00%3A00%3A00.000Z&limite=10')
    expect(await r.getNews()).toHaveLength(1)
    expect(urls[1]).toBe('/api/public/feed')
  })
  it('acepta alertas, eventos y obituarios válidos y rechaza formatos inesperados', async () => {
    const alerts = [{ id: '1', title: 'Corte', body: 'x', severity: 'urgente', publishedAt: '2026-10-28T10:00:00.000Z', source: { label: 'Comuna' } }]
    expect(await repoWith(async () => ok(alerts)).getAlerts()).toHaveLength(1)
    await expect(repoWith(async () => ok([{ id: 1 }])).getEvents()).rejects.toThrow(/formato esperado/)
    await expect(repoWith(async () => ok({ error: 'x' })).getObituaries()).rejects.toThrow(/formato esperado/)
  })
  it('un obituario no verificado nunca pasa el esquema', async () => {
    const o = [{ id: '1', name: 'N', date: '2026-10-27', source: { label: 'x' }, verified: false }]
    await expect(repoWith(async () => ok(o)).getObituaries()).rejects.toBeInstanceOf(ApiError)
  })
  it('errores del servidor, de red y de tiempo se traducen a mensajes claros', async () => {
    const server = await rejection(repoWith(async () => new Response('x', { status: 503 })).getNews())
    expect(server).toBeInstanceOf(ApiError)
    expect(server?.status).toBe(503)
    expect(server?.message).toMatch(/problema/)
    const notFound = await rejection(repoWith(async () => new Response('x', { status: 404 })).getAlerts())
    expect(notFound?.message).toMatch(/error 404/)
    const network = await rejection(repoWith(async () => Promise.reject(new TypeError('Failed to fetch'))).getEvents())
    expect(network?.status).toBeNull()
    expect(network?.message).toMatch(/conectar con el servidor/)
    await expect(repoWith(async () => new Response('<html>', { status: 200 })).getNews()).rejects.toThrow(/ilegible/)
  })
  it('corta la espera cuando el servidor no responde', async () => {
    vi.useFakeTimers()
    const hanging = new HttpRepository('', ((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('abort', 'AbortError'))))) as unknown as typeof fetch, 50)
    const p = rejection(hanging.getNews())
    await vi.advanceTimersByTimeAsync(60)
    expect((await p)?.message).toMatch(/tardó demasiado/)
    vi.useRealTimers()
  })
})

describe('HybridRepository: dinámico por API, estático por JSON', () => {
  const api = () => ({
    getNews: vi.fn(async () => []),
    getAlerts: vi.fn(async () => []),
    getEvents: vi.fn(async () => []),
    getObituaries: vi.fn(async () => []),
  })
  it('noticias, alertas, agenda y obituarios salen de la API; el resto, del JSON', async () => {
    const a = api()
    const local = new LocalJsonRepository()
    const spy = vi.spyOn(local, 'getTransport')
    const h = new HybridRepository(a, local)
    await Promise.all([h.getNews({ category: 'agua' }), h.getAlerts(), h.getEvents(), h.getObituaries()])
    expect(a.getNews).toHaveBeenCalledWith({ category: 'agua' })
    expect(a.getAlerts).toHaveBeenCalledTimes(1)
    await h.getTransport()
    expect(spy).toHaveBeenCalled()
  })
  it('si la API falla, lo dinámico falla visiblemente y lo estático sigue funcionando', async () => {
    const down = { ...api(), getNews: async () => Promise.reject(new ApiError('sin servicio', 503)) }
    const h = new HybridRepository(down, new LocalJsonRepository())
    await expect(h.getNews()).rejects.toThrow('sin servicio')
    expect((await h.getTransport()).services.length).toBe(1899)
    expect((await h.getPlaces()).length).toBe(22)
    expect((await h.getRadios()).length).toBe(2)
  })
  it('conserva intactos los datos estáticos: horarios reales, coordenadas, feriados, emergencias y patrimonio', async () => {
    const h = new HybridRepository(api(), new LocalJsonRepository())
    const t = await h.getTransport()
    const by = (d: string) => t.services.filter((s) => s.dayTypes.includes(d as never)).length
    expect([by('weekday'), by('saturday'), by('sunday')]).toEqual([835, 532, 532])
    expect(t.localities.filter((l) => l.status === 'verificado')).toHaveLength(15)
    const places = await h.getPlaces()
    expect(places.filter((p) => p.location)).toHaveLength(20)
    expect(places.find((p) => p.id === 'comisaria-rio-seco')?.location).toMatchObject({ lat: -27.268584, lng: -65.560203 })
    expect((await h.getHolidays()).length).toBeGreaterThan(5)
    expect((await h.getEmergencyNumbers()).map((e) => e.phone)).toEqual(['911', '107'])
    expect((await h.getHeritage()).length).toBe(9)
  })
})

describe('selección del repositorio por modo', () => {
  it('«hybrid» usa la API para lo dinámico; «local» usa solo JSON', () => {
    expect(createRepository('hybrid')).toBeInstanceOf(HybridRepository)
    expect(createRepository('local')).toBeInstanceOf(LocalJsonRepository)
  })
  it('en pruebas y desarrollo el modo por defecto es local (el build de producción usa híbrido)', () => {
    expect(createRepository()).toBeInstanceOf(LocalJsonRepository)
  })
})
