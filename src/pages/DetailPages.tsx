import { Bell, Flower2, Newspaper } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { AlertCard, NewsCard, ObituaryCard } from '@/components/content/ContentCards'
import { PageHeader } from '@/components/shared/PageHeader'
import { Async, EmptyState } from '@/components/shared/States'
import { Button } from '@/components/ui/button'
import { useData } from '@/data/repository/DataContext'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

function Unavailable({ icon, title, to, label }: { icon: LucideIcon; title: string; to: string; label: string }) {
  return (
    <EmptyState icon={icon} title={title}>
      <p>Puede que haya sido retirado o que el enlace sea incorrecto.</p>
      <p className="mt-3">
        <Button asChild variant="outline"><Link to={to}>{label}</Link></Button>
      </p>
    </EmptyState>
  )
}

function Detail<T>({ state, icon, header, missing, children }: { state: ReturnType<typeof useData<T | null>>; icon: LucideIcon; header: string; missing: ReactNode; children: (item: T) => ReactNode }) {
  return (
    <>
      <PageHeader icon={icon} title={header} />
      <Async state={state} isEmpty={(d) => d === null} empty={missing}>
        {(item) => (item === null ? null : children(item))}
      </Async>
    </>
  )
}

/** Destino de una notificación de noticia: abre EXACTAMENTE la publicación que originó el aviso. */
export function NewsDetailPage() {
  const { id = '' } = useParams()
  const state = useData((r) => r.getNewsItem(id), { key: id })
  return (
    <Detail state={state} icon={Newspaper} header="Noticia" missing={<Unavailable icon={Newspaper} title="Esta noticia ya no está disponible" to="/noticias" label="Ver todas las noticias" />}>
      {(item) => (
        <>
          <NewsCard item={item} expanded />
          <p className="mt-4"><Button asChild variant="outline"><Link to="/noticias">Ver todas las noticias</Link></Button></p>
        </>
      )}
    </Detail>
  )
}

export function AlertDetailPage() {
  const { id = '' } = useParams()
  const state = useData((r) => r.getAlertItem(id), { key: id })
  return (
    <Detail state={state} icon={Bell} header="Alerta" missing={<Unavailable icon={Bell} title="Esta alerta ya no está disponible" to="/alertas" label="Ver las alertas" />}>
      {(item) => (
        <>
          <AlertCard item={item} />
          {item.expiresAt && new Date(item.expiresAt) <= new Date() && <p className="mt-3 text-sm text-muted-foreground">Esta alerta ya venció.</p>}
          <p className="mt-4"><Button asChild variant="outline"><Link to="/alertas">Ver las alertas vigentes</Link></Button></p>
        </>
      )}
    </Detail>
  )
}

export function ObituaryDetailPage() {
  const { id = '' } = useParams()
  const state = useData((r) => r.getObituaryItem(id), { key: id })
  return (
    <Detail state={state} icon={Flower2} header="Comunicado" missing={<Unavailable icon={Flower2} title="Este comunicado ya no está disponible" to="/obituarios" label="Ver los comunicados" />}>
      {(item) => (
        <>
          <ObituaryCard item={item} />
          <p className="mt-4"><Button asChild variant="outline"><Link to="/obituarios">Ver todos los comunicados</Link></Button></p>
        </>
      )}
    </Detail>
  )
}
