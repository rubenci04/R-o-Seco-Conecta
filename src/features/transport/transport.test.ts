import { describe, expect, it } from 'vitest'
import { makeService, TEST_HOLIDAYS, TEST_SERVICES } from '@/test/fixtures'
import { classifyDay } from './dayType'
import { DEFAULT_QUERY, paramsToQuery, queryToParams, swapDirection, type BusQuery } from './query'
import { findArriveBy, findNext, listAll, runsOn } from './search'
import { addDays, formatClock, getLocalParts } from './time'

// 2026-10-28 es miércoles. Tucumán es UTC-3 todo el año.
const at = (iso: string) => new Date(`${iso}-03:00`)
const q = (over: Partial<BusQuery> = {}): BusQuery => ({ ...DEFAULT_QUERY, ...over })

describe('hora local de Tucumán', () => {
  it('usa America/Argentina/Tucuman aunque el instante esté en UTC', () => {
    // 02:30 UTC del 29/10 = 23:30 del 28/10 en Tucumán
    expect(getLocalParts(new Date('2026-10-29T02:30:00Z'))).toEqual({ date: '2026-10-28', minutes: 23 * 60 + 30 })
  })
  it('suma días cruzando fin de mes y año', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('formatea horas posteriores a medianoche como reloj', () => {
    expect(formatClock(25 * 60 + 5)).toBe('01:05')
  })
})

describe('clasificación de días', () => {
  it('distingue hábil, sábado y domingo', () => {
    expect(classifyDay('2026-10-28', TEST_HOLIDAYS)).toBe('weekday')
    expect(classifyDay('2026-10-31', TEST_HOLIDAYS)).toBe('saturday')
    expect(classifyDay('2026-11-01', TEST_HOLIDAYS)).toBe('sunday')
  })
  it('el feriado prevalece sobre el día de la semana (fijo y móvil)', () => {
    expect(classifyDay('2026-09-24', TEST_HOLIDAYS)).toBe('holiday') // jueves
    expect(classifyDay('2027-09-24', TEST_HOLIDAYS)).toBe('holiday') // se repite cada año
    expect(classifyDay('2026-11-23', TEST_HOLIDAYS)).toBe('holiday') // lunes
    expect(classifyDay('2027-11-23', TEST_HOLIDAYS)).toBe('weekday')
  })
})

describe('intercambio origen/destino y consulta compartible', () => {
  it('swapDirection es involutivo', () => {
    expect(swapDirection('from-rio-seco')).toBe('to-rio-seco')
    expect(swapDirection(swapDirection('from-rio-seco'))).toBe('from-rio-seco')
  })
  it('serializa y recupera la consulta desde la URL', () => {
    const original = q({ direction: 'to-rio-seco', localityId: 'monteros', mode: 'arrive-by', time: '08:30', dayType: 'saturday', companyId: 'x' })
    expect(paramsToQuery(queryToParams(original))).toEqual(original)
  })
  it('ignora valores inválidos en la URL', () => {
    const parsed = paramsToQuery(new URLSearchParams('sentido=zzz&dia=lunes&modo=raro&hora=25'))
    expect(parsed.direction).toBe('from-rio-seco')
    expect(parsed.dayType).toBe('auto')
    expect(parsed.mode).toBe('next')
  })
  it('el intercambio cambia los resultados al sentido opuesto', () => {
    const now = at('2026-10-28T07:00:00')
    const out = findNext(TEST_SERVICES, q(), now, TEST_HOLIDAYS, 1)
    const back = findNext(TEST_SERVICES, q({ direction: swapDirection('from-rio-seco') }), now, TEST_HOLIDAYS, 1)
    expect(out.results[0].service.id).toBe('s2')
    expect(back.results[0].service.id).toBe('s7')
  })
})

describe('próximo colectivo', () => {
  it('devuelve el siguiente servicio del día', () => {
    const r = findNext(TEST_SERVICES, q(), at('2026-10-28T06:01:00'), TEST_HOLIDAYS, 2)
    expect(r.results.map((o) => o.service.id)).toEqual(['s2', 's3'])
    expect(r.startsTomorrow).toBe(false)
  })
  it('incluye el servicio que sale justo ahora', () => {
    const r = findNext(TEST_SERVICES, q(), at('2026-10-28T06:00:00'), TEST_HOLIDAYS, 1)
    expect(r.results[0].service.id).toBe('s1')
  })
  it('filtra por empresa', () => {
    const r = findNext(TEST_SERVICES, q({ companyId: 'otra-empresa' }), at('2026-10-28T06:01:00'), TEST_HOLIDAYS, 3)
    expect(new Set(r.results.map((o) => o.service.id))).toEqual(new Set(['s3']))
  })
  it('usa el cuadro de sábados/domingos/feriados el día correspondiente', () => {
    const sat = findNext(TEST_SERVICES, q(), at('2026-10-31T05:00:00'), TEST_HOLIDAYS, 1)
    expect(sat.results[0].service.id).toBe('s6')
  })
  it('pasa a mañana cuando ya no quedan servicios hoy', () => {
    const r = findNext(TEST_SERVICES, q(), at('2026-10-31T10:00:00'), TEST_HOLIDAYS, 1) // sábado 10:00, s6 salió 09:00
    expect(r.startsTomorrow).toBe(true)
    expect(r.results[0].serviceDate).toBe('2026-11-01')
  })
  it('respeta vigencia y excepciones', () => {
    const s = makeService({ id: 'v', departure: '10:00', validFrom: '2026-11-01', exceptions: [{ date: '2026-11-03' }] })
    expect(runsOn(s, '2026-10-30', 'weekday')).toBe(false)
    expect(runsOn(s, '2026-11-02', 'weekday')).toBe(true)
    expect(runsOn(s, '2026-11-03', 'weekday')).toBe(false)
  })
})

describe('viajes posteriores a medianoche', () => {
  it('ofrece a las 23:50 el servicio 24:15 (00:15 del día siguiente)', () => {
    const r = findNext(TEST_SERVICES, q(), at('2026-10-28T23:50:00'), TEST_HOLIDAYS, 1)
    expect(r.results[0].service.id).toBe('s5')
    expect(r.results[0].departureAbs).toBe(24 * 60 + 15)
  })
  it('a las 00:05 del jueves todavía ofrece el servicio 24:15 del miércoles', () => {
    const r = findNext(TEST_SERVICES, q(), at('2026-10-29T00:05:00'), TEST_HOLIDAYS, 1)
    expect(r.results[0].service.id).toBe('s5')
    expect(r.results[0].serviceDate).toBe('2026-10-28')
    expect(r.results[0].departureAbs).toBe(15)
  })
  it('una llegada anterior a la salida se interpreta como día siguiente', () => {
    const r = findNext(TEST_SERVICES, q(), at('2026-10-28T23:00:00'), TEST_HOLIDAYS, 1)
    expect(r.results[0].service.id).toBe('s4')
    expect(r.results[0].arrivalAbs).toBe(24 * 60 + 20)
  })
})

describe('llegar antes de una hora', () => {
  it('devuelve los que llegan a tiempo, el más tardío primero', () => {
    const r = findArriveBy(TEST_SERVICES, q({ mode: 'arrive-by', time: '14:00' }), at('2026-10-28T05:00:00'), TEST_HOLIDAYS)
    expect(r.results.map((o) => o.service.id)).toEqual(['s2', 's1'])
  })
  it('descarta los que ya salieron', () => {
    const r = findArriveBy(TEST_SERVICES, q({ mode: 'arrive-by', time: '14:00' }), at('2026-10-28T10:00:00'), TEST_HOLIDAYS)
    expect(r.results.map((o) => o.service.id)).toEqual(['s2'])
  })
  it('cuenta los servicios sin hora de llegada en lugar de adivinarla', () => {
    const svc = [makeService({ id: 'x', departure: '10:00' })]
    const r = findArriveBy(svc, q({ mode: 'arrive-by', time: '12:00' }), at('2026-10-28T05:00:00'), TEST_HOLIDAYS)
    expect(r.results).toHaveLength(0)
    expect(r.withoutArrival).toBe(1)
  })
})

describe('ver todos y ausencia de resultados', () => {
  it('lista todos los horarios del día ordenados', () => {
    const r = listAll(TEST_SERVICES, q(), at('2026-10-28T12:00:00'), TEST_HOLIDAYS)
    expect(r.map((o) => o.service.id)).toEqual(['s1', 's2', 's3', 's4', 's5'])
  })
  it('usa el tipo de día elegido manualmente', () => {
    const r = listAll(TEST_SERVICES, q({ dayType: 'sunday' }), at('2026-10-28T12:00:00'), TEST_HOLIDAYS)
    expect(r.map((o) => o.service.id)).toEqual(['s6'])
  })
  it('devuelve vacío sin romper cuando no hay servicios cargados', () => {
    expect(findNext([], q(), new Date(), TEST_HOLIDAYS).results).toEqual([])
    expect(findNext([], q(), new Date(), TEST_HOLIDAYS).startsTomorrow).toBe(false)
    expect(findArriveBy([], q({ time: '10:00' }), new Date(), TEST_HOLIDAYS).results).toEqual([])
    expect(listAll([], q(), new Date(), TEST_HOLIDAYS)).toEqual([])
  })
  it('devuelve vacío para una localidad sin servicios', () => {
    expect(findNext(TEST_SERVICES, q({ localityId: 'san-miguel-de-tucuman' }), at('2026-10-28T05:00:00'), TEST_HOLIDAYS).results).toEqual([])
  })
})
