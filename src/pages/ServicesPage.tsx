import { Landmark } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { PlaceCard, telHref } from '@/components/community/PlaceCard'
import { PageHeader } from '@/components/shared/PageHeader'
import { Async, EmptyState } from '@/components/shared/States'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useData } from '@/data/repository/DataContext'
import { PLACE_CATEGORIES, PLACE_CATEGORY_LABEL, type PlaceCategory } from '@/domain/community'
import { cn } from '@/lib/utils'

const chip = (active: boolean) =>
  cn(
    'inline-flex min-h-10 items-center rounded-full border px-3.5 text-sm font-semibold transition',
    active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted',
  )

export function EmergencyNumbers() {
  const state = useData((r) => r.getEmergencyNumbers())
  return (
    <Async state={state} isEmpty={(d) => d.length === 0} empty={null}>
      {(items) => (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((n) => (
            <li key={n.id}>
              <Card className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-display font-bold">{n.label}</p>
                  {n.note && <p className="text-xs text-muted-foreground">{n.note}</p>}
                </div>
                <Button asChild>
                  <a href={telHref(n.phone)} aria-label={`Llamar al ${n.phone} (${n.label})`}>
                    {n.phone}
                  </a>
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Async>
  )
}

export default function ServicesPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('categoria')
  const category = (PLACE_CATEGORIES as readonly string[]).includes(raw ?? '') ? (raw as PlaceCategory) : null
  const state = useData((r) => r.getPlaces())

  return (
    <>
      <PageHeader icon={Landmark} title="Servicios y lugares útiles" subtitle="Datos documentados, con su fuente. Lo que falta, figura como pendiente." />

      <section aria-label="Emergencias" className="mb-6">
        <h2 className="mb-3 font-display text-lg font-bold">Emergencias</h2>
        <EmergencyNumbers />
      </section>

      <nav aria-label="Categorías" className="mb-4 flex flex-wrap gap-2">
        <button type="button" className={chip(!category)} aria-pressed={!category} onClick={() => setParams({}, { replace: true })}>
          Todos
        </button>
        {PLACE_CATEGORIES.map((c) => (
          <button key={c} type="button" className={chip(category === c)} aria-pressed={category === c} onClick={() => setParams({ categoria: c }, { replace: true })}>
            {PLACE_CATEGORY_LABEL[c]}
          </button>
        ))}
      </nav>

      <Async state={state} isEmpty={() => false} empty={null}>
        {(places) => {
          const list = category ? places.filter((p) => p.category === category) : places
          return list.length === 0 ? (
            <EmptyState icon={Landmark} title={`Todavía no relevamos: ${category ? PLACE_CATEGORY_LABEL[category] : 'lugares'}`}>
              Solo publicamos fichas con datos que podamos documentar. Si conocés un dato confirmado, podés enviárselo a la Comuna o a quienes mantienen esta aplicación.
            </EmptyState>
          ) : (
            <div className="space-y-4">
              {list.map((p) => (
                <PlaceCard key={p.id} place={p} />
              ))}
            </div>
          )
        }}
      </Async>
    </>
  )
}
