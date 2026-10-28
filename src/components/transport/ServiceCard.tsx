import { ArrowRight, BadgeCheck, CalendarClock, Clock, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import type { Company, Stop } from '@/domain/types'
import { formatCivilDate } from '@/lib/format'
import type { Occurrence } from '@/features/transport/search'
import { formatClock, formatDuration, MINUTES_PER_DAY, parseTime } from '@/features/transport/time'

interface Props {
  occurrence: Occurrence
  companies: Company[]
  stops: Stop[]
  /** Minutos actuales (para mostrar "sale en X min"). */
  nowMinutes?: number
}

export function ServiceCard({ occurrence: o, companies, stops, nowMinutes }: Props) {
  const s = o.service
  const company = companies.find((c) => c.id === s.companyId)?.name ?? s.companyId
  const stopName = (id: string) => stops.find((x) => x.id === id)?.name ?? id
  const nextDay = o.departureAbs >= MINUTES_PER_DAY
  const untilDeparture = nowMinutes === undefined ? undefined : o.departureAbs - nowMinutes
  const approximate = s.precision === 'approximate'

  return (
    <Card className="animate-rise flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-3xl font-extrabold tabular-nums leading-none">
            {approximate && <span aria-hidden>~</span>}
            {formatClock(o.departureAbs)}
            {nextDay && <span className="ml-1.5 align-middle text-xs font-semibold text-muted-foreground">madrugada (día de servicio anterior)</span>}
          </p>
          {untilDeparture !== undefined && untilDeparture >= 0 && (
            <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-accent">
              <Clock className="size-4" aria-hidden />
              {untilDeparture === 0 ? 'Sale ahora' : untilDeparture < 120 ? `Sale en ${untilDeparture} min` : 'Más tarde'}
            </p>
          )}
        </div>
        <Badge tone={approximate ? 'warning' : 'info'}>
          {approximate ? <CalendarClock className="size-3.5" aria-hidden /> : <BadgeCheck className="size-3.5" aria-hidden />}
          {approximate ? 'Aproximado' : 'Confirmado'}
        </Badge>
      </div>

      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="font-semibold">{stopName(s.originStopId)}</span>
        <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
        <span className="font-semibold">{stopName(s.destinationStopId)}</span>
        {o.arrivalAbs !== undefined && (
          <span className="text-muted-foreground">
            · llega {s.arrivalApproximate ? '~' : ''}
            {formatClock(o.arrivalAbs)}
            {o.arrivalAbs >= MINUTES_PER_DAY && o.departureAbs < MINUTES_PER_DAY ? ' (día siguiente)' : ''}
            {s.durationMinutes ? ` · ${formatDuration(s.durationMinutes)}` : ''}
          </span>
        )}
      </p>

      {approximate && s.observations && (
        <p className="flex gap-2 rounded-xl bg-warning-soft p-2.5 text-xs text-warning">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {s.observations}
        </p>
      )}

      {s.stopTimes && s.stopTimes.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-accent">Paradas intermedias ({s.stopTimes.length})</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {s.stopTimes.map((t) => (
              <li key={t.name} className="flex justify-between gap-3">
                <span>{t.name}</span>
                <span className="tabular-nums">{t.time ? `${t.approximate ? '~' : ''}${formatClock(parseTime(t.time))}` : 'sin hora informada'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge>{company}</Badge>
        <Badge>{s.serviceType}</Badge>
        <span>
          Fuente:{' '}
          <a className="underline underline-offset-2" href={s.source.url} target="_blank" rel="noopener noreferrer">
            {s.source.label}
          </a>{' '}
          · verificado el {formatCivilDate(s.lastVerified)}
        </span>
      </div>
    </Card>
  )
}
