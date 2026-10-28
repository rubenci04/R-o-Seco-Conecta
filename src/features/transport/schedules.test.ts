// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { schedulesDatasetSchema } from '@/domain/schedules'
import { LocalJsonRepository } from '@/data/repository/localJsonRepository'
import type { PageSnapshot } from '../../../scripts/import-schedules/extract'
import { buildDataset, buildReport } from '../../../scripts/import-schedules/normalize'
import raw from '@/data/json/schedules.json'
import holidaysJson from '@/data/json/holidays.json'
import { classifyDay } from './dayType'
import { expandSchedules } from './expand'
import { DEFAULT_QUERY, swapDirection, type BusQuery } from './query'
import { findArriveBy, findNext, listAll } from './search'
import { getLocalParts } from './time'

const repo = new LocalJsonRepository()
const at = (iso: string) => new Date(`${iso}-03:00`)
const q = (over: Partial<BusQuery> = {}): BusQuery => ({ ...DEFAULT_QUERY, ...over })
const holidays = holidaysJson as never

const SNAP_DIR = path.resolve('data-sources/colectivostucuman')
const snapshots = () =>
  readdirSync(SNAP_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'IMPORT_REPORT.json')
    .map((f) => JSON.parse(readFileSync(path.join(SNAP_DIR, f), 'utf8')) as PageSnapshot)

describe('importación de horarios (Colectivos Tucumán)', () => {
  const dataset = schedulesDatasetSchema.parse(raw)
  const report = buildReport(dataset)

  it('el dataset incluido es válido y cubre las 40 páginas con Río Seco como extremo', () => {
    expect(dataset.pages).toHaveLength(40)
    expect(new Set(dataset.pages.map((p) => p.localityId)).size).toBe(20)
    expect(dataset.source.reuseAuthorized).toBe(true)
    expect(dataset.source.url).toContain('colectivostucuman.com.ar')
  })
  it('es reproducible: reconstruirlo desde las instantáneas da exactamente lo publicado', () => {
    expect(JSON.parse(JSON.stringify(buildDataset(snapshots())))).toEqual(JSON.parse(JSON.stringify(dataset)))
  })
  it('las cantidades importadas coinciden con los totales que declara cada página', () => {
    expect(report.mismatches).toEqual([])
    expect(report.perPage.every((p) => p.matchesDeclared)).toBe(true)
    expect(report.totalServices).toEqual({ weekday: 835, saturday: 532, sunday: 532 })
  })
  it('Río Seco → Concepción: 46 hábiles y 29 de sábado/domingo; Concepción → Río Seco: 45 y 28', async () => {
    const { services } = await repo.getTransport()
    const count = (direction: 'from-rio-seco' | 'to-rio-seco', day: 'weekday' | 'saturday' | 'sunday' | 'holiday') =>
      services.filter((s) => s.localityId === 'concepcion' && s.direction === direction && s.dayTypes.includes(day)).length
    expect([count('from-rio-seco', 'weekday'), count('from-rio-seco', 'saturday'), count('from-rio-seco', 'sunday'), count('from-rio-seco', 'holiday')]).toEqual([46, 29, 29, 29])
    expect([count('to-rio-seco', 'weekday'), count('to-rio-seco', 'saturday'), count('to-rio-seco', 'sunday')]).toEqual([45, 28, 28])
  })
  it('discrepancia 46 vs 45: la FAQ elimina horas repetidas; los registros reales tienen dos servicios distintos a las 13:30', async () => {
    const page = report.perPage.find((p) => p.direction === 'from-rio-seco' && p.locality === 'Concepción')!
    expect(page.faqUniqueTimes.weekday).toBe(45)
    expect(page.faqDifferences).toEqual([{ dayType: 'weekday', services: 46, faqTimes: 45, repeatedDepartures: ['13:30'] }])
    const { services } = await repo.getTransport()
    const at1330 = services.filter((s) => s.localityId === 'concepcion' && s.direction === 'from-rio-seco' && s.dayTypes.includes('weekday') && s.departure === '13:30')
    expect(at1330).toHaveLength(2)
    expect(at1330.map((s) => s.serviceType).sort()).toEqual(['común', 'semirrápido'])
    expect(at1330.map((s) => s.arrival).sort()).toEqual(['13:40', '13:45']) // no se agregó ni quitó ningún viaje
  })
  it('todas las diferencias con las FAQ se explican solo por salidas repetidas', () => {
    for (const p of report.perPage) for (const d of p.faqDifferences) expect(d.services - d.faqTimes).toBe(d.repeatedDepartures.length)
  })
  it('los horarios con "~" se conservan como aproximados y los de grilla como confirmados', async () => {
    const { services } = await repo.getTransport()
    const rsConc = services.filter((s) => s.localityId === 'concepcion' && s.direction === 'from-rio-seco' && s.dayTypes.includes('weekday'))
    const approx = rsConc.filter((s) => s.precision === 'approximate')
    expect(approx).toHaveLength(41) // los semirrápidos paran en Río Seco aunque no figuren en la grilla oficial
    expect(approx.every((s) => s.observations?.includes('aproximado'))).toBe(true)
    expect(rsConc.filter((s) => s.precision === 'confirmed').every((s) => s.serviceType === 'común')).toBe(true)
  })
  it('conserva empresa, tipo de servicio, origen, destino, salida, llegada, duración, fuente y fecha', async () => {
    const { services, stops, companies } = await repo.getTransport()
    const s = services.find((x) => x.localityId === 'concepcion' && x.direction === 'from-rio-seco' && x.dayTypes.includes('weekday') && x.departure === '13:00')!
    expect(companies.find((c) => c.id === s.companyId)?.name).toBe('Exprebus')
    expect(s).toMatchObject({ serviceType: 'común', arrival: '13:15', durationMinutes: 15, precision: 'confirmed' })
    expect(stops.find((x) => x.id === s.originStopId)?.name).toBe('Río Seco')
    expect(stops.find((x) => x.id === s.destinationStopId)?.name).toBe('Concepción (Plaza)')
    expect(s.source.url).toBe('https://colectivostucuman.com.ar/horarios/rio-seco/concepcion')
    expect(s.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('no inventa horarios: las paradas sin hora informada quedan en null y no se interpolan', async () => {
    const { services } = await repo.getTransport()
    const comun = services.find((x) => x.localityId === 'concepcion' && x.direction === 'from-rio-seco' && x.serviceType === 'común')!
    expect(comun.stopTimes?.map((t) => t.name)).toEqual(['Santa Lucía (Iglesia)', 'Cáceres (Entrada)', 'Sargento Moya'])
    expect(comun.stopTimes?.every((t) => t.time === null)).toBe(true)
  })
  it('no se inventan viajes directos: las rutas definidas sin viajes quedan "sin datos"', async () => {
    const { services, localities } = await repo.getTransport()
    for (const id of ['santa-lucia', 'caceres', 'sargento-moya', 'fronterita', 'nueva-baviera']) {
      expect(services.filter((s) => s.localityId === id)).toHaveLength(0)
      expect(localities.find((l) => l.id === id)?.status).toBe('sin-datos')
    }
    expect(report.routesWithoutServices).toHaveLength(10)
    expect(localities.find((l) => l.id === 'concepcion')?.status).toBe('verificado')
  })
  it('los feriados usan el cuadro de domingo, como indica la fuente', async () => {
    const { services } = await repo.getTransport()
    const sundays = services.filter((s) => s.dayTypes.includes('sunday'))
    expect(sundays.length).toBe(532)
    expect(sundays.every((s) => s.dayTypes.includes('holiday'))).toBe(true)
    expect(services.some((s) => s.dayTypes.includes('weekday') && s.dayTypes.includes('holiday'))).toBe(false)
  })
})

describe('horarios reales: clasificación de días, medianoche y búsqueda', () => {
  const load = async () => (await repo.getTransport()).services

  it('un feriado entre semana usa el cuadro de domingo/feriado', async () => {
    const services = await load()
    const date = '2026-12-25' // viernes, Navidad
    expect(classifyDay(date, holidays)).toBe('holiday')
    const list = listAll(services, q(), at(`${date}T10:00:00`), holidays)
    expect(list).toHaveLength(29)
    const weekday = listAll(services, q(), at('2026-10-28T10:00:00'), holidays)
    expect(weekday).toHaveLength(46)
  })
  it('las salidas de madrugada pertenecen al día operativo anterior (24:10, 24:45, 25:15)', async () => {
    const services = await load()
    const weekday = services.filter((s) => s.localityId === 'concepcion' && s.direction === 'from-rio-seco' && s.dayTypes.includes('weekday'))
    expect(weekday.map((s) => s.departure).filter((d) => d >= '24:00').sort()).toEqual(['24:10', '24:45', '25:15'])
    expect(weekday.every((s) => s.departure >= '06:40')).toBe(true) // ninguna con "00:10" suelto que se confunda con el inicio del día
    const late = weekday.find((s) => s.departure === '25:15')!
    expect(late.arrival).toBe('25:30')
  })
  it('a las 23:50 de un miércoles ofrece 24:10 y a las 00:05 del jueves todavía ofrece el servicio del miércoles', async () => {
    const services = await load()
    const a = findNext(services, q(), at('2026-10-28T23:50:00'), holidays, 3)
    expect(a.results.map((o) => o.service.departure).slice(0, 2)).toEqual(['24:10', '24:45'])
    const b = findNext(services, q(), at('2026-10-29T00:05:00'), holidays, 1)
    expect(b.results[0].service.departure).toBe('24:10')
    expect(b.results[0].serviceDate).toBe('2026-10-28')
  })
  it('tras el último servicio de la noche del viernes, el próximo es el primero del sábado', async () => {
    const services = await load()
    const r = findNext(services, q(), at('2026-10-31T01:30:00'), holidays, 1) // sábado 01:30: ya salió el 25:15 del viernes
    expect(r.results[0].serviceDate).toBe('2026-10-31')
    expect(r.results[0].service.departure).toBe('06:40')
  })
  it('próximo colectivo y llegar antes de una hora devuelven resultados reales', async () => {
    const services = await load()
    const next = findNext(services, q(), at('2026-10-28T13:10:00'), holidays, 3)
    expect(next.results.map((o) => o.service.departure)).toEqual(['13:15', '13:30', '13:30'])
    const arrive = findArriveBy(services, q({ mode: 'arrive-by', time: '14:00' }), at('2026-10-28T13:00:00'), holidays)
    expect(arrive.results.length).toBeGreaterThan(3)
    expect(arrive.results.every((o) => (o.arrivalAbs ?? 9999) <= 14 * 60)).toBe(true)
    expect(arrive.results[0].arrivalAbs).toBeGreaterThanOrEqual(arrive.results[1].arrivalAbs!)
  })
  it('cambiar origen y destino consulta el sentido opuesto con datos propios', async () => {
    const services = await load()
    const now = at('2026-10-28T08:00:00')
    const ida = findNext(services, q(), now, holidays, 1).results[0]
    const vuelta = findNext(services, q({ direction: swapDirection('from-rio-seco') }), now, holidays, 1).results[0]
    expect(ida.service.direction).toBe('from-rio-seco')
    expect(vuelta.service.direction).toBe('to-rio-seco')
    expect(vuelta.service.originStopId).not.toBe(ida.service.originStopId)
  })
  it('filtra por tipo de servicio', async () => {
    const services = await load()
    const r = listAll(services, q({ serviceType: 'común' }), at('2026-10-28T10:00:00'), holidays)
    expect(r).toHaveLength(5)
    expect(r.every((o) => o.service.serviceType === 'común')).toBe(true)
  })
  it('un destino sin viajes directos devuelve vacío sin romper', async () => {
    const services = await load()
    expect(findNext(services, q({ localityId: 'fronterita' }), new Date(), holidays).results).toEqual([])
  })
  it('expandSchedules conserva la cantidad exacta de viajes del dataset', () => {
    const ds = schedulesDatasetSchema.parse(raw)
    const trips = ds.pages.reduce((n, p) => n + p.routes.reduce((m, r) => m + r.trips.length, 0), 0)
    expect(expandSchedules(ds).services).toHaveLength(trips)
    expect(getLocalParts(at('2026-10-28T23:59:00')).date).toBe('2026-10-28')
  })
})
