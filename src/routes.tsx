import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { EmptyState } from '@/components/shared/States'
import { Compass } from 'lucide-react'

const HomePage = lazy(() => import('@/pages/HomePage'))
const BusesPage = lazy(() => import('@/pages/BusesPage'))
const HeritagePage = lazy(() => import('@/pages/HeritagePages'))
const HeritageDetailPage = lazy(() => import('@/pages/HeritagePages').then((m) => ({ default: m.HeritageDetailPage })))
const MapPage = lazy(() => import('@/pages/MapPage'))
const PlaceDetailPage = lazy(() => import('@/pages/PlaceDetailPage'))
const ServicesPage = lazy(() => import('@/pages/ServicesPage'))
const RadiosPage = lazy(() => import('@/pages/RadiosPage'))
const NewsPage = lazy(() => import('@/pages/ContentPages').then((m) => ({ default: m.NewsPage })))
const AlertsPage = lazy(() => import('@/pages/ContentPages').then((m) => ({ default: m.AlertsPage })))
const AgendaPage = lazy(() => import('@/pages/ContentPages').then((m) => ({ default: m.AgendaPage })))
const ObituariesPage = lazy(() => import('@/pages/ContentPages').then((m) => ({ default: m.ObituariesPage })))
const ComunaPage = lazy(() => import('@/pages/InfoPages').then((m) => ({ default: m.ComunaPage })))
const MorePage = lazy(() => import('@/pages/InfoPages').then((m) => ({ default: m.MorePage })))
const AboutPage = lazy(() => import('@/pages/InfoPages').then((m) => ({ default: m.AboutPage })))

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="colectivos" element={<BusesPage />} />
        <Route path="pueblo" element={<HeritagePage />} />
        <Route path="nuestro-pueblo" element={<Navigate to="/pueblo" replace />} />
        <Route path="pueblo/:id" element={<HeritageDetailPage />} />
        <Route path="servicios" element={<ServicesPage />} />
        <Route path="servicios/:id" element={<PlaceDetailPage />} />
        <Route path="mapa" element={<MapPage />} />
        <Route path="noticias" element={<NewsPage />} />
        <Route path="alertas" element={<AlertsPage />} />
        <Route path="radios" element={<RadiosPage />} />
        <Route path="agenda" element={<AgendaPage />} />
        <Route path="obituarios" element={<ObituariesPage />} />
        <Route path="comuna" element={<ComunaPage />} />
        <Route path="acerca" element={<AboutPage />} />
        <Route path="mas" element={<MorePage />} />
        <Route path="inicio" element={<Navigate to="/" replace />} />
        <Route path="*" element={<EmptyState icon={Compass} title="Página no encontrada">Revisá la dirección o volvé al inicio.</EmptyState>} />
      </Route>
    </Routes>
  )
}
