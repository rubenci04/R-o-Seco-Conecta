import type { DayType, Holiday, Service } from '@/domain/types'
import { classifyDay } from './dayType'
import type { BusQuery } from './query'
import { addDays, getLocalParts, MINUTES_PER_DAY, parseTime } from './time'

export interface Occurrence {
  service: Service
  /** Día de servicio (AAAA-MM-DD) al que pertenece el viaje. */
  serviceDate: string
  /** Minutos desde las 00:00 de hoy (puede ser <0 o ≥1440). */
  departureAbs: number
  arrivalAbs?: number
}

export interface NextResult {
  results: Occurrence[]
  /** Hay resultados, pero todos son de mañana o posteriores. */
  startsTomorrow: boolean
}

export interface ArriveByResult {
  results: Occurrence[]
  /** Servicios que coinciden pero no tienen hora de llegada cargada. */
  withoutArrival: number
}

function matchesQuery(s: Service, q: BusQuery): boolean {
  return s.direction === q.direction && s.localityId === q.localityId && (!q.companyId || s.companyId === q.companyId) && (!q.serviceType || s.serviceType === q.serviceType)
}

/** ¿Circula el servicio ese día? Considera tipo de día, vigencia y excepciones. */
export function runsOn(s: Service, isoDate: string, dayType: DayType): boolean {
  if (!s.dayTypes.includes(dayType)) return false
  if (s.validFrom && isoDate < s.validFrom) return false
  if (s.validTo && isoDate > s.validTo) return false
  return !s.exceptions.some((e) => e.date === isoDate)
}

function toOccurrence(s: Service, serviceDate: string, dayOffset: number): Occurrence {
  const dep = parseTime(s.departure)
  let arr = s.arrival ? parseTime(s.arrival) : undefined
  // Llegada anterior a la salida dentro del mismo día implica cruzar la medianoche.
  if (arr !== undefined && arr < dep) arr += MINUTES_PER_DAY
  return {
    service: s,
    serviceDate,
    departureAbs: dayOffset * MINUTES_PER_DAY + dep,
    arrivalAbs: arr === undefined ? undefined : dayOffset * MINUTES_PER_DAY + arr,
  }
}

/** Ocurrencias de los días de servicio [fromOffset, toOffset] relativos a hoy. */
function occurrencesAround(
  services: Service[],
  q: BusQuery,
  today: string,
  holidays: Holiday[],
  fromOffset: number,
  toOffset: number,
): Occurrence[] {
  const out: Occurrence[] = []
  for (let off = fromOffset; off <= toOffset; off++) {
    const date = addDays(today, off)
    const dayType = classifyDay(date, holidays)
    for (const s of services) {
      if (matchesQuery(s, q) && runsOn(s, date, dayType)) out.push(toOccurrence(s, date, off))
    }
  }
  return out
}

/** Próximos colectivos a partir de `now`. Incluye viajes de ayer que cruzan la medianoche. */
export function findNext(services: Service[], q: BusQuery, now: Date, holidays: Holiday[], count = 3): NextResult {
  const { date: today, minutes } = getLocalParts(now)
  const upcoming = occurrencesAround(services, q, today, holidays, -1, 2)
    .filter((o) => o.departureAbs >= minutes)
    .sort((a, b) => a.departureAbs - b.departureAbs)
    .slice(0, count)
  return { results: upcoming, startsTomorrow: upcoming.length > 0 && upcoming[0].departureAbs >= MINUTES_PER_DAY }
}

/** Servicios que permiten llegar antes de `q.time` (hoy) y que todavía no partieron. Primero el más tardío. */
export function findArriveBy(services: Service[], q: BusQuery, now: Date, holidays: Holiday[]): ArriveByResult {
  const { date: today, minutes } = getLocalParts(now)
  const target = parseTime(q.time ?? '00:00')
  const all = occurrencesAround(services, q, today, holidays, -1, 0)
  const withoutArrival = all.filter((o) => o.arrivalAbs === undefined && o.departureAbs >= minutes).length
  const results = all
    .filter((o) => o.arrivalAbs !== undefined && o.arrivalAbs <= target && o.departureAbs >= minutes)
    .sort((a, b) => (b.arrivalAbs ?? 0) - (a.arrivalAbs ?? 0))
  return { results, withoutArrival }
}

/** Todos los horarios del tipo de día elegido (o el de hoy si es "auto"), ordenados por salida. */
export function listAll(services: Service[], q: BusQuery, now: Date, holidays: Holiday[]): Occurrence[] {
  const { date: today } = getLocalParts(now)
  const dayType: DayType = q.dayType === 'auto' ? classifyDay(today, holidays) : q.dayType
  return services
    .filter((s) => matchesQuery(s, q) && s.dayTypes.includes(dayType))
    .map((s) => toOccurrence(s, today, 0))
    .sort((a, b) => a.departureAbs - b.departureAbs)
}
