import { CATEGORY_IDS, CATEGORY_LABEL, isCategoryId } from '@shared/categories'
import { Bell, CalendarDays, Flower2, Newspaper } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AlertCard, EventCard, NewsCard, ObituaryCard } from '@/components/content/ContentCards'
import { FacebookTimeline } from '@/components/community/FacebookTimeline'
import { ExternalLink } from '@/components/shared/ExternalLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { Async, EmptyState } from '@/components/shared/States'
import { Button } from '@/components/ui/button'
import { LINKS } from '@/config/links'
import { useData, useRepository, type AsyncState } from '@/data/repository/DataContext'
import type { NewsItem } from '@/domain/types'
import { cn } from '@/lib/utils'

const list = 'space-y-3'
const REVALIDATE_MS = 60_000
export const NEWS_PAGE_SIZE = 15

const chip = (active: boolean) =>
  cn(
    'inline-flex min-h-10 items-center rounded-full border px-3.5 text-sm font-semibold transition',
    active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted',
  )

/** «Actualizado a las 14:32», con la hora de Tucumán. */
function UpdatedAt({ state }: { state: AsyncState<unknown> }) {
  if (state.status !== 'ready') return null
  const time = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Tucuman', hour: '2-digit', minute: '2-digit' }).format(state.updatedAt)
  return (
    <p className="mb-3 text-xs text-muted-foreground" aria-live="polite">
      Actualizado a las {time}
      {state.refreshing ? ' · actualizando…' : ''}
    </p>
  )
}

export function NewsPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('categoria')
  const category = raw && isCategoryId(raw) ? raw : undefined
  const repo = useRepository()
  const state = useData((r) => r.getNews({ category, limit: NEWS_PAGE_SIZE }), { key: category ?? 'todas', revalidateMs: REVALIDATE_MS })

  // Páginas adicionales (cursor de fecha). El estado lleva la categoría a la que pertenece: al cambiar de filtro deja de aplicar.
  const catKey = category ?? 'todas'
  const [extra, setExtra] = useState<{ cat: string; items: NewsItem[]; exhausted: boolean }>({ cat: catKey, items: [], exhausted: false })
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const more = useMemo(() => (extra.cat === catKey ? extra.items : []), [extra, catKey])
  const exhausted = extra.cat === catKey && extra.exhausted

  const items = useMemo(() => {
    if (state.status !== 'ready') return []
    const seen = new Set<string>()
    return [...state.data, ...more].filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true))).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  }, [state, more])
  const firstPageFull = state.status === 'ready' && state.data.length >= NEWS_PAGE_SIZE
  const lastBatchFull = more.length === 0 || more.length % NEWS_PAGE_SIZE === 0
  const canLoadMore = firstPageFull && lastBatchFull && !exhausted

  const loadMore = async () => {
    setLoadingMore(true)
    setMoreError(null)
    try {
      const page = await repo.getNews({ category, before: items[items.length - 1]?.publishedAt, limit: NEWS_PAGE_SIZE })
      setExtra((e) => ({ cat: catKey, items: [...(e.cat === catKey ? e.items : []), ...page], exhausted: page.length < NEWS_PAGE_SIZE }))
    } catch (e) {
      setMoreError(e instanceof Error ? e.message : 'No se pudieron cargar más noticias.')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <>
      <PageHeader icon={Newspaper} title="Noticias" subtitle="Cada nota indica su fuente, su fecha y si fue revisada por la redacción." />
      <nav aria-label="Categorías de noticias" className="mb-4">
        <ul className="flex flex-wrap gap-2">
          <li>
            <button type="button" className={chip(!category)} aria-pressed={!category} onClick={() => setParams({}, { replace: true })}>
              Todas
            </button>
          </li>
          {CATEGORY_IDS.map((c) => (
            <li key={c}>
              <button type="button" className={chip(category === c)} aria-pressed={category === c} onClick={() => setParams({ categoria: c }, { replace: true })}>
                {CATEGORY_LABEL[c]}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <UpdatedAt state={state} />
      {!category && (
        <div className="mb-5">
          <FacebookTimeline id="facebook-noticias" />
        </div>
      )}
      <Async
        state={state}
        isEmpty={(d) => d.length === 0}
        empty={
          category ? (
            <EmptyState icon={Newspaper} title="No hay noticias en esta categoría">
              Probá con otra categoría o mirá todas las noticias.
            </EmptyState>
          ) : (
            <EmptyState icon={Newspaper} title="Todavía no hay noticias publicadas">
              <p>Solo mostramos novedades con fuente verificable. Mientras tanto, seguí a la Comuna en sus redes oficiales:</p>
              <p className="mt-2 flex flex-wrap justify-center gap-x-4">
                <ExternalLink href={LINKS.comuna.facebook} className="font-semibold text-accent underline underline-offset-2">Facebook</ExternalLink>
                <ExternalLink href={LINKS.comuna.instagram} className="font-semibold text-accent underline underline-offset-2">Instagram</ExternalLink>
              </p>
            </EmptyState>
          )
        }
      >
        {() => (
          <>
            <div className={list}>
              {items.map((i) => (
                <NewsCard key={i.id} item={i} />
              ))}
            </div>
            {moreError && (
              <p role="alert" className="mt-3 text-sm font-semibold text-danger">
                {moreError}
              </p>
            )}
            {canLoadMore && (
              <div className="mt-4 text-center">
                <Button type="button" variant="outline" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Cargando…' : 'Cargar más noticias'}
                </Button>
              </div>
            )}
          </>
        )}
      </Async>
    </>
  )
}

export function AlertsPage() {
  const state = useData((r) => r.getAlerts(), { revalidateMs: REVALIDATE_MS })
  return (
    <>
      <PageHeader icon={Bell} title="Alertas" subtitle="Avisos importantes para vecinos de Río Seco, confirmados por la redacción." />
      <UpdatedAt state={state} />
      <Async
        state={state}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={Bell} title="No hay alertas vigentes">Cuando haya un aviso importante confirmado, lo vas a ver acá.</EmptyState>}
      >
        {(items) => <div className={list}>{items.map((i) => <AlertCard key={i.id} item={i} />)}</div>}
      </Async>
    </>
  )
}

export function AgendaPage() {
  const state = useData((r) => r.getEvents(), { revalidateMs: REVALIDATE_MS })
  return (
    <>
      <PageHeader icon={CalendarDays} title="Agenda" subtitle="Eventos, festividades y actividades de la comunidad." />
      <UpdatedAt state={state} />
      <Async
        state={state}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={CalendarDays} title="No hay eventos cargados">Todavía no tenemos actividades confirmadas. Volvé pronto.</EmptyState>}
      >
        {(items) => (
          <div className={list}>
            {[...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((i) => <EventCard key={i.id} item={i} />)}
          </div>
        )}
      </Async>
    </>
  )
}

export function ObituariesPage() {
  const state = useData((r) => r.getObituaries(), { revalidateMs: REVALIDATE_MS })
  return (
    <>
      <PageHeader icon={Flower2} title="Obituarios" subtitle="Un espacio de respeto para despedir a nuestros vecinos." />
      <UpdatedAt state={state} />
      <Async
        state={state}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState icon={Flower2} title="No hay comunicados">
            Publicaremos únicamente comunicados verificados y con consentimiento de la familia.
          </EmptyState>
        }
      >
        {(items) => <div className={list}>{items.map((i) => <ObituaryCard key={i.id} item={i} />)}</div>}
      </Async>
    </>
  )
}
