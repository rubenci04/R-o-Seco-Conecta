import { describe, expect, it } from 'vitest'
import places from '@/data/json/places.json'
import { TILE_PROVIDER, TOWN, isInsideTown } from '@/config/map'
import { PLACE_CATEGORIES, locationSchema, placesFileSchema, type Place } from '@/domain/community'
import {
  directionsUrl,
  filterByLayers,
  hasLocation,
  layerOfCategory,
  layerParamForCategory,
  LAYER_IDS,
  MAP_LAYERS,
  MARKER_TONES,
  mappedPlaces,
  parseLayers,
  serializeLayers,
  unmappedPlaces,
} from './layers'

const all = placesFileSchema.parse(places)

const contrast = (a: string, b: string) => {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('validación de coordenadas', () => {
  it('el catálogo cumple el esquema y cada ubicación declara fuente y fecha de consulta', () => {
    for (const p of all.filter(hasLocation)) {
      expect(p.location.source.url, p.id).toMatch(/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/)
      expect(p.location.source.date, p.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
  it('todas las coordenadas caen dentro del área de Río Seco', () => {
    for (const p of mappedPlaces(all)) expect(isInsideTown(p.location.lat, p.location.lng), `${p.id} ${p.location.lat},${p.location.lng}`).toBe(true)
    expect(isInsideTown(TOWN.center.lat, TOWN.center.lng)).toBe(true)
  })
  it('rechaza coordenadas inválidas o sin fuente', () => {
    const src = { label: 'x', url: 'https://www.openstreetmap.org/node/1' }
    expect(locationSchema.safeParse({ lat: 95, lng: -65, source: src }).success).toBe(false)
    expect(locationSchema.safeParse({ lat: -27, lng: -190, source: src }).success).toBe(false)
    expect(locationSchema.safeParse({ lat: -27.26, lng: -65.56 }).success).toBe(false) // sin procedencia
    expect(locationSchema.safeParse({ lat: -27.26, lng: -65.56, source: src }).success).toBe(true)
  })
  it('detecta coordenadas fuera de la localidad (p. ej. intercambio lat/lng o el origen 0,0)', () => {
    expect(isInsideTown(-65.56, -27.26)).toBe(false)
    expect(isInsideTown(0, 0)).toBe(false)
    expect(isInsideTown(-27.3507, -65.256)).toBe(false) // otro «Río Seco» (río en Simoca)
  })
  it('no hay dos lugares distintos en el mismo punto (sin marcadores apilados «aproximados»)', () => {
    const seen = new Map<string, string>()
    for (const p of mappedPlaces(all)) {
      const k = `${p.location.lat.toFixed(5)},${p.location.lng.toFixed(5)}`
      expect(seen.get(k), `${p.id} repite ${k} de ${seen.get(k)}`).toBeUndefined()
      seen.set(k, p.id)
    }
  })
  it('ningún lugar usa el centro del pueblo como ubicación por defecto', () => {
    for (const p of mappedPlaces(all)) expect([p.location.lat, p.location.lng]).not.toEqual([TOWN.center.lat, TOWN.center.lng])
  })
})

describe('lugares sin coordenadas', () => {
  it('la farmacia Santa Rita y el ingenio quedan en el listado con la ubicación pendiente', () => {
    const pend = unmappedPlaces(all).map((p) => p.id)
    expect(pend).toEqual(expect.arrayContaining(['farmacia-santa-rita', 'ingenio']))
    for (const p of unmappedPlaces(all)) {
      expect(p.location).toBeUndefined()
      expect(p.pending, p.id).toContain('location')
    }
  })
  it('un lugar con ubicación pendiente nunca declara coordenadas, y viceversa', () => {
    for (const p of all) expect(p.pending.includes('location'), p.id).toBe(!p.location)
  })
  it('las indicaciones usan coordenadas cuando existen y la dirección cuando no; sin ambas, nada', () => {
    const comisaria = all.find((p) => p.id === 'comisaria-rio-seco')!
    const farmacia = all.find((p) => p.id === 'farmacia-santa-rita')!
    expect(decodeURIComponent(directionsUrl(comisaria)!)).toContain('-27.268584,-65.560203')
    expect(decodeURIComponent(directionsUrl(farmacia)!)).toContain('Av. Himno Patrio 211')
    const sin: Place = { ...farmacia, address: undefined }
    expect(directionsUrl(sin)).toBeNull()
  })
})

describe('capas y filtros por categoría', () => {
  it('existen las nueve capas pedidas y todas las categorías de lugares pertenecen a una capa', () => {
    expect(LAYER_IDS).toEqual(['seguridad', 'salud', 'farmacias', 'administracion', 'educacion', 'cultura', 'religion', 'deporte', 'transporte'])
    for (const c of PLACE_CATEGORIES) expect(() => layerOfCategory(c)).not.toThrow()
    expect(new Set(MAP_LAYERS.map((l) => l.icon)).size).toBe(MAP_LAYERS.length) // un glifo distinto por capa
  })
  it('filtra por una o varias capas y sin filtro devuelve todo', () => {
    expect(filterByLayers(all, []).length).toBe(all.length)
    expect(filterByLayers(all, ['seguridad']).map((p) => p.id)).toEqual(['comisaria-rio-seco'])
    const sal = filterByLayers(all, ['salud', 'farmacias']).map((p) => p.category)
    expect(new Set(sal)).toEqual(new Set(['salud', 'farmacias']))
    expect(filterByLayers(all, ['educacion']).length).toBe(6)
    expect(filterByLayers(all, ['transporte'])).toEqual([]) // sin paradas verificadas todavía
  })
  it('la capa de administración agrupa Comuna y espacios comunitarios', () => {
    expect(new Set(filterByLayers(all, ['administracion']).map((p) => p.category))).toEqual(new Set(['comuna', 'comunitarios']))
  })
  it('las capas se serializan en la URL y se leen de forma segura', () => {
    expect(parseLayers('salud,farmacias')).toEqual(['salud', 'farmacias'])
    expect(parseLayers('salud, salud ,inventada,<script>')).toEqual(['salud'])
    expect(parseLayers(null)).toEqual([])
    expect(serializeLayers(['salud', 'farmacias'])).toBe('salud,farmacias')
    expect(serializeLayers([])).toBeNull()
    expect(serializeLayers([...LAYER_IDS])).toBeNull()
    expect(layerParamForCategory('iglesias')).toBe('religion')
    expect(layerParamForCategory(null)).toBeNull()
  })
})

describe('marcadores y proveedor', () => {
  it('el glifo blanco sobre cada fondo de marcador supera el contraste 4.5:1', () => {
    for (const [tone, hex] of Object.entries(MARKER_TONES)) expect(contrast('#ffffff', hex), tone).toBeGreaterThanOrEqual(4.5)
  })
  it('el proveedor por defecto es OpenStreetMap, con atribución visible y límites de zoom prudentes', () => {
    expect(TILE_PROVIDER.id).toBe('osm')
    expect(TILE_PROVIDER.url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
    expect(TILE_PROVIDER.attribution).toContain('OpenStreetMap')
    expect(TILE_PROVIDER.attribution).toContain('https://www.openstreetmap.org/copyright')
    expect(TILE_PROVIDER.minZoom).toBeGreaterThanOrEqual(12)
    expect(TILE_PROVIDER.maxZoom).toBeLessThanOrEqual(19)
    expect(TILE_PROVIDER.termsUrl).toContain('operations.osmfoundation.org')
  })
})
