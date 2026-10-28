/**
 * Paso 2 del importador: instantáneas de la fuente → dataset tipado (`src/data/json/schedules.json`) + informe de verificación.
 * Reglas: no se agregan, interpolan ni "completan" horarios; cada viaje conserva solo las horas que la fuente informa.
 */
import { schedulesDatasetSchema, type SchedulePage, type SchedulesDataset } from '../../src/domain/schedules.ts'
import { expandSchedules } from '../../src/features/transport/expand.ts'
import type { PageSnapshot, RawRoute, RawTrip } from './extract.ts'

const HUB_NAME = 'Río Seco'
const SERVICE_TYPES: Record<string, 'común' | 'semirrápido'> = { 'común': 'común', 'semirápido': 'semirrápido', 'semirrapido': 'semirrápido' }

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const clean = (v: string | undefined) => (v && v !== '$undefined' ? v : undefined)

export const SOURCE = {
  label: 'Colectivos Tucumán',
  url: 'https://colectivostucuman.com.ar/',
  reuseAuthorized: true,
}

export const DATASET_NOTES = [
  'Procedencia declarada por el responsable del proyecto: fotografías de boleterías, planillas Excel y relevamiento presencial; publicados en colectivostucuman.com.ar. La autorización de reutilización fue afirmada por el responsable; conviene dejar constancia escrita del autor del sitio.',
  'El símbolo "~" delante de una hora marca un horario aproximado: en algunos servicios el colectivo para en Río Seco aunque no figura en la grilla oficial.',
  'Las horas posteriores a la medianoche (00:xx–03:xx) pertenecen al día operativo anterior: se guardan tal cual y se interpretan como 24:xx–27:xx del día de servicio.',
  'La fuente agrupa "domingos y feriados" en un único cuadro; los feriados usan los horarios de domingo.',
  'Las paradas sin hora informada se conservan como null; no se deducen horarios mediante progresiones.',
]

function tripOf(route: RawRoute, trip: RawTrip): SchedulePage['routes'][number]['trips'][number] {
  const tag = (trip.tags[0] ?? route.name.split(' ')[0]).toLowerCase()
  const serviceType = SERVICE_TYPES[tag]
  if (!serviceType) throw new Error(`Tipo de servicio desconocido «${trip.tags[0]}» en el viaje ${trip.id} de ${route.name}`)
  const byStop = new Map(trip.stopTimes.map((t) => [t.routeStopId, t]))
  const times = route.stops.map((s) => {
    const t = byStop.get(s.id)
    return t ? `${s.isEstimated || t.isEstimated ? '~' : ''}${t.arrivalTime}` : null
  })
  return { dayType: trip.dayType, serviceType, times }
}

export function buildDataset(snapshots: PageSnapshot[]): SchedulesDataset {
  const companies = new Map<string, string>()
  const pages: SchedulePage[] = []

  for (const snap of [...snapshots].sort((a, b) => `${a.origin}>${a.destination}`.localeCompare(`${b.origin}>${b.destination}`))) {
    const toHub = snap.destination === 'rio-seco'
    const other = toHub ? snap.origin : snap.destination
    const first = snap.props.routes.flatMap((r) => r.stops)
    const otherName = first.find((s) => slug(s.city) === other)?.city
    if (!otherName) throw new Error(`No se pudo resolver el nombre de la localidad «${other}»`)

    const companyNames = snap.props.companies as unknown as Record<string, string>
    const routes = snap.props.routes.map((r) => {
      const companyName = companyNames[r.profileId] ?? r.profileId
      companies.set(slug(companyName), companyName)
      const stops = r.stops.map((s) => ({ city: s.city, ...(clean(s.commentary) ? { note: clean(s.commentary) } : {}) }))
      const ends = toHub ? [stops[0].city, stops[stops.length - 1].city] : [stops[0].city, stops[stops.length - 1].city]
      const hubAt = toHub ? ends[1] : ends[0]
      if (hubAt !== HUB_NAME) throw new Error(`La ruta ${r.name} de ${snap.url} no termina/empieza en ${HUB_NAME}`)
      return { name: r.name, companyId: slug(companyName), stops, trips: r.trips.map((t) => tripOf(r, t)) }
    })

    pages.push({
      localityId: other,
      localityName: otherName,
      direction: toHub ? 'to-rio-seco' : 'from-rio-seco',
      url: snap.url,
      routes,
      declared: snap.summary.declared,
      faqUniqueTimes: { weekday: snap.summary.faq.weekday.length, saturday: snap.summary.faq.saturday.length, sunday: snap.summary.faq.sunday.length },
    })
  }

  const fetchedAt = snapshots.map((s) => s.fetchedAt).sort()[0]
  return schedulesDatasetSchema.parse({
    source: SOURCE,
    fetchedAt,
    notes: DATASET_NOTES,
    companies: [...companies].map(([id, name]) => ({ id, name })),
    pages,
  })
}

// ------------------------------------------------------------------ verificación

export interface PageCount {
  page: string
  direction: 'from-rio-seco' | 'to-rio-seco'
  locality: string
  imported: { weekday: number; saturday: number; sunday: number }
  declared: { weekday: number | null; saturday: number | null; sunday: number | null }
  faqUniqueTimes: { weekday: number; saturday: number; sunday: number }
  matchesDeclared: boolean
  /** Diferencias entre servicios reales y horarios distintos de la FAQ, explicadas con los registros. */
  faqDifferences: { dayType: string; services: number; faqTimes: number; repeatedDepartures: string[] }[]
}

export interface ImportReport {
  generatedFromFetchAt: string
  pagesImported: number
  totalServices: { weekday: number; saturday: number; sunday: number }
  perPage: PageCount[]
  routesWithoutServices: string[]
  mismatches: string[]
}

export function buildReport(ds: SchedulesDataset): ImportReport {
  const perPage: PageCount[] = []
  const routesWithoutServices: string[] = []
  const mismatches: string[] = []
  const total = { weekday: 0, saturday: 0, sunday: 0 }

  for (const p of ds.pages) {
    const imported = { weekday: 0, saturday: 0, sunday: 0 }
    const deps: Record<string, string[]> = { weekday: [], saturday: [], sunday: [] }
    for (const r of p.routes) for (const t of r.trips) {
      imported[t.dayType]++
      deps[t.dayType].push((t.times[0] ?? '').replace('~', ''))
    }
    const label = p.direction === 'from-rio-seco' ? `Río Seco → ${p.localityName}` : `${p.localityName} → Río Seco`
    // Una página sin cartel de totales equivale a 0 salidas (la fuente no muestra el cartel).
    const norm = (n: number | null) => n ?? 0
    const ok = (['weekday', 'saturday', 'sunday'] as const).every((d) => imported[d] === norm(p.declared[d]))
    if (!ok) mismatches.push(`${label}: importados ${JSON.stringify(imported)} ≠ declarados ${JSON.stringify(p.declared)}`)

    const faqDifferences = (['weekday', 'saturday', 'sunday'] as const)
      .filter((d) => imported[d] !== p.faqUniqueTimes[d])
      .map((d) => {
        const seen = new Set<string>()
        const repeated = new Set<string>()
        for (const t of deps[d]) (seen.has(t) ? repeated : seen).add(t)
        return { dayType: d, services: imported[d], faqTimes: p.faqUniqueTimes[d], repeatedDepartures: [...repeated].sort() }
      })

    if (imported.weekday + imported.saturday + imported.sunday === 0) routesWithoutServices.push(label)
    for (const d of ['weekday', 'saturday', 'sunday'] as const) total[d] += imported[d]
    perPage.push({ page: p.url, direction: p.direction, locality: p.localityName, imported, declared: p.declared, faqUniqueTimes: p.faqUniqueTimes, matchesDeclared: ok, faqDifferences })
  }

  // Las diferencias con la FAQ deben explicarse SOLO por salidas repetidas; cualquier otra es un error de importación.
  for (const p of perPage) {
    for (const d of p.faqDifferences) {
      if (d.services - d.faqTimes !== d.repeatedDepartures.length && !(d.services - d.faqTimes === 0)) {
        mismatches.push(`${p.locality} (${d.dayType}): la diferencia con la FAQ (${d.services} vs ${d.faqTimes}) no se explica por salidas repetidas (${d.repeatedDepartures.join(', ') || 'ninguna'})`)
      }
    }
  }

  // El modelo expandido debe conservar la cantidad exacta de servicios.
  const expanded = expandSchedules(ds).services.length
  const sum = total.weekday + total.saturday + total.sunday
  if (expanded !== sum) mismatches.push(`La expansión generó ${expanded} servicios y el dataset tiene ${sum}`)

  return { generatedFromFetchAt: ds.fetchedAt, pagesImported: ds.pages.length, totalServices: total, perPage, routesWithoutServices, mismatches }
}
