import { HttpRepository } from './httpRepository'
import { LocalJsonRepository } from './localJsonRepository'
import type { DataRepository, NewsQuery } from './types'

/**
 * Repositorio híbrido:
 *  - Módulos DINÁMICOS (noticias, alertas, agenda, obituarios) → API sobre D1.
 *  - Módulos ESTÁTICOS (horarios, feriados, mapa y lugares, Nuestro pueblo, radios, emergencias) → JSON validado.
 * Si la API falla, los módulos dinámicos muestran el error (nunca un vacío engañoso) y los estáticos siguen funcionando.
 */
export class HybridRepository implements DataRepository {
  constructor(
    private readonly api: Pick<HttpRepository, 'getNews' | 'getAlerts' | 'getEvents' | 'getObituaries' | 'getNewsItem' | 'getAlertItem' | 'getObituaryItem'> = new HttpRepository(),
    private readonly local: DataRepository = new LocalJsonRepository(),
  ) {}

  getNews = (q?: NewsQuery) => this.api.getNews(q)
  getAlerts = () => this.api.getAlerts()
  getEvents = () => this.api.getEvents()
  getObituaries = () => this.api.getObituaries()
  getNewsItem = (id: string) => this.api.getNewsItem(id)
  getAlertItem = (id: string) => this.api.getAlertItem(id)
  getObituaryItem = (id: string) => this.api.getObituaryItem(id)

  getRadios = () => this.local.getRadios()
  getHolidays = () => this.local.getHolidays()
  getTransport = () => this.local.getTransport()
  getPlaces = () => this.local.getPlaces()
  getEmergencyNumbers = () => this.local.getEmergencyNumbers()
  getHeritage = () => this.local.getHeritage()
  getWaste = () => this.local.getWaste()
}
