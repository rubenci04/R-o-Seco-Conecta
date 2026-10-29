import { Award, BadgeCheck, CircleHelp, Church, Factory, Flag, ImageOff, Landmark, Music, Star, Trees, Trophy, Users, type LucideIcon } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { PhotoGallery } from '@/components/community/PhotoGallery'
import { SECTION_PHOTOS } from '@/config/photos'
import { ExternalLink } from '@/components/shared/ExternalLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { Async, EmptyState } from '@/components/shared/States'
import { Badge } from '@/components/ui/badge'
import { Card, CardTitle } from '@/components/ui/card'
import { useData } from '@/data/repository/DataContext'
import type { EvidenceKind, HeritageSection } from '@/domain/community'
import { formatCivilDate } from '@/lib/format'

export const HERITAGE_ICONS: Record<HeritageSection['icon'], LucideIcon> = {
  landmark: Landmark,
  factory: Factory,
  trophy: Trophy,
  church: Church,
  trees: Trees,
  flag: Flag,
  star: Star,
  award: Award,
  music: Music,
}

const EVIDENCE: Record<EvidenceKind, { label: string; tone: 'info' | 'neutral' | 'warning'; Icon: LucideIcon }> = {
  documentado: { label: 'Documentado', tone: 'info', Icon: BadgeCheck },
  equipo: { label: 'Aporte del equipo · a confirmar', tone: 'neutral', Icon: Users },
  pendiente: { label: 'Pendiente de documentación', tone: 'warning', Icon: CircleHelp },
}

export default function HeritagePage() {
  const state = useData((r) => r.getHeritage())
  return (
    <>
      <PageHeader icon={Landmark} title="Nuestro pueblo" subtitle="Historia, cultura y tradiciones de Río Seco." />
      <Card className="mb-5 text-sm">
        Esta sección se construye con la comunidad. Cada dato indica si está <strong>documentado</strong>, si es un <strong>aporte del equipo a confirmar</strong> o
        si está <strong>pendiente</strong>. No inventamos años, nombres ni ediciones.
      </Card>
      <Async state={state} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Landmark} title="Sin contenido cargado" />}>
        {(sections) => (
          <ul className="grid gap-3 sm:grid-cols-2">
            {[...sections].sort((a, b) => Number(b.featured) - Number(a.featured)).map((s) => {
              const Icon = HERITAGE_ICONS[s.icon]
              return (
                <li key={s.id} className={s.featured ? 'sm:col-span-2' : ''}>
                  <Link
                    to={`/pueblo/${s.id}`}
                    className={`flex h-full items-start gap-3 rounded-[var(--radius-card)] border p-4 shadow-sm transition hover:-translate-y-0.5 active:scale-[0.99] ${s.featured ? 'border-orange bg-orange-soft' : 'border-border bg-card hover:bg-muted'}`}
                  >
                    <span className={`grid size-12 shrink-0 place-items-center rounded-xl ${s.featured ? 'bg-orange text-orange-foreground' : 'bg-accent-soft text-accent'}`}>
                      <Icon className="size-6" aria-hidden />
                    </span>
                    <span>
                      {s.featured && <Badge tone="warning" className="mb-1">Destacado</Badge>}
                      <span className="block font-display text-base font-bold">{s.title}</span>
                      <span className="block text-sm text-muted-foreground">{s.summary}</span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Async>
    </>
  )
}

export function HeritageDetailPage() {
  const { id } = useParams()
  const state = useData((r) => r.getHeritage())
  return (
    <Async state={state} isEmpty={(d) => !d.some((s) => s.id === id)} empty={<EmptyState icon={Landmark} title="Sección no encontrada"><Link className="font-semibold text-accent underline" to="/pueblo">Volver a Nuestro pueblo</Link></EmptyState>}>
      {(sections) => {
        const s = sections.find((x) => x.id === id)!
        return (
          <>
            <PageHeader icon={HERITAGE_ICONS[s.icon]} title={s.title} subtitle={s.summary} />
            <div className="space-y-3">
              {s.claims.map((c, i) => {
                const e = EVIDENCE[c.kind]
                return (
                  <Card key={i} className="animate-rise space-y-2">
                    <Badge tone={e.tone}>
                      <e.Icon className="size-3.5" aria-hidden />
                      {e.label}
                    </Badge>
                    <p>{c.text}</p>
                    {c.source && (
                      <p className="text-sm">
                        <ExternalLink href={c.source.url ?? '#'} className="font-semibold text-accent underline underline-offset-2">
                          Fuente: {c.source.label}
                        </ExternalLink>
                        {c.source.date && <span className="text-muted-foreground"> · {formatCivilDate(c.source.date)}</span>}
                      </p>
                    )}
                  </Card>
                )
              })}

              <Card className="space-y-2 border-dashed">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ImageOff className="size-5 text-muted-foreground" aria-hidden />
                  Fotografías y reseñas
                </CardTitle>
                {s.media.length === 0 && SECTION_PHOTOS[s.id] ? (
                  <>
                    <PhotoGallery ids={SECTION_PHOTOS[s.id]} columns={SECTION_PHOTOS[s.id].length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} />
                    {s.id === 'desfiles-17-agosto' && <p className="text-xs text-muted-foreground">No se indica la fecha ni la edición de estas imágenes: no las asociamos a un acto determinado.</p>}
                  </>
                ) : s.media.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Todavía no hay fotografías oficiales ni reseñas cedidas para esta sección. Se incorporarán con autorización de la Comuna y de sus autores,
                    indicando crédito y licencia.
                  </p>
                ) : (
                  <ul className="grid grid-cols-2 gap-3">
                    {s.media.map((m) => (
                      <li key={m.src}>
                        <img src={m.src} alt={m.alt} loading="lazy" className="rounded-xl" />
                        <p className="mt-1 text-xs text-muted-foreground">{m.credit} · {m.license}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {s.pendingDetails.length > 0 && (
                <Card className="space-y-2">
                  <CardTitle className="text-base">Para completar con documentación</CardTitle>
                  <ul className="list-inside list-disc text-sm text-muted-foreground">
                    {s.pendingDetails.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </Card>
              )}
              <Link to="/pueblo" className="inline-block font-semibold text-accent underline underline-offset-2">
                ← Nuestro pueblo
              </Link>
            </div>
          </>
        )
      }}
    </Async>
  )
}
