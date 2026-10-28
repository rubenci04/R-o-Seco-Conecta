import type { ZodType } from 'zod'
import * as schemas from '@/domain/schemas'
import { emergencyFileSchema, heritageFileSchema, placesFileSchema } from '@/domain/community'
import { schedulesDatasetSchema } from '@/domain/schedules'
import { expandSchedules } from '@/features/transport/expand'
import alerts from '../json/alerts.json'
import events from '../json/events.json'
import holidays from '../json/holidays.json'
import news from '../json/news.json'
import obituaries from '../json/obituaries.json'
import emergency from '../json/emergency.json'
import heritage from '../json/heritage.json'
import places from '../json/places.json'
import radios from '../json/radios.json'
import type { DataRepository, NewsQuery } from './types'

function parse<T>(schema: ZodType<T>, raw: unknown, name: string): T {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Datos inválidos en ${name}: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
  }
  return result.data
}

export class LocalJsonRepository implements DataRepository {
  getNews = async (q: NewsQuery = {}) =>
    parse(schemas.newsFileSchema, news, 'news.json')
      .filter((n) => (!q.category || n.categories?.includes(q.category)) && (!q.before || n.publishedAt < q.before))
      .slice(0, q.limit ?? 50)
  getAlerts = async () => parse(schemas.alertsFileSchema, alerts, 'alerts.json')
  getEvents = async () => parse(schemas.eventsFileSchema, events, 'events.json')
  getObituaries = async () => parse(schemas.obituariesFileSchema, obituaries, 'obituaries.json')
  getNewsItem = async (id: string) => parse(schemas.newsFileSchema, news, 'news.json').find((n) => n.id === id) ?? null
  getAlertItem = async (id: string) => parse(schemas.alertsFileSchema, alerts, 'alerts.json').find((a) => a.id === id) ?? null
  getObituaryItem = async (id: string) => parse(schemas.obituariesFileSchema, obituaries, 'obituaries.json').find((o) => o.id === id) ?? null
  getRadios = async () => parse(schemas.radiosFileSchema, radios, 'radios.json')
  getHolidays = async () => parse(schemas.holidaysFileSchema, holidays, 'holidays.json')
  getPlaces = async () => parse(placesFileSchema, places, 'places.json')
  getEmergencyNumbers = async () => parse(emergencyFileSchema, emergency, 'emergency.json')
  getHeritage = async () => parse(heritageFileSchema, heritage, 'heritage.json')
  // Los horarios (≈200 KB) se cargan bajo demanda: solo al entrar a Colectivos o al ver el próximo colectivo.
  getTransport = async () => {
    const { default: raw } = await import('../json/schedules.json')
    return expandSchedules(parse(schedulesDatasetSchema, raw, 'schedules.json'))
  }
}
