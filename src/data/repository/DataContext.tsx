import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { LocalJsonRepository } from './localJsonRepository'
import type { DataRepository } from './types'

const defaultRepository = new LocalJsonRepository()
const DataContext = createContext<DataRepository>(defaultRepository)

export function DataProvider({ repository, children }: { repository?: DataRepository; children: ReactNode }) {
  return <DataContext.Provider value={repository ?? defaultRepository}>{children}</DataContext.Provider>
}

export const useRepository = () => useContext(DataContext)

export type AsyncState<T> = { status: 'loading' } | { status: 'error'; error: Error } | { status: 'ready'; data: T }

/** Carga asíncrona con estados de carga / error / listo. */
export function useData<T>(load: (repo: DataRepository) => Promise<T>): AsyncState<T> {
  const repo = useRepository()
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    load(repo).then(
      (data) => !cancelled && setState({ status: 'ready', data }),
      (error) => !cancelled && setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) }),
    )
    return () => {
      cancelled = true
    }
    // `load` se declara inline en cada uso; la carga depende solo del repositorio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo])
  return state
}
