import { describe, expect, it } from 'vitest'
import * as schemas from '@/domain/schemas'
import { LocalJsonRepository } from './repository/localJsonRepository'
import { makeService } from '@/test/fixtures'

describe('validación de los JSON incluidos', () => {
  const repo = new LocalJsonRepository()

  it('todos los archivos cumplen su esquema', async () => {
    await expect(Promise.all([
      repo.getNews(), repo.getAlerts(), repo.getEvents(), repo.getObituaries(),
      repo.getRadios(), repo.getHolidays(), repo.getTransport(),
    ])).resolves.toBeDefined()
  })

  it('no se publica contenido editorial sin fuente real cargada', async () => {
    expect(await repo.getNews()).toEqual([])
    expect(await repo.getAlerts()).toEqual([])
    expect(await repo.getEvents()).toEqual([])
    expect(await repo.getObituaries()).toEqual([])
  })


  it('las dos radios tienen frecuencia y sitio', async () => {
    const radios = await repo.getRadios()
    expect(radios.map((r) => r.frequency)).toEqual(['103.1 FM', '89.3 FM'])
  })
})

describe('esquemas rechazan datos inválidos', () => {
  it('hora fuera de rango', () => {
    expect(schemas.serviceSchema.safeParse(makeService({ id: 'a', departure: '48:00' })).success).toBe(false)
    expect(schemas.serviceSchema.safeParse(makeService({ id: 'a', departure: '7:5' })).success).toBe(false)
    expect(schemas.serviceSchema.safeParse(makeService({ id: 'a', departure: '24:30' })).success).toBe(true)
  })
  it('servicio sin tipo de día', () => {
    expect(schemas.serviceSchema.safeParse({ ...makeService({ id: 'a', departure: '10:00' }), dayTypes: [] }).success).toBe(false)
  })
  it('noticia con URL no http(s) o fecha inválida', () => {
    const base = { id: '1', title: 'x', publishedAt: '2026-10-28T10:00:00-03:00', source: { label: 'f', url: 'https://a.com' }, verified: true }
    expect(schemas.newsItemSchema.safeParse(base).success).toBe(true)
    expect(schemas.newsItemSchema.safeParse({ ...base, source: { label: 'f', url: 'javascript:alert(1)' } }).success).toBe(false)
    expect(schemas.newsItemSchema.safeParse({ ...base, publishedAt: 'ayer' }).success).toBe(false)
  })
  it('obituario no verificado', () => {
    const o = { id: '1', name: 'N', date: '2026-10-28', source: { label: 'f', url: 'https://a.com' } }
    expect(schemas.obituarySchema.safeParse({ ...o, verified: false }).success).toBe(false)
    expect(schemas.obituarySchema.safeParse({ ...o, verified: true }).success).toBe(true)
  })
})
