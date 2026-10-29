import { MapPin } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { PhotoGallery } from '@/components/community/PhotoGallery'
import { PlaceCard } from '@/components/community/PlaceCard'
import { PLACE_PHOTOS } from '@/config/photos'
import { ExternalLink } from '@/components/shared/ExternalLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { Async, EmptyState } from '@/components/shared/States'
import { Card } from '@/components/ui/card'
import { useData } from '@/data/repository/DataContext'
import { formatCivilDate } from '@/lib/format'

/** Ficha completa de un lugar: la misma información que la lista, con URL propia para compartir. */
export default function PlaceDetailPage() {
  const { id } = useParams()
  const state = useData((r) => r.getPlaces())
  return (
    <Async
      state={state}
      isEmpty={(d) => !d.some((p) => p.id === id)}
      empty={
        <EmptyState icon={MapPin} title="Lugar no encontrado">
          <Link to="/servicios" className="font-semibold text-accent underline">
            Volver a Servicios y lugares útiles
          </Link>
        </EmptyState>
      }
    >
      {(places) => {
        const p = places.find((x) => x.id === id)!
        return (
          <>
            <PageHeader icon={MapPin} title="Ficha del lugar" subtitle="Datos con su fuente y estado de verificación." />
            <PlaceCard place={p} headingLink={false} />
            {PLACE_PHOTOS[p.id] && <div className="mt-4"><PhotoGallery ids={PLACE_PHOTOS[p.id]} columns="sm:grid-cols-2" /></div>}
            {p.location && (
              <Card className="mt-4 space-y-1 text-sm">
                <p className="font-semibold">Ubicación en el mapa</p>
                <p className="text-muted-foreground">
                  Coordenadas {p.location.lat.toFixed(5)}, {p.location.lng.toFixed(5)} ({p.location.accuracy === 'edificio' ? 'sobre el inmueble' : 'centro del predio o espacio'}).
                </p>
                {p.location.note && <p className="text-muted-foreground">{p.location.note}</p>}
                <p>
                  <ExternalLink href={p.location.source.url} className="font-semibold text-accent underline underline-offset-2">
                    Fuente: {p.location.source.label}
                  </ExternalLink>
                  {p.location.source.date && <span className="text-muted-foreground"> · consultada el {formatCivilDate(p.location.source.date)}</span>}
                </p>
              </Card>
            )}
            <p className="mt-4">
              <Link to="/servicios" className="font-semibold text-accent underline underline-offset-2">
                ← Servicios y lugares útiles
              </Link>
            </p>
          </>
        )
      }}
    </Async>
  )
}
