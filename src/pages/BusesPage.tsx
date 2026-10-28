import { Bus, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PageHeader, Section } from '@/components/shared/PageHeader'
import { Async, EmptyState } from '@/components/shared/States'
import { BusSearchForm } from '@/components/transport/BusSearchForm'
import { NoSchedules } from '@/components/transport/NoSchedules'
import { ServiceCard } from '@/components/transport/ServiceCard'
import { Badge } from '@/components/ui/badge'
import { useData } from '@/data/repository/DataContext'
import type { Holiday, TransportData } from '@/domain/types'
import { classifyDay, DAY_TYPE_LABEL } from '@/features/transport/dayType'
import { paramsToQuery, queryToParams, type BusQuery } from '@/features/transport/query'
import { findArriveBy, findNext, listAll, type Occurrence } from '@/features/transport/search'
import { getLocalParts } from '@/features/transport/time'
import { favoriteHref, useFavorites } from '@/services/favorites'
import { shareLink } from '@/services/share'
import { useNow } from '@/services/useNow'

type Loaded = { transport: TransportData; holidays: Holiday[] }

function Results({ query, data }: { query: BusQuery; data: Loaded }) {
  const now = useNow()
  const { transport, holidays } = data
  const locality = transport.localities.find((l) => l.id === query.localityId)
  const nowMinutes = getLocalParts(now).minutes

  const outcome = useMemo(() => {
    const svc = transport.services
    if (query.mode === 'next') {
      const r = findNext(svc, query, now, holidays, 3)
      return { list: r.results, note: r.startsTomorrow ? 'No quedan más servicios hoy. Estos son los primeros de mañana.' : undefined }
    }
    if (query.mode === 'arrive-by') {
      if (!query.time) return { list: [] as Occurrence[], note: 'Elegí la hora a la que querés llegar.' }
      const r = findArriveBy(svc, query, now, holidays)
      return {
        list: r.results,
        note: r.withoutArrival ? `${r.withoutArrival} servicio(s) no tienen hora de llegada cargada y no se incluyen.` : undefined,
      }
    }
    return { list: listAll(svc, query, now, holidays), note: undefined }
  }, [transport.services, query, now, holidays])

  const hasAnyService = transport.services.some((s) => s.localityId === query.localityId && s.direction === query.direction)
  if (!hasAnyService) return <NoSchedules localityName={locality?.name ?? query.localityId} referenceUrl={locality?.referenceUrl} />

  const dayLabel = DAY_TYPE_LABEL[query.dayType === 'auto' ? classifyDay(getLocalParts(now).date, holidays) : query.dayType]

  return (
    <Section title={query.mode === 'all' ? `Todos los horarios · ${dayLabel}` : 'Resultados'}>
      {outcome.note && <p className="mb-3 text-sm text-muted-foreground">{outcome.note}</p>}
      {outcome.list.length === 0 ? (
        <EmptyState icon={Bus} title="No encontramos colectivos para esta búsqueda">
          Probá con otro día, otro horario o quitá el filtro de empresa.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {outcome.list.map((o) => (
            <ServiceCard
              key={`${o.service.id}-${o.serviceDate}`}
              occurrence={o}
              companies={transport.companies}
              stops={transport.stops}
              nowMinutes={query.mode === 'all' ? undefined : nowMinutes}
            />
          ))}
        </div>
      )}
    </Section>
  )
}

export default function BusesPage() {
  const [params, setParams] = useSearchParams()
  const query = useMemo(() => paramsToQuery(params), [params])
  const state = useData((repo) => Promise.all([repo.getTransport(), repo.getHolidays()]).then(([transport, holidays]) => ({ transport, holidays })))
  const { favorites, toggle, isFavorite } = useFavorites()
  const [toast, setToast] = useState('')

  const update = (q: BusQuery) => setParams(queryToParams(q), { replace: true })

  const share = async () => {
    const url = `${location.origin}/colectivos?${queryToParams(query).toString()}`
    const outcome = await shareLink({ title: 'Colectivos en Río Seco Conecta', text: 'Mirá estos horarios de colectivos de Río Seco', url })
    setToast(outcome === 'copied' ? 'Enlace copiado al portapapeles' : outcome === 'failed' ? 'No se pudo compartir' : '')
  }

  return (
    <>
      <PageHeader icon={Bus} title="Colectivos" subtitle="Recorridos desde y hacia Río Seco · hora de Tucumán" />

      {favorites.length > 0 && (
        <Section title="Mis rutas">
          <ul className="flex flex-wrap gap-2">
            {favorites.map((f) => {
              const name = f.id.split(':')[1]
              const label = state.status === 'ready' ? (state.data.transport.localities.find((l) => l.id === name)?.name ?? name) : name
              return (
                <li key={f.id}>
                  <Link to={favoriteHref(f.query)} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-semibold hover:bg-muted">
                    <Star className="size-4 fill-current text-primary" aria-hidden />
                    {f.query.direction === 'from-rio-seco' ? `Río Seco → ${label}` : `${label} → Río Seco`}
                  </Link>
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      <Async state={state} isEmpty={() => false} empty={null}>
        {(data) => {
          const localityServices = data.transport.services.filter((s) => s.localityId === query.localityId)
          const companyIds = [...new Set(localityServices.map((s) => s.companyId))]
          const companies = data.transport.companies.filter((c) => companyIds.includes(c.id))
          const serviceTypes = [...new Set(localityServices.filter((s) => s.direction === query.direction).map((s) => s.serviceType))]
          return (
            <>
              <BusSearchForm
                query={query}
                localities={data.transport.localities}
                companies={companies}
                serviceTypes={serviceTypes}
                isFavorite={isFavorite(query)}
                onChange={update}
                onToggleFavorite={() => toggle(query)}
                onShare={share}
              />
              <p role="status" className="mb-4 min-h-5 text-sm font-semibold text-accent">
                {toast}
              </p>
              <Results query={query} data={data} />
              <p className="text-xs text-muted-foreground">
                <Badge className="mr-1">Importante</Badge>
                Los horarios pueden cambiar sin aviso. Confirmá siempre con la empresa.
              </p>
            </>
          )
        }}
      </Async>
    </>
  )
}
