import type { DayType, Direction, Service } from '@/domain/types'

export type SearchMode = 'next' | 'arrive-by' | 'all'

export interface BusQuery {
  direction: Direction
  localityId: string
  /** "auto" = según la fecha de hoy en Tucumán */
  dayType: DayType | 'auto'
  mode: SearchMode
  /** HH:mm, requerido para "arrive-by" */
  time?: string
  companyId?: string
  serviceType?: Service['serviceType']
}

export const DEFAULT_QUERY: BusQuery = {
  direction: 'from-rio-seco',
  localityId: 'concepcion',
  dayType: 'auto',
  mode: 'next',
}

export function swapDirection(d: Direction): Direction {
  return d === 'from-rio-seco' ? 'to-rio-seco' : 'from-rio-seco'
}

const DIRECTIONS: Direction[] = ['from-rio-seco', 'to-rio-seco']
const DAY_TYPES = ['auto', 'weekday', 'saturday', 'sunday', 'holiday']
const SERVICE_TYPES = ['común', 'semirrápido', 'rápido', 'diferencial']
const MODES: SearchMode[] = ['next', 'arrive-by', 'all']

export function queryToParams(q: BusQuery): URLSearchParams {
  const p = new URLSearchParams({ sentido: q.direction, localidad: q.localityId, dia: q.dayType, modo: q.mode })
  if (q.time) p.set('hora', q.time)
  if (q.companyId) p.set('empresa', q.companyId)
  if (q.serviceType) p.set('servicio', q.serviceType)
  return p
}

export function paramsToQuery(p: URLSearchParams): BusQuery {
  const direction = p.get('sentido') as Direction
  const dayType = p.get('dia') ?? ''
  const mode = p.get('modo') as SearchMode
  const time = p.get('hora')
  return {
    direction: DIRECTIONS.includes(direction) ? direction : DEFAULT_QUERY.direction,
    localityId: p.get('localidad') || DEFAULT_QUERY.localityId,
    dayType: DAY_TYPES.includes(dayType) ? (dayType as BusQuery['dayType']) : 'auto',
    mode: MODES.includes(mode) ? mode : 'next',
    time: time && /^\d{2}:\d{2}$/.test(time) ? time : undefined,
    companyId: p.get('empresa') || undefined,
    serviceType: SERVICE_TYPES.includes(p.get('servicio') as never) ? (p.get('servicio') as BusQuery['serviceType']) : undefined,
  }
}
