import { useCallback, useState } from 'react'
import type { BusQuery } from '@/features/transport/query'
import { queryToParams } from '@/features/transport/query'

const KEY = 'rsc-favoritos'

export interface FavoriteRoute {
  id: string
  query: BusQuery
}

export const favoriteId = (q: BusQuery) => `${q.direction}:${q.localityId}`

export function loadFavorites(storage: Pick<Storage, 'getItem'> = localStorage): FavoriteRoute[] {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((f) => f && typeof f.id === 'string' && f.query) : []
  } catch {
    return []
  }
}

function save(list: FavoriteRoute[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* almacenamiento no disponible: se mantiene solo en memoria */
  }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteRoute[]>(() => loadFavorites())
  const toggle = useCallback((query: BusQuery) => {
    setFavorites((prev) => {
      const id = favoriteId(query)
      const next = prev.some((f) => f.id === id)
        ? prev.filter((f) => f.id !== id)
        : [...prev, { id, query: { ...query, mode: 'next' as const, time: undefined } }]
      save(next)
      return next
    })
  }, [])
  const isFavorite = useCallback((query: BusQuery) => favorites.some((f) => f.id === favoriteId(query)), [favorites])
  return { favorites, toggle, isFavorite }
}

export const favoriteHref = (q: BusQuery) => `/colectivos?${queryToParams(q).toString()}`
