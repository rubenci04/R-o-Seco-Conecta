import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'
const KEY = 'rsc-theme'
const QUERY = '(prefers-color-scheme: dark)'

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function subscribeSystem(cb: () => void) {
  const mq = matchMedia(QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const systemDark = () => matchMedia(QUERY).matches

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readStored)
  const prefersDark = useSyncExternalStore(subscribeSystem, systemDark, () => false)
  const isDark = mode === 'dark' || (mode === 'system' && prefersDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    try {
      if (mode === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, mode)
    } catch {
      /* almacenamiento no disponible */
    }
  }, [mode, isDark])

  const toggle = useCallback(() => setMode(isDark ? 'light' : 'dark'), [isDark])
  return { mode, setMode, isDark, toggle }
}
