import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { AdminApiError } from './api'

export const inputClass =
  'min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground transition focus:border-accent disabled:opacity-60'

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export const TextInput = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cn(inputClass, className)} {...p} />
export const TextArea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cn(inputClass, 'min-h-32 py-2 leading-relaxed', className)} {...p} />
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn(inputClass, className)} {...p} />

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'ok'; children: ReactNode }) {
  const cls = { info: 'bg-accent-soft text-accent', error: 'bg-danger-soft text-danger', ok: 'bg-accent-soft text-accent' }[tone]
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-xl p-3 text-sm font-semibold', cls)}>
      {children}
    </p>
  )
}

const STATUS: Record<string, { label: string; tone: 'info' | 'warning' | 'danger' | 'neutral' }> = {
  published: { label: 'Publicada', tone: 'info' },
  draft: { label: 'Borrador', tone: 'neutral' },
  pending: { label: 'En revisión', tone: 'warning' },
  rejected: { label: 'Rechazada', tone: 'danger' },
  deleted: { label: 'Retirada', tone: 'danger' },
  proposed: { label: 'Sin confirmar', tone: 'warning' },
  confirmed: { label: 'Confirmada', tone: 'info' },
  dismissed: { label: 'Descartada', tone: 'neutral' },
  approved: { label: 'Aprobado', tone: 'info' },
  retracted: { label: 'Retirado', tone: 'danger' },
}
export const StatusBadge = ({ status }: { status: string }) => {
  const s = STATUS[status] ?? { label: status, tone: 'neutral' as const }
  return <Badge tone={s.tone}>{s.label}</Badge>
}

/** Carga de datos del panel con recarga manual y manejo de errores (incluye sesión vencida). */
export function useAdminData<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<AdminApiError | Error | null>(null)
  const [loading, setLoading] = useState(true)
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })
  const [tick, setTick] = useState(0)
  const key = JSON.stringify(deps)
  useEffect(() => {
    let alive = true
    loadRef.current().then(
      (d) => {
        if (!alive) return
        setData(d)
        setError(null)
        setLoading(false)
      },
      (e) => {
        if (!alive) return
        setError(e instanceof Error ? e : new Error(String(e)))
        setLoading(false)
      },
    )
    return () => {
      alive = false
    }
  }, [key, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

/** Ejecuta una acción del panel (guardar, publicar…) con estado de «en curso», error y confirmación. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const run = useCallback(async <T,>(fn: () => Promise<T>, okText: string): Promise<T | undefined> => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await fn()
      setMessage({ tone: 'ok', text: okText })
      return r
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'No se pudo completar la acción.' })
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, message, run, clear: () => setMessage(null) }
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-display text-2xl font-extrabold">{title}</h1>
      {children}
    </div>
  )
}
