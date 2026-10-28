import { Radio as RadioIcon, Headphones } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Async, EmptyState } from '@/components/shared/States'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useData } from '@/data/repository/DataContext'
import type { Radio } from '@/domain/types'

const GRADIENTS = ['from-[#1769a8] to-[#0e1b2a]', 'from-[#b73b08] to-[#6b2203]']

function RadioCard({ radio, index }: { radio: Radio; index: number }) {
  return (
    <Card className="animate-rise overflow-hidden p-0">
      <div className={`flex items-end justify-between bg-gradient-to-br ${GRADIENTS[index % 2]} p-5 text-white`}>
        <div>
          <p className="text-sm font-semibold opacity-90">{radio.name}</p>
          <p className="font-display text-4xl font-extrabold tabular-nums">{radio.frequency}</p>
        </div>
        <RadioIcon className="size-12 opacity-80" aria-hidden />
      </div>
      <div className="flex items-center justify-between gap-3 p-4">
        <p className="text-sm text-muted-foreground">{radio.tagline}</p>
        <Button asChild>
          <a href={radio.siteUrl} target="_blank" rel="noopener noreferrer" aria-label={`Escuchar ${radio.name} ${radio.frequency} (abre el sitio de la radio)`}>
            <Headphones className="size-4" aria-hidden />
            Escuchar
          </a>
        </Button>
      </div>
    </Card>
  )
}

export default function RadiosPage() {
  const state = useData((r) => r.getRadios())
  return (
    <>
      <PageHeader icon={RadioIcon} title="Radios" subtitle="Emisoras de la zona. El botón abre el sitio de cada radio." />
      <Async state={state} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={RadioIcon} title="No hay emisoras cargadas" />}>
        {(radios) => (
          <div className="grid gap-4 sm:grid-cols-2">
            {radios.map((r, i) => (
              <RadioCard key={r.id} radio={r} index={i} />
            ))}
          </div>
        )}
      </Async>
    </>
  )
}
