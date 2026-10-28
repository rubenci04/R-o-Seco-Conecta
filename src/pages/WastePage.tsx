import { Newspaper, Recycle, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { AlertCard, NewsCard } from '@/components/content/ContentCards'
import { ExternalLink } from '@/components/shared/ExternalLink'
import { PageHeader, Section } from '@/components/shared/PageHeader'
import { Async, EmptyState } from '@/components/shared/States'
import { Card, CardTitle } from '@/components/ui/card'
import { LINKS } from '@/config/links'
import { useData } from '@/data/repository/DataContext'
import { formatCivilDate } from '@/lib/format'

/** Recolección de residuos y limpieza urbana. Muestra solo datos confirmados: nunca inventa frecuencias ni recorridos. */
export default function WastePage() {
  const waste = useData((r) => r.getWaste())
  const alerts = useData((r) => r.getAlerts(), { revalidateMs: 60_000 })
  const news = useData((r) => r.getNews({ category: 'residuos', limit: 10 }), { revalidateMs: 60_000 })

  return (
    <>
      <PageHeader icon={Trash2} title="Recolección de residuos y limpieza urbana" subtitle="Avisos, suspensiones y campañas confirmadas por la Comuna." />

      <Section title="Avisos vigentes del servicio">
        <Async state={alerts} isEmpty={(d) => !d.some((a) => a.categories?.includes('residuos'))} empty={<EmptyState icon={Recycle} title="No hay avisos vigentes sobre la recolección">Si se suspende o cambia el servicio, el aviso aparece acá y en Alertas.</EmptyState>}>
          {(items) => <div className="space-y-3">{items.filter((a) => a.categories?.includes('residuos')).map((a) => <AlertCard key={a.id} item={a} />)}</div>}
        </Async>
      </Section>

      <Section title="Días, horarios y recorridos confirmados">
        <Async
          state={waste}
          isEmpty={(d) => d.schedule.length === 0}
          empty={
            <Card className="space-y-2 text-sm">
              <CardTitle>Todavía no hay días ni horarios confirmados</CardTitle>
              <p>
                No publicamos frecuencias ni recorridos que no estén confirmados por la Comuna. Cuando se confirmen, van a figurar acá con su fuente y fecha de verificación.
                Mientras tanto, consultá las novedades en{' '}
                <ExternalLink href={LINKS.comuna.facebook} className="font-semibold text-accent underline underline-offset-2">la página de la Comuna</ExternalLink>.
              </p>
            </Card>
          }
        >
          {(d) => (
            <ul className="space-y-3">
              {d.schedule.map((s) => (
                <li key={s.id}>
                  <Card className="space-y-1 text-sm">
                    <CardTitle>{s.zone}</CardTitle>
                    <p>{s.days.join(', ')}{s.time ? ` · ${s.time}` : ''}</p>
                    {s.route && <p className="text-muted-foreground">Recorrido: {s.route}</p>}
                    {s.note && <p className="text-muted-foreground">{s.note}</p>}
                    <p className="text-xs text-muted-foreground">Fuente: <ExternalLink href={s.source.url} className="underline">{s.source.label}</ExternalLink> · verificado el {formatCivilDate(s.lastVerified)}</p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Section>

      <Section title="Campañas de limpieza">
        <Async state={waste} isEmpty={(d) => d.campaigns.length === 0} empty={<p className="text-sm text-muted-foreground">No hay campañas cargadas.</p>}>
          {(d) => (
            <ul className="space-y-3">
              {d.campaigns.map((c) => (
                <li key={c.id}>
                  <Card className="space-y-1 text-sm">
                    <CardTitle>{c.title}</CardTitle>
                    <p className="text-xs text-muted-foreground">{formatCivilDate(c.date)}</p>
                    {c.description && <p>{c.description}</p>}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Section>

      <Section title="Novedades sobre residuos y limpieza" action={<Link to="/noticias?categoria=residuos" className="text-sm font-semibold text-accent underline">Ver en Noticias</Link>}>
        <Async state={news} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Newspaper} title="Todavía no hay novedades publicadas">Las noticias clasificadas como residuos aparecen acá.</EmptyState>}>
          {(items) => <div className="space-y-3">{items.map((i) => <NewsCard key={i.id} item={i} />)}</div>}
        </Async>
      </Section>
    </>
  )
}
