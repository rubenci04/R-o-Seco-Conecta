import { Bell, CalendarDays, Flower2, Newspaper } from 'lucide-react'
import { AlertCard, EventCard, NewsCard, ObituaryCard } from '@/components/content/ContentCards'
import { ExternalLink } from '@/components/shared/ExternalLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { Async, EmptyState } from '@/components/shared/States'
import { LINKS } from '@/config/links'
import { useData } from '@/data/repository/DataContext'

const list = 'space-y-3'

export function NewsPage() {
  const state = useData((r) => r.getNews())
  return (
    <>
      <PageHeader icon={Newspaper} title="Noticias" subtitle="Cada nota indica su fuente y fecha de publicación." />
      <Async
        state={state}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState icon={Newspaper} title="Todavía no hay noticias publicadas">
            <p>Solo mostraremos novedades con fuente verificable. Mientras tanto, seguí a la Comuna en sus redes oficiales:</p>
            <p className="mt-2 flex flex-wrap justify-center gap-x-4">
              <ExternalLink href={LINKS.comuna.facebook} className="font-semibold text-accent underline underline-offset-2">Facebook</ExternalLink>
              <ExternalLink href={LINKS.comuna.instagram} className="font-semibold text-accent underline underline-offset-2">Instagram</ExternalLink>
            </p>
          </EmptyState>
        }
      >
        {(items) => (
          <div className={list}>
            {[...items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map((i) => <NewsCard key={i.id} item={i} />)}
          </div>
        )}
      </Async>
    </>
  )
}

export function AlertsPage() {
  const state = useData((r) => r.getAlerts())
  return (
    <>
      <PageHeader icon={Bell} title="Alertas" subtitle="Avisos importantes para vecinos de Río Seco." />
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
  const state = useData((r) => r.getEvents())
  return (
    <>
      <PageHeader icon={CalendarDays} title="Agenda" subtitle="Eventos, festividades y actividades de la comunidad." />
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
  const state = useData((r) => r.getObituaries())
  return (
    <>
      <PageHeader icon={Flower2} title="Obituarios" subtitle="Un espacio de respeto para despedir a nuestros vecinos." />
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
