import type { Place, PlaceCategory, PlaceLocation } from '@/domain/community'
import { PLACE_CATEGORIES } from '@/domain/community'
import { mapLinks } from '@/config/links'

export type LayerId = 'seguridad' | 'salud' | 'farmacias' | 'administracion' | 'educacion' | 'cultura' | 'religion' | 'deporte' | 'transporte'

/** Colores de los marcadores: texto blanco sobre cada fondo supera 4.5:1 (se comprueba en las pruebas). */
export const MARKER_TONES = { navy: '#073049', orange: '#b73b08', celeste: '#0b6b97' } as const
export type MarkerTone = keyof typeof MARKER_TONES

export interface MapLayer {
  id: LayerId
  label: string
  /** Categorías de «Servicios y lugares» que alimentan la capa. */
  categories: PlaceCategory[]
  tone: MarkerTone
  /** Nombre del ícono (ver `markerIcon.tsx`); cada capa tiene un glifo distinto, no solo un color. */
  icon: 'shield' | 'heart' | 'pill' | 'landmark' | 'school' | 'book' | 'church' | 'trophy' | 'bus'
}

export const MAP_LAYERS: MapLayer[] = [
  { id: 'seguridad', label: 'Seguridad', categories: ['policia'], tone: 'navy', icon: 'shield' },
  { id: 'salud', label: 'Salud', categories: ['salud'], tone: 'orange', icon: 'heart' },
  { id: 'farmacias', label: 'Farmacias', categories: ['farmacias'], tone: 'orange', icon: 'pill' },
  { id: 'administracion', label: 'Administración pública', categories: ['comuna', 'comunitarios'], tone: 'navy', icon: 'landmark' },
  { id: 'educacion', label: 'Educación', categories: ['educacion'], tone: 'celeste', icon: 'school' },
  { id: 'cultura', label: 'Cultura', categories: ['cultural'], tone: 'celeste', icon: 'book' },
  { id: 'religion', label: 'Religión', categories: ['iglesias'], tone: 'navy', icon: 'church' },
  { id: 'deporte', label: 'Deporte', categories: ['clubes'], tone: 'celeste', icon: 'trophy' },
  { id: 'transporte', label: 'Transporte', categories: ['transporte'], tone: 'orange', icon: 'bus' },
]

export const LAYER_IDS = MAP_LAYERS.map((l) => l.id)

export function layerOfCategory(category: PlaceCategory): MapLayer {
  const layer = MAP_LAYERS.find((l) => l.categories.includes(category))
  if (!layer) throw new Error(`Categoría sin capa de mapa: ${category}`)
  return layer
}

export const layerOfPlace = (p: Place) => layerOfCategory(p.category)

export type MappedPlace = Place & { location: PlaceLocation }

/** Solo los lugares con coordenadas respaldadas por una fuente van al mapa. */
export const hasLocation = (p: Place): p is MappedPlace => !!p.location

export const mappedPlaces = (places: Place[]): MappedPlace[] => places.filter(hasLocation)
export const unmappedPlaces = (places: Place[]): Place[] => places.filter((p) => !hasLocation(p))

/** Capas activas desde la URL (`?capas=salud,farmacias`). Valores desconocidos se ignoran; vacío = todas. */
export function parseLayers(param: string | null | undefined): LayerId[] {
  const ids = (param ?? '').split(',').map((s) => s.trim()).filter((s): s is LayerId => (LAYER_IDS as string[]).includes(s))
  return [...new Set(ids)]
}

export const serializeLayers = (ids: LayerId[]): string | null => (ids.length === 0 || ids.length === LAYER_IDS.length ? null : ids.join(','))

export function filterByLayers<T extends Place>(places: T[], active: LayerId[]): T[] {
  if (active.length === 0) return places
  const cats = new Set(MAP_LAYERS.filter((l) => active.includes(l.id)).flatMap((l) => l.categories))
  return places.filter((p) => cats.has(p.category))
}

/** Capa que corresponde a una categoría de Servicios (para compartir el filtro entre ambas pantallas). */
export const layerParamForCategory = (category: PlaceCategory | null): string | null => (category ? layerOfCategory(category).id : null)

/** Ruta del mapa centrada en un lugar. */
export const mapHref = (placeId: string) => `/mapa?lugar=${encodeURIComponent(placeId)}`

/** Indicaciones: con coordenadas verificadas se usan estas; si no, la dirección textual (sin inventar un punto). */
export function directionsUrl(p: Place): string | null {
  if (p.location) return mapLinks.directions(`${p.location.lat},${p.location.lng}`)
  if (p.address) return mapLinks.directions(`${p.name}, ${p.address}, Río Seco, Tucumán, Argentina`)
  return null
}

export const osmViewUrl = (loc: Pick<PlaceLocation, 'lat' | 'lng'>) =>
  `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}#map=18/${loc.lat}/${loc.lng}`

export { PLACE_CATEGORIES }
