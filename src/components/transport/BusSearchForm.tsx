import { ArrowDownUp, Share2, Star } from 'lucide-react'
import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { Company, Locality } from '@/domain/types'
import { DAY_TYPE_LABEL } from '@/features/transport/dayType'
import { swapDirection, type BusQuery, type SearchMode } from '@/features/transport/query'
import { cn } from '@/lib/utils'

interface Props {
  query: BusQuery
  localities: Locality[]
  companies: Company[]
  /** Tipos de servicio disponibles para la ruta elegida. */
  serviceTypes: string[]
  isFavorite: boolean
  onChange: (q: BusQuery) => void
  onToggleFavorite: () => void
  onShare: () => void
}

const MODES: { value: SearchMode; label: string }[] = [
  { value: 'next', label: 'Próximo' },
  { value: 'arrive-by', label: 'Llegar antes' },
  { value: 'all', label: 'Todos' },
]

const fieldClass =
  'min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground transition focus:border-accent'

export function BusSearchForm({ query, localities, companies, serviceTypes, isFavorite, onChange, onToggleFavorite, onShare }: Props) {
  const id = useId()
  const locality = localities.find((l) => l.id === query.localityId)?.name ?? query.localityId
  const from = query.direction === 'from-rio-seco'

  return (
    <Card className="mb-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="grid flex-1 gap-1.5" aria-live="polite">
          <div className="rounded-xl bg-muted px-3 py-2">
            <span className="block text-xs font-semibold text-muted-foreground">Desde</span>
            <span className="font-display text-lg font-bold">{from ? 'Río Seco' : locality}</span>
          </div>
          <div className="rounded-xl bg-muted px-3 py-2">
            <span className="block text-xs font-semibold text-muted-foreground">Hacia</span>
            <span className="font-display text-lg font-bold">{from ? locality : 'Río Seco'}</span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Invertir origen y destino"
          onClick={() => onChange({ ...query, direction: swapDirection(query.direction) })}
        >
          <ArrowDownUp className="size-5" aria-hidden />
        </Button>
      </div>

      <div>
        <label htmlFor={`${id}-loc`} className="mb-1 block text-sm font-semibold">
          {from ? 'Destino' : 'Origen'}
        </label>
        <select id={`${id}-loc`} className={fieldClass} value={query.localityId} onChange={(e) => onChange({ ...query, localityId: e.target.value })}>
          {localities.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.status === 'sin-datos' ? ' · sin servicio directo' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className={cn('grid gap-3', companies.length > 1 || serviceTypes.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
        <div>
          <label htmlFor={`${id}-day`} className="mb-1 block text-sm font-semibold">
            Día
          </label>
          <select id={`${id}-day`} className={fieldClass} value={query.dayType} onChange={(e) => onChange({ ...query, dayType: e.target.value as BusQuery['dayType'] })}>
            <option value="auto">Hoy</option>
            {Object.entries(DAY_TYPE_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {serviceTypes.length > 1 ? (
          <div>
            <label htmlFor={`${id}-svc`} className="mb-1 block text-sm font-semibold">
              Servicio
            </label>
            <select id={`${id}-svc`} className={fieldClass} value={query.serviceType ?? ''} onChange={(e) => onChange({ ...query, serviceType: (e.target.value || undefined) as BusQuery['serviceType'] })}>
              <option value="">Todos</option>
              {serviceTypes.map((t) => (
                <option key={t} value={t}>
                  {t[0].toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {companies.length > 1 ? (
          <div>
            <label htmlFor={`${id}-co`} className="mb-1 block text-sm font-semibold">
              Empresa
            </label>
            <select id={`${id}-co`} className={fieldClass} value={query.companyId ?? ''} onChange={(e) => onChange({ ...query, companyId: e.target.value || undefined })}>
              <option value="">Todas</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div role="radiogroup" aria-label="Tipo de búsqueda" className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={query.mode === m.value}
            onClick={() => onChange({ ...query, mode: m.value })}
            className={cn(
              'min-h-10 cursor-pointer rounded-full px-2 text-sm font-semibold transition',
              query.mode === m.value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {query.mode === 'arrive-by' && (
        <div>
          <label htmlFor={`${id}-time`} className="mb-1 block text-sm font-semibold">
            Quiero llegar antes de las
          </label>
          <input id={`${id}-time`} type="time" className={fieldClass} value={query.time ?? ''} onChange={(e) => onChange({ ...query, time: e.target.value || undefined })} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={isFavorite ? 'default' : 'outline'} size="sm" onClick={onToggleFavorite} aria-pressed={isFavorite}>
          <Star className={cn('size-4', isFavorite && 'fill-current')} aria-hidden />
          {isFavorite ? 'En favoritos' : 'Guardar ruta'}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onShare}>
          <Share2 className="size-4" aria-hidden />
          Compartir consulta
        </Button>
      </div>
    </Card>
  )
}
