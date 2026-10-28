import { ExternalLink } from '@/components/shared/ExternalLink'
import { Badge } from '@/components/ui/badge'
import { Card, CardTitle } from '@/components/ui/card'
import type { AlertItem, EventItem, NewsItem, Obituary } from '@/domain/types'
import { formatCivilDate, formatDateTime, formatShortDate } from '@/lib/format'

function Source({ label, url }: { label: string; url: string }) {
  return (
    <ExternalLink href={url} className="text-sm font-semibold text-accent underline underline-offset-2">
      Fuente: {label}
    </ExternalLink>
  )
}

export function NewsCard({ item }: { item: NewsItem }) {
  return (
    <Card className="animate-rise space-y-2">
      <time className="text-xs font-semibold text-muted-foreground" dateTime={item.publishedAt}>
        {formatShortDate(item.publishedAt)}
      </time>
      <CardTitle className="text-lg">{item.title}</CardTitle>
      {item.summary && <p className="text-sm text-muted-foreground">{item.summary}</p>}
      <Source {...item.source} />
    </Card>
  )
}

const SEVERITY = { info: 'info', aviso: 'warning', urgente: 'danger' } as const

export function AlertCard({ item }: { item: AlertItem }) {
  return (
    <Card className="animate-rise space-y-2" role="article">
      <div className="flex items-center gap-2">
        <Badge tone={SEVERITY[item.severity]}>{item.severity}</Badge>
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
