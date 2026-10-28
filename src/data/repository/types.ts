import type { EmergencyNumber, HeritageSection, Place } from '@/domain/community'
import type { AlertItem, EventItem, Holiday, NewsItem, Obituary, Radio, TransportData } from '@/domain/types'

/**
 * Contrato de acceso a datos. Hoy lo implementa `LocalJsonRepository`;
 * en un sprint posterior puede implementarlo un repositorio respaldado por Cloudflare D1.
 */
export interface DataRepository {
  getNews(): Promise<NewsItem[]>
  getAlerts(): Promise<AlertItem[]>
  getEvents(): Promise<EventItem[]>
  getObituaries(): Promise<Obituary[]>
  getRadios(): Promise<Radio[]>
  getHolidays(): Promise<Holiday[]>
  getTransport(): Promise<TransportData>
  getPlaces(): Promise<Place[]>
  getEmergencyNumbers(): Promise<EmergencyNumber[]>
  getHeritage(): Promise<HeritageSection[]>
}
