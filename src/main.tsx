import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { registerSW } from 'virtual:pwa-register'
import { DataProvider } from '@/data/repository/DataContext'
import { AppRoutes } from './routes'
import './index.css'

// Una PWA instalada puede quedar abierta días: se busca una versión nueva al volver a la app y cada 30 minutos.
// Con `autoUpdate` el service worker nuevo toma el control y la página se recarga sola; el modo sin conexión no cambia.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    const check = () => void registration.update().catch(() => undefined)
    window.setInterval(check, 30 * 60 * 1000)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <DataProvider>
        <AppRoutes />
      </DataProvider>
    </BrowserRouter>
  </StrictMode>,
)
