import type { SchedulesDataset } from '@/domain/schedules'
import type { Service, Stop, TransportData } from '@/domain/types'
import { HUB_ID, HUB_NAME, slugify } from './slug'
import { MINUTES_PER_DAY } from './time'

/** Antes de esta hora una salida se interpreta como madrugada del día operativo anterior (00:10 → 24:10). */
export const AFTER_MIDNIGHT_BEFORE_MINUTES = 4 * 60

export const APPROXIMATE_NOTE =
  'Horario aproximado: en algunos servicios el colectivo para en Río Seco aunque no figura en la grilla oficial de la empresa. Conviene esperarlo unos minutos antes.'

const parse = (hhmm: string) => {
  const [h, m] = hhmm.replace('~', '').split(':').map(Number)
  return h * 60 + m
}
const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** Minutos del día operativo: la madrugada pertenece al día de servicio anterior (suma 24 h). */
export const toServiceMinutes = (hhmm: string) => {
  const m = parse(hhmm)
  return m < AFTER_MIDNIGHT_BEFORE_MINUTES ? m + MINUTES_PER_DAY : m
}

export const stopKey = (city: string, note?: string) => slugify(note ? `${city} ${note}` : city)
export const stopLabel = (city: string, note?: string) => (note ? `${city} (${note})` : city)

/**
 * Convierte el dataset importado al modelo que usa el buscador. Es una transformación PURA:
 * no inventa viajes, no interpola horas y conserva las marcas de aproximado y las paradas sin hora.
 */
export function expandSchedules(ds: SchedulesDataset): TransportData {
  const stops = new Map<string, Stop>()
  const services: Service[] = []
  const withData = new Set<string>()
  const lastVerified = ds.fetchedAt.slice(0, 10)

  const addStop = (city: string, note?: string) => {
    const id = stopKey(city, note)
    if (!stops.has(id)) stops.set(id, { id, name: stopLabel(city, note), localityId: slugify(city) })
    return id
  }

  for (const page of ds.pages) {
    page.routes.forEach((route, ri) => {
      route.trips.forEach((trip, ti) => {
        const last = route.stops.length - 1
        const depRaw = trip.times[0]
        const arrRaw = trip.times[last]
        if (!depRaw) return // sin hora de salida no hay servicio que mostrar
        const dep = toServiceMinutes(depRaw)
        let arr = arrRaw ? toServiceMinutes(arrRaw) : undefined
        if (arr !== undefined && arr < dep) arr += MINUTES_PER_DAY

        const approximate = depRaw.startsWith('~')
        const inner = route.stops.slice(1, last).map((s, i) => {
          const raw = trip.times[i + 1]
          return { name: stopLabel(s.city, s.note), time: raw ? fmt(toServiceMinutes(raw)) : null, approximate: !!raw?.startsWith('~') }
        })
        const prefix = page.direction === 'from-rio-seco' ? 'ida' : 'vuelta'
        withData.add(page.localityId)
        services.push({
          id: `${page.localityId}.${prefix}.${ri}.${trip.dayType}.${ti}`,
          companyId: route.companyId,
          localityId: page.localityId,
          direction: page.direction,
          originStopId: addStop(route.stops[0].city, route.stops[0].note),
          destinationStopId: addStop(route.stops[last].city, route.stops[last].note),
          departure: fmt(dep),
          arrival: arr === undefined ? undefined : fmt(arr),
          serviceType: trip.serviceType,
          dayTypes: trip.dayType === 'sunday' ? ['sunday', 'holiday'] : [trip.dayType],
          precision: approximate ? 'approximate' : 'confirmed',
          source: ds.source.url === page.url ? ds.source : { ...ds.source, url: page.url },
          lastVerified,
          exceptions: [],
          durationMinutes: arr === undefined ? undefined : arr - dep,
          observations: approximate ? APPROXIMATE_NOTE : undefined,
          routeName: route.name,
          arrivalApproximate: arrRaw ? arrRaw.startsWith('~') : undefined,
          stopTimes: inner.length ? inner : undefined,
        })
        route.stops.forEach((s) => addStop(s.city, s.note))
      })
      route.stops.forEach((s) => addStop(s.city, s.note))
    })
  }

  const localities = new Map<string, { id: string; name: string; status: 'verificado' | 'sin-datos'; referenceUrl?: string }>()
  for (const page of ds.pages) {
    const prev = localities.get(page.localityId)
    localities.set(page.localityId, {
      id: page.localityId,
      name: page.localityName,
      status: withData.has(page.localityId) ? 'verificado' : 'sin-datos',
      referenceUrl: prev?.referenceUrl ?? (page.direction === 'from-rio-seco' ? page.url : prev?.referenceUrl) ?? page.url,
    })
  }
  stops.set(HUB_ID, { id: HUB_ID, name: HUB_NAME, localityId: HUB_ID })

  return {
    companies: ds.companies,
    localities: [...localities.values()].sort((a, b) => Number(b.status === 'verificado') - Number(a.status === 'verificado') || a.name.localeCompare(b.name, 'es')),
    stops: [...stops.values()],
    services,
  }
}
