import { CircleHelp, MapPin, Phone } from 'lucide-react'
import { lazy, Suspense, useCallback, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { telHref } from '@/components/community/PlaceCard'
import { MapErrorBoundary } from '@/components/map/MapErrorBoundary'
import { ExternalLink } from '@/components/shared/ExternalLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { Async, EmptyState } from '@/components/shared/States'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { TILE_PROVIDER, TOWN } from '@/config/map'
import { useData } from '@/data/repository/DataContext'
import { PLACE_CATEGORY_LABEL, type Place } from '@/domain/community'
import {
  directionsUrl,
  filterByLayers,
  hasLocation,
  layerOfPlace,
  MAP_LAYERS,
  mappedPlaces,
  parseLayers,
  serializeLayers,
  unmappedPlaces,
  type LayerId,
} from '@/features/map/layers'
import { cn } from '@/lib/utils'

// El mapa (Leaflet) se descarga solo al entrar a esta pantalla: no forma parte del paquete inicial.
const PlacesMap = lazy(() => import('@/components/map/PlacesMap'))

const chip = (active: boolean) =>
  cn(
    'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition',
    active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted',
  )

function PlaceRow({ place, onShow }: { place: Place; onShow?: () => void }) {
  const directions = directionsUrl(place)
  return (
    <li>
      <Card className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">{PLACE_CATEGORY_LABEL[place.category]}</Badge>
          {!hasLocation(place) && <Badge tone="warning">Ubicación pendiente</Badge>}
        </div>
        <p className="font-display font-bold">
          <Link to={`/servicios/${place.id}`} className="underline-offset-2 hover:underline">
            {place.name}
          </Link>
        </p>
        {place.address && <p className="text-sm text-muted-foreground">{place.address}</p>}
        <div className="flex flex-wrap gap-2">
          {onShow && (
            <Button type="button" size="sm" variant="outline" onClick={onShow} aria-label={`Mostrar ${place.name} en el mapa`}>
              <MapPin className="size-4" aria-hidden />
              Ver en el mapa
            </Button>
          )}
          {place.phone && (
            <Button asChild size="sm" variant="outline">
              <a href={telHref(place.phone)} aria-label={`Llamar a ${place.name}`}>
                <Phone className="size-4" aria-hidden />
                Llamar
              </a>
            </Button>
          )}
          {directions && (
            <Button asChild size="sm" variant="outline">
              <a href={directions} target="_blank" rel="noopener noreferrer" aria-label={`Cómo llegar a ${place.name} (abre una aplicación de mapas externa)`}>
                Cómo llegar
              </a>
            </Button>
          )}
          <Button asChild size="sm">
            <Link to={`/servicios/${place.id}`}>Ver ficha</Link>
          </Button>
        </div>
      </Card>
    </li>
  )
}

export default function MapPage() {
  const [params, setParams] = useSearchParams()
  const active = useMemo(() => parseLayers(params.get('capas')), [params])
  const selectedId = params.get('lugar')
  const state = useData((r) => r.getPlaces())

  const update = useCallback(
    (next: { capas?: LayerId[]; lugar?: string | null }) => {
      const p = new URLSearchParams(params)
      if (next.capas) {
        const s = serializeLayers(next.capas)
        if (s) p.set('capas', s)
        else p.delete('capas')
      }
      if (next.lugar !== undefined) {
        if (next.lugar) p.set('lugar', next.lugar)
        else p.delete('lugar')
      }
      setParams(p, { replace: true })
    },
    [params, setParams],
  )

  const toggle = (id: LayerId) => update({ capas: active.includes(id) ? active.filter((x) => x !== id) : [...active, id] })

  return (
    <>
      <PageHeader icon={MapPin} title="Explorá Río Seco" subtitle="Lugares de interés con ubicación verificada. Mapa: OpenStreetMap." />

      <Async state={state} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={MapPin} title="Sin lugares cargados" />}>
        {(places) => {
          const visible = filterByLayers(places, active)
          const onMap = mappedPlaces(visible)
          const pending = unmappedPlaces(visible)
          const counts = new Map(MAP_LAYERS.map((l) => [l.id, places.filter((p) => layerOfPlace(p).id === l.id)]))
          const selected = onMap.find((p) => p.id === selectedId) ?? null

          return (
            <>
              <nav aria-label="Capas del mapa" className="mb-3">
                <ul className="flex flex-wrap gap-2">
                  <li>
                    <button type="button" className={chip(active.length === 0)} aria-pressed={active.length === 0} onClick={() => update({ capas: [], lugar: null })}>
                      Todas
                    </button>
                  </li>
                  {MAP_LAYERS.map((l) => {
                    const total = counts.get(l.id)?.length ?? 0
                    return (
                      <li key={l.id}>
                        <button type="button" className={chip(active.includes(l.id))} aria-pressed={active.includes(l.id)} onClick={() => toggle(l.id)}>
                          {l.label}
                          <span className="text-xs opacity-80">({total})</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </nav>

              <p className="mb-2 text-sm">
                <a href="#lista-de-lugares" className="font-semibold text-accent underline underline-offset-2">
                  Ir a la lista de lugares (alternativa en texto)
                </a>
              </p>

              <section
                aria-label="Mapa de Río Seco"
                className="relative mb-2 h-[62dvh] min-h-[22rem] overflow-hidden rounded-[var(--radius-card)] border border-border shadow-sm md:h-[34rem]"
              >
                <MapErrorBoundary>
                  <Suspense fallback={<div className="grid h-full place-items-center bg-muted text-sm font-semibold text-muted-foreground">Cargando mapa…</div>}>
                    <PlacesMap places={onMap} selectedId={selectedId} onSelect={(id) => update({ lugar: id })} />
                  </Suspense>
                </MapErrorBoundary>
              </section>
              <p className="mb-6 text-xs text-muted-foreground">
                Datos cartográficos © colaboradores de OpenStreetMap (licencia ODbL). Centrado en {TOWN.name}. Las ubicaciones provienen de OpenStreetMap y pueden requerir confirmación;
                cada ficha indica su fuente. {onMap.length === 0 && 'No hay lugares con ubicación en esta selección.'}{' '}
                <ExternalLink href={TILE_PROVIDER.termsUrl} className="font-semibold text-accent underline underline-offset-2">
                  Condiciones del proveedor de mapas
                </ExternalLink>
              </p>

              {selected && (
                <section aria-label="Lugar seleccionado" className="mb-6">
                  <h2 className="mb-2 font-display text-lg font-bold">Lugar seleccionado</h2>
                  <ul>
                    <PlaceRow place={selected} />
                  </ul>
                </section>
              )}

              <section id="lista-de-lugares" aria-label="Lista de lugares" className="mb-6 scroll-mt-24">
                <h2 className="mb-3 font-display text-lg font-bold">Lugares en el mapa ({onMap.length})</h2>
                {onMap.length === 0 ? (
                  <EmptyState icon={MapPin} title="Sin lugares con ubicación verificada en esta selección">
                    Probá con otra categoría. Los lugares sin ubicación confirmada se listan abajo.
                  </EmptyState>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {onMap.map((p) => (
                      <PlaceRow
                        key={p.id}
                        place={p}
                        onShow={() => {
                          update({ lugar: p.id })
                          document.querySelector('[aria-label="Mapa de Río Seco"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        }}
                      />
                    ))}
                  </ul>
                )}
              </section>

              <section aria-label="Lugares sin ubicación confirmada" className="mb-6">
                <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-bold">
                  <CircleHelp className="size-5 text-warning" aria-hidden />
                  Ubicación pendiente ({pending.length})
                </h2>
                <p className="mb-3 text-sm text-muted-foreground">
                  Figuran en su listado, pero no se colocan en el mapa hasta confirmar dónde están: una dirección escrita no alcanza para fijar un punto exacto.
                </p>
                {pending.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay lugares con ubicación pendiente en esta selección.</p>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {pending.map((p) => (
                      <PlaceRow key={p.id} place={p} />
                    ))}
                  </ul>
                )}
              </section>
            </>
          )
        }}
      </Async>
    </>
  )
}
