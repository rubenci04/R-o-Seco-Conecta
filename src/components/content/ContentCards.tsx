import { ExternalLink } from '@/components/shared/ExternalLink'
import { Badge } from '@/components/ui/badge'
import { Card, CardTitle } from '@/components/ui/card'
import type { AlertItem, EventItem, NewsItem, Obituary } from '@/domain/types'
import { CATEGORY_LABEL, type CategoryId } from '@shared/categories'
import { formatCivilDate, formatDateTime, formatShortDate } from '@/lib/format'

function Source({ label, url }: { label: string; url?: string }) {
  if (!url) return <p className="text-sm font-semibold text-muted-foreground">Fuente: {label}</p>
  return (
    <ExternalLink href={url} className="text-sm font-semibold text-accent underline underline-offset-2">
      Fuente: {label}
    </ExternalLink>
  )
}

export function NewsCard({ item, expanded = false }: { item: NewsItem; expanded?: boolean }) {
  const full = item.body && item.body.trim() !== (item.summary ?? '').trim() ? item.body : null
  return (
    <Card className="animate-rise space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <time className="text-xs font-semibold text-muted-foreground" dateTime={item.publishedAt}>
          {formatShortDate(item.publishedAt)}
        </time>
        {item.verified ? <Badge tone="info">Revisada por la redacción</Badge> : <Badge>Sin revisión editorial</Badge>}
        {item.categories?.map((c) => (
          <Badge key={c} tone="neutral">
            {CATEGORY_LABEL[c as CategoryId] ?? c}
          </Badge>
        ))}
      </div>
      <CardTitle className="text-lg">{item.title}</CardTitle>
      {full ? (
        <details className="text-sm" open={expanded || undefined}>
          <summary className="cursor-pointer text-muted-foreground">{item.summary}</summary>
          <p className="mt-2 whitespace-pre-line">{full}</p>
        </details>
      ) : (
        item.summary && <p className="whitespace-pre-line text-sm text-muted-foreground">{item.summary}</p>
      )}
      {item.rectification && (
        <p className="rounded-xl bg-warning-soft p-2.5 text-sm text-warning">
          <strong>Rectificación:</strong> {item.rectification}
        </p>
      )}
      <Source {...item.source} />
    </Card>
  )
}

/** Urgente · Interrupción de un servicio (agua, energía, calles, recolección…) · Aviso informativo. */
export function alertClass(item: AlertItem): { label: string; tone: 'danger' | 'warning' | 'info' } {
  if (item.severity === 'urgente') return { label: 'Urgente', tone: 'danger' }
  if (item.kind && ['agua', 'energia', 'calles'].includes(item.kind)) return { label: 'Interrupción de servicio', tone: 'warning' }
  if (item.categories?.includes('residuos') || (item.kind === 'comunicado' && item.categories?.includes('residuos'))) return { label: 'Interrupción de servicio', tone: 'warning' }
  return { label: 'Aviso informativo', tone: 'info' }
}

export function AlertCard({ item }: { item: AlertItem }) {
  const c = alertClass(item)
  return (
    <Card className="animate-rise space-y-2" role="article">
      <div className="flex items-center gap-2">
        <Badge tone={c.tone}>{c.label}</Badge>
        <time className="text-xs text-muted-foreground" dateTime={item.publishedAt}>
          {formatDateTime(item.publishedAt)}
        </time>
      </div>
      <CardTitle>{item.title}</CardTitle>
      <p className="text-sm">{item.body}</p>
      <Source {...item.source} />
    </Card>
  )
}

export function EventCard({ item }: { item: EventItem }) {
  return (
    <Card className="animate-rise space-y-2">
      <div className="flex items-center gap-2">
        <Badge tone="info">{item.category}</Badge>
        <time className="text-xs font-semibold text-muted-foreground" dateTime={item.startsAt}>
          {formatDateTime(item.startsAt)}
        </time>
      </div>
      <CardTitle>{item.title}</CardTitle>
      {item.place && <p className="text-sm text-muted-foreground">{item.place}</p>}
      {item.description && <p className="text-sm">{item.description}</p>}
      <Source {...item.source} />
    </Card>
  )
}

export function ObituaryCard({ item }: { item: Obituary }) {
  return (
    <Card className="animate-rise space-y-2">
      <CardTitle className="text-lg">{item.name}</CardTitle>
      <p className="text-xs text-muted-foreground">{formatCivilDate(item.date)}</p>
      {item.message && <p className="text-sm">{item.message}</p>}
      {item.service && <p className="text-sm text-muted-foreground">{item.service}</p>}
      <Source {...item.source} />
    </Card>
  )
}
