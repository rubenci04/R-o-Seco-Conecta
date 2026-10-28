import { CircleHelp, MapPin, Navigation, Phone, Share2 } from 'lucide-react'
import { useState } from 'react'
import { ExternalLink } from '@/components/shared/ExternalLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { Link } from 'react-router'
import { PLACE_CATEGORY_LABEL, type Place } from '@/domain/community'
import { directionsUrl, mapHref, osmViewUrl } from '@/features/map/layers'
import { formatCivilDate } from '@/lib/format'
import { shareLink } from '@/services/share'

const PENDING_LABEL: Record<Place['pending'][number], string> = {
  address: 'Dirección',
  phone: 'Teléfono',
  hours: 'Horarios',
  description: 'Descripción',
  location: 'Ubicación',
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

export function PlaceCard({ place: p, headingLink = true }: { place: Place; headingLink?: boolean }) {
  const directions = directionsUrl(p)
  const [msg, setMsg] = useState('')
  const share = async () => {
    const text = [p.name, p.address, p.phone && `Tel. ${p.phone}`].filter(Boolean).join(' · ')
    const out = await shareLink({ title: p.name, text, url: `${location.origin}/servicios/${p.id}` })
    setMsg(out === 'copied' ? 'Enlace copiado' : out === 'failed' ? 'No se pudo compartir' : '')
  }

  return (
    <Card id={p.id} className="animate-rise scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">{PLACE_CATEGORY_LABEL[p.category]}</Badge>
        {p.verifiedAt && <span className="text-xs text-muted-foreground">Verificado el {formatCivilDate(p.verifiedAt)}</span>}
      </div>
      <CardTitle className="text-lg">{headingLink ? <Link to={`/servicios/${p.id}`} className="underline-offset-2 hover:underline">{p.name}</Link> : p.name}</CardTitle>
      {p.description && <p className="text-sm">{p.description}</p>}

      <dl className="space-y-1.5 text-sm">
        {p.address && (
          <div className="flex gap-2">
            <dt className="sr-only">Dirección</dt>
            <MapPin className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <dd>{p.address}</dd>
          </div>
        )}
        {p.phone && (
          <div className="flex gap-2">
            <dt className="sr-only">Teléfono</dt>
            <Phone className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <dd className="font-semibold tabular-nums">{p.phone}</dd>
          </div>
        )}
        {p.hours && (
          <div>
            <dt className="inline font-semibold">Horarios: </dt>
            <dd className="inline">{p.hours}</dd>
          </div>
        )}
      </dl>

      {p.pending.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <CircleHelp className="size-4 text-warning" aria-hidden />
          {p.pending.map((f) => (
            <Badge key={f} tone="warning">
              {PENDING_LABEL[f]}: pendiente de confirmación
            </Badge>
          ))}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {p.phone && (
          <Button asChild size="sm">
            <a href={telHref(p.phone)} aria-label={`Llamar a ${p.name}`}>
              <Phone className="size-4" aria-hidden />
              Llamar
            </a>
          </Button>
        )}
        {p.location ? (
          <Button asChild size="sm" variant="outline">
            <Link to={mapHref(p.id)} aria-label={`Ver ${p.name} en el mapa de Río Seco`}>
              <MapPin className="size-4" aria-hidden />
              Ver en el mapa
            </Link>
          </Button>
        ) : (
          <Badge tone="warning">Ubicación pendiente</Badge>
        )}
        {directions && (
          <Button asChild size="sm" variant="outline">
            <a href={directions} target="_blank" rel="noopener noreferrer" aria-label={`Cómo llegar a ${p.name} (abre una aplicación de mapas externa)`}>
              <Navigation className="size-4" aria-hidden />
              Cómo llegar
            </a>
          </Button>
        )}
        {p.location && (
          <Button asChild size="sm" variant="outline">
            <a href={osmViewUrl(p.location)} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${p.name} en OpenStreetMap (sitio externo)`}>
              Abrir en OpenStreetMap
            </a>
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={share}>
          <Share2 className="size-4" aria-hidden />
          Compartir
        </Button>
      </div>
      <p role="status" className="min-h-4 text-xs font-semibold text-accent">
        {msg}
      </p>

      {p.dataNote && <p className="rounded-xl bg-muted p-2.5 text-xs text-muted-foreground">{p.dataNote}</p>}
      {p.links.length > 0 && (
        <ul className="space-y-1 text-sm">
          {p.links.map((l) => (
            <li key={l.url}>
              <ExternalLink href={l.url} className="font-semibold text-accent underline underline-offset-2">
                {l.label}
              </ExternalLink>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
