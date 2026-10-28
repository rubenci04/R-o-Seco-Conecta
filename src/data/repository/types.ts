import type { EmergencyNumber, HeritageSection, Place } from '@/domain/community'
import type { AlertItem, EventItem, Holiday, NewsItem, Obituary, Radio, TransportData } from '@/domain/types'

/**
 * Contrato de acceso a datos. Hoy lo implementa `LocalJsonRepository`;
 * en un sprint posterior puede implementarlo un repositorio respaldado por Cloudflare D1.
 */
/** Opciones de lectura del feed: filtro por categoría y paginación por fecha (cursor). */
export interface NewsQuery {
  category?: string
  /** ISO: solo publicaciones anteriores a esta fecha. */
  before?: string
  limit?: number
}

export interface DataRepository {
  getNews(query?: NewsQuery): Promise<NewsItem[]>
  getAlerts(): Promise<AlertItem[]>
  getEvents(): Promise<EventItem[]>
  getObituaries(): Promise<Obituary[]>
  /** Contenido puntual (lo abre una notificación). `null` si no existe o ya no está disponible. */
  getNewsItem(id: string): Promise<NewsItem | null>
  getAlertItem(id: string): Promise<AlertItem | null>
  getObituaryItem(id: string): Promise<Obituary | null>
  getRadios(): Promise<Radio[]>
  getHolidays(): Promise<Holiday[]>
  getTransport(): Promise<TransportData>
  getPlaces(): Promise<Place[]>
  getEmergencyNumbers(): Promise<EmergencyNumber[]>
  getHeritage(): Promise<HeritageSection[]>
}
