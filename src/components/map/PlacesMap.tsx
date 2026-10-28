import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './map.css'
import { LocateFixed, Navigation, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AttributionControl, Circle, CircleMarker, MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { TILE_PROVIDER, TOWN } from '@/config/map'
import { PLACE_CATEGORY_LABEL } from '@/domain/community'
import { directionsUrl, layerOfPlace, type MappedPlace } from '@/features/map/layers'
import { telHref } from '@/components/community/PlaceCard'
import { markerIcon } from './markerIcon'

export type LocateState = 'idle' | 'locating' | 'found' | 'denied' | 'unavailable' | 'unsupported'

interface Props {
  places: MappedPlace[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}

const bounds = L.latLngBounds([TOWN.bounds.south, TOWN.bounds.west], [TOWN.bounds.north, TOWN.bounds.east])
/** Tras estos errores de teselas sin ninguna carga exitosa se avisa que el mapa base no está disponible. */
export const TILE_ERROR_LIMIT = 4

const LOCATE_MESSAGE: Record<Exclude<LocateState, 'idle' | 'locating' | 'found'>, string> = {
  denied: 'No se activó tu ubicación: el permiso fue rechazado. Podés seguir usando el mapa sin ella.',
  unavailable: 'No pudimos obtener tu ubicación en este momento. Probá de nuevo o seguí sin ella.',
  unsupported: 'Este dispositivo o navegador no permite obtener la ubicación.',
}

function PlacePopup({ place }: { place: MappedPlace }) {
  const directions = directionsUrl(place)
  return (
    <div className="space-y-1.5 text-sm">
      <p className="text-xs font-semibold text-[#0a5a80]">{PLACE_CATEGORY_LABEL[place.category]}</p>
      <h3 className="text-base font-bold leading-snug">{place.name}</h3>
      {place.address && <p>{place.address}</p>}
      {place.phone && (
        <p>
          <a className="font-semibold text-[#0a5a80] underline" href={telHref(place.phone)}>
            Llamar al {place.phone}
          </a>
        </p>
      )}
      {place.pending.length > 0 && <p className="text-xs text-[#8f4300]">Hay datos pendientes de confirmación.</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <Link className="rounded-full bg-[#0b6b97] px-3 py-1.5 text-xs font-bold !text-white" to={`/servicios/${place.id}`}>
          Ver ficha
        </Link>
        {directions && (
          <a className="rounded-full border border-[#0b6b97] px-3 py-1.5 text-xs font-bold text-[#0a5a80]" href={directions} target="_blank" rel="noopener noreferrer">
            Cómo llegar
            <span className="sr-only"> (abre una aplicación de mapas externa)</span>
          </a>
        )}
      </div>
    </div>
  )
}

export default function PlacesMap({ places, selectedId, onSelect }: Props) {
  // El mapa se guarda en estado (no en una ref): react-leaflet lo entrega tras montarse y los efectos deben reaccionar a eso.
  const [map, setMap] = useState<L.Map | null>(null)
  const markerRefs = useRef(new Map<string, L.Marker>())
  const [tileErrors, setTileErrors] = useState(0)
  const [tilesLoaded, setTilesLoaded] = useState(0)
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && navigator.onLine === false)
  const [locate, setLocate] = useState<LocateState>('idle')
  const [me, setMe] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)
  const [hint, setHint] = useState(false)
  // En pantallas táctiles un dedo desplaza la página y dos dedos mueven/acercan el mapa (sin trampas de scroll).
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

  // Aviso para pantallas táctiles: un dedo desplaza la página, dos dedos mueven el mapa.
  useEffect(() => {
    const el = map?.getContainer()
    if (!coarse || !el) return
    const start = (e: TouchEvent) => e.touches.length === 1 && setHint(true)
    const end = () => setTimeout(() => setHint(false), 1800)
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchend', end, { passive: true })
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchend', end)
    }
  }, [map, coarse])

  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const selected = useMemo(() => places.find((p) => p.id === selectedId) ?? null, [places, selectedId])

  // Centrar y abrir el globo del lugar seleccionado (desde la URL, la lista o un marcador).
  useEffect(() => {
    if (!map || !selected) return
    const marker = markerRefs.current.get(selected.id)
    map.flyTo([selected.location.lat, selected.location.lng], Math.max(map.getZoom(), 17), { duration: 0.6 })
    marker?.openPopup()
    // Al terminar el desplazamiento se vuelve a abrir el globo para que el auto-ajuste lo deje completo dentro del mapa.
    const reopen = () => marker?.openPopup()
    map.once('moveend', reopen)
    return () => void map.off('moveend', reopen)
  }, [map, selected])

  const recenter = useCallback(() => {
    onSelect(null)
    map?.closePopup()
    map?.flyTo([TOWN.center.lat, TOWN.center.lng], TOWN.zoom, { duration: 0.6 })
  }, [map, onSelect])

  /** La ubicación se pide SOLO al tocar el botón; no se guarda ni se envía a ningún servidor. */
  const askLocation = useCallback(() => {
    if (!('geolocation' in navigator)) return setLocate('unsupported')
    setLocate('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }
        setMe(p)
        setLocate('found')
        map?.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 16))
      },
      (err) => setLocate(err.code === 1 ? 'denied' : 'unavailable'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    )
  }, [map])

  const tilesFailed = offline || (tileErrors >= TILE_ERROR_LIMIT && tilesLoaded === 0)

  return (
    <div className="flex h-full w-full flex-col" data-testid="places-map">
      {/* Barra de acciones fuera del lienzo: nunca tapa marcadores, globos ni controles del mapa. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card p-2">
        <Button type="button" size="sm" variant="outline" onClick={recenter}>
          <Navigation className="size-4" aria-hidden />
          Centro del pueblo
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={askLocation} disabled={locate === 'locating'} aria-describedby="locate-status">
          <LocateFixed className="size-4" aria-hidden />
          {locate === 'locating' ? 'Buscando…' : 'Mi ubicación'}
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
      <MapContainer
        ref={setMap}
        center={[TOWN.center.lat, TOWN.center.lng]}
        zoom={TOWN.zoom}
        minZoom={TILE_PROVIDER.minZoom}
        maxZoom={TILE_PROVIDER.maxZoom}
        maxBounds={bounds}
        maxBoundsViscosity={0.9}
        dragging={!coarse}
        touchZoom
        scrollWheelZoom={false}
        className="rs-map absolute inset-0"
        attributionControl={false}
        keyboard
        aria-label="Mapa interactivo de Río Seco"
      >
        {/* Solo la atribución de los datos (OpenStreetMap), con enlaces seguros; sin el prefijo de Leaflet. */}
        <AttributionControl prefix={false} position="bottomright" />
        <TileLayer
          url={TILE_PROVIDER.url}
          attribution={TILE_PROVIDER.attribution}
          minZoom={TILE_PROVIDER.minZoom}
          maxZoom={TILE_PROVIDER.maxZoom}
          eventHandlers={{ tileerror: () => setTileErrors((n) => n + 1), tileload: () => setTilesLoaded((n) => n + 1) }}
        />

        {places.map((p) => (
          <Marker
            key={p.id}
            position={[p.location.lat, p.location.lng]}
            icon={markerIcon(layerOfPlace(p), `${p.name}, ${PLACE_CATEGORY_LABEL[p.category]}`, p.id === selectedId)}
            alt={`${p.name}, ${PLACE_CATEGORY_LABEL[p.category]}`}
            title={p.name}
            keyboard
            ref={(m) => {
              if (m) markerRefs.current.set(p.id, m)
              else markerRefs.current.delete(p.id)
            }}
            eventHandlers={{ click: () => onSelect(p.id) }}
          >
            <Popup maxWidth={280} autoPanPaddingTopLeft={[16, 64]} autoPanPaddingBottomRight={[16, 40]}>
              <PlacePopup place={p} />
            </Popup>
          </Marker>
        ))}

        {me && (
          <>
            <Circle center={[me.lat, me.lng]} radius={Math.min(me.accuracy, 500)} pathOptions={{ color: '#0b6b97', weight: 1, fillOpacity: 0.12 }} />
            <CircleMarker center={[me.lat, me.lng]} radius={8} className="rs-me" pathOptions={{ color: '#fff', weight: 3, fillColor: '#0b6b97', fillOpacity: 1 }}>
              <Popup>Estás aquí (ubicación aproximada, solo visible en tu dispositivo).</Popup>
            </CircleMarker>
          </>
        )}
      </MapContainer>

      {hint && (
        <p role="status" className="pointer-events-none absolute inset-x-6 top-1/2 z-[600] -translate-y-1/2 rounded-xl bg-[#073049]/90 p-3 text-center text-sm font-semibold text-white">
          Usá dos dedos para mover el mapa
        </p>
      )}

      <div id="locate-status" role="status" className="absolute inset-x-2 bottom-24 z-[500]">
        {locate === 'found' && <p className="rounded-xl bg-white/95 p-2 text-xs font-semibold text-[#0a2433] shadow">Ubicación encontrada. Solo se usa en tu dispositivo y no se guarda.</p>}
        {(locate === 'denied' || locate === 'unavailable' || locate === 'unsupported') && (
          <p className="rounded-xl bg-white/95 p-2 text-xs font-semibold text-[#8f4300] shadow">{LOCATE_MESSAGE[locate]}</p>
        )}
      </div>

      {tilesFailed && (
        <p role="alert" className="absolute inset-x-2 bottom-10 z-[550] flex gap-2 rounded-xl bg-white/95 p-2.5 text-xs font-semibold text-[#8f4300] shadow-md sm:max-w-xs">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {offline ? 'Sin conexión: el mapa base no se puede mostrar.' : 'No se pudo cargar el mapa base de OpenStreetMap.'} La lista de lugares, teléfonos y fichas sigue disponible.
        </p>
      )}
      </div>
    </div>
  )
}
