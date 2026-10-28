import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { HybridRepository } from './hybridRepository'
import { LocalJsonRepository } from './localJsonRepository'
import type { DataRepository } from './types'

/**
 * Modo de datos: 'hybrid' (API en D1 para noticias/alertas/agenda/obituarios + JSON para el resto) o 'local' (todo JSON).
 * En producción es 'hybrid'; en desarrollo, pruebas y E2E estáticos es 'local' (se puede forzar con VITE_DATA_MODE).
 */
export function dataMode(): 'hybrid' | 'local' {
  const forced = (import.meta.env as Record<string, string | undefined>).VITE_DATA_MODE
  if (forced === 'hybrid' || forced === 'local') return forced
  return import.meta.env.PROD ? 'hybrid' : 'local'
}

export const createRepository = (mode = dataMode()): DataRepository => (mode === 'hybrid' ? new HybridRepository() : new LocalJsonRepository())

const defaultRepository = createRepository()
const DataContext = createContext<DataRepository>(defaultRepository)

export function DataProvider({ repository, children }: { repository?: DataRepository; children: ReactNode }) {
  return <DataContext.Provider value={repository ?? defaultRepository}>{children}</DataContext.Provider>
}

export const useRepository = () => useContext(DataContext)

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: Error; reload: () => void }
  | { status: 'ready'; data: T; updatedAt: Date; refreshing: boolean }

export interface UseDataOptions {
  /** Cambiar este valor vuelve a cargar (p. ej. al cambiar un filtro). */
  key?: string
  /** Revalida cada N ms mientras la pestaña está visible, y al volver a ella. Sin valor: carga única. */
  revalidateMs?: number
}

/**
 * Carga asíncrona con estados de carga / error / listo. Con `revalidateMs` mantiene los datos a la vista
 * mientras se actualizan en segundo plano (sin parpadeos) y registra cuándo se actualizaron por última vez.
 */
type Settled<T> = { key: string } & ({ status: 'ready'; data: T; updatedAt: Date } | { status: 'error'; error: Error })
const toError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)))

export function useData<T>(load: (repo: DataRepository) => Promise<T>, opts: UseDataOptions = {}): AsyncState<T> {
  const repo = useRepository()
  const [tick, setTick] = useState(0)
  const [settled, setSettled] = useState<Settled<T> | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const fullKey = `${opts.key ?? ''}#${tick}`
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    let alive = true
    loadRef.current(repo).then(
      (data) => alive && setSettled({ key: fullKey, status: 'ready', data, updatedAt: new Date() }),
      (error) => alive && setSettled({ key: fullKey, status: 'error', error: toError(error) }),
    )
    return () => {
      alive = false
    }
  }, [repo, fullKey])

  const { revalidateMs } = opts
  useEffect(() => {
    if (!revalidateMs) return
    let alive = true
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      setRefreshing(true)
      loadRef.current(repo).then(
        (data) => {
          if (!alive) return
          setSettled({ key: fullKey, status: 'ready', data, updatedAt: new Date() })
          setRefreshing(false)
        },
        () => alive && setRefreshing(false), // si falla la revalidación se conservan los datos a la vista
      )
    }
    const id = setInterval(refresh, revalidateMs)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      alive = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [repo, fullKey, revalidateMs])

  if (!settled || settled.key !== fullKey) return { status: 'loading' }
  if (settled.status === 'error') return { status: 'error', error: settled.error, reload: () => setTick((t) => t + 1) }
  return { status: 'ready', data: settled.data, updatedAt: settled.updatedAt, refreshing }
}
