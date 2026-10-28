import { AlertTriangle, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AsyncState } from '@/data/repository/DataContext'
import { Card } from '@/components/ui/card'

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-2 border-dashed py-8 text-center" role="status">
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="font-display text-base font-bold">{title}</p>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
    </Card>
  )
}

export function LoadingState({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {[0, 1].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-[var(--radius-card)] bg-muted" />
      ))}
    </div>
  )
}

export function ErrorState({ error }: { error?: Error }) {
  return (
    <Card role="alert" className="flex gap-3 border-danger/40 bg-danger-soft text-danger">
      <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div>
        <p className="font-bold">No pudimos cargar esta información</p>
        <p className="text-sm opacity-90">Probá recargar la página. {error ? `Detalle: ${error.message}` : ''}</p>
      </div>
    </Card>
  )
}

/** Renderiza carga / error / vacío / contenido según el estado asíncrono. */
export function Async<T>({
  state,
  isEmpty,
  empty,
  children,
}: {
  state: AsyncState<T>
  isEmpty: (data: T) => boolean
  empty: ReactNode
  children: (data: T) => ReactNode
}) {
  if (state.status === 'loading') return <LoadingState />
  if (state.status === 'error') return <ErrorState error={state.error} />
  return <>{isEmpty(state.data) ? empty : children(state.data)}</>
}
