import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Las pruebas de `shared/` y `worker/` corren en entorno node (sin DOM).
if (typeof window !== 'undefined') {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
  }

  window.scrollTo = () => {}
}
