import { Bell, BellRing, CalendarDays, FileText, Flower2, History, LayoutDashboard, LogOut, Plug, ShieldCheck, UserCog, Users } from 'lucide-react'
import { useEffect } from 'react'
import { Link, NavLink, Route, Routes } from 'react-router'
import { LoadingState } from '@/components/shared/States'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTheme } from '@/services/theme'
import { AuthProvider, isAdmin, useAuth } from './auth'
import { AlertsAdmin } from './pages/Alerts'
import { Dashboard } from './pages/Dashboard'
import { EventsAdmin } from './pages/Events'
import { LoginPage } from './pages/Login'
import { NotificationsAdmin } from './pages/Notifications'
import { ObituariesAdmin } from './pages/Obituaries'
import { PostEditor, PostsList } from './pages/Posts'
import { RetroImport } from './pages/Retro'
import { SourcesAdmin } from './pages/Sources'
import { AccountPage, UsersAdmin } from './pages/Users'

/** El panel es privado: se pide a los buscadores que no lo indexen. */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => {
      meta.remove()
    }
  }, [])
}

const NAV = [
  { to: '/admin', label: 'Panel', icon: LayoutDashboard, end: true },
  { to: '/admin/noticias', label: 'Noticias', icon: FileText },
  { to: '/admin/alertas', label: 'Alertas', icon: Bell },
  { to: '/admin/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/admin/obituarios', label: 'Obituarios', icon: Flower2 },
  { to: '/admin/notificaciones', label: 'Notificaciones', icon: BellRing },
  { to: '/admin/fuentes', label: 'Fuentes', icon: Plug },
  { to: '/admin/recuperar', label: 'Recuperar', icon: History },
]

function Shell() {
  const { admin, logout } = useAuth()
  useTheme() // aplica el tema guardado
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2">
          <Link to="/admin" className="flex items-center gap-2 font-display text-lg font-extrabold" aria-label="Panel de administración">
            <img src="/brand/logo-mark-v2.png" alt="" className="h-8 w-auto rounded-md" width={40} height={32} />
            <span>
              Panel <span className="text-primary">Río Seco</span>
            </span>
          </Link>
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden text-muted-foreground sm:inline">
              {admin?.displayName} · {admin?.role === 'admin' ? 'Administrador' : admin?.role === 'editor' ? 'Editor' : 'Lectura'}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void logout()}>
              <LogOut className="size-4" aria-hidden />
              Salir
            </Button>
          </div>
        </div>
        <nav aria-label="Secciones del panel" className="mx-auto max-w-5xl overflow-x-auto px-4 pb-2">
          <ul className="flex gap-1.5">
            {[
              ...NAV,
              ...(isAdmin(admin) ? [{ to: '/admin/usuarios', label: 'Usuarios', icon: Users }] : []),
              { to: '/admin/cuenta', label: 'Mi cuenta', icon: UserCog },
            ].map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn('flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold transition', isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted')
                  }
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="noticias" element={<PostsList />} />
          <Route path="noticias/nueva" element={<PostEditor />} />
          <Route path="noticias/:id" element={<PostEditor />} />
          <Route path="alertas" element={<AlertsAdmin />} />
          <Route path="agenda" element={<EventsAdmin />} />
          <Route path="obituarios" element={<ObituariesAdmin />} />
          <Route path="notificaciones" element={<NotificationsAdmin />} />
          <Route path="fuentes" element={<SourcesAdmin />} />
          <Route path="recuperar" element={<RetroImport />} />
          <Route path="usuarios" element={isAdmin(admin) ? <UsersAdmin /> : <p>No tenés permiso para esta sección.</p>} />
          <Route path="cuenta" element={<AccountPage />} />
          <Route path="*" element={<p>Sección no encontrada.</p>} />
        </Routes>
        <p className="mt-10 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-4" aria-hidden />
          Acceso privado. Los permisos se verifican siempre en el servidor.
        </p>
      </main>
    </div>
  )
}

function Gate() {
  const { status } = useAuth()
  if (status === 'loading')
    return (
      <div className="mx-auto max-w-md p-6">
        <LoadingState label="Comprobando sesión…" />
      </div>
    )
  return status === 'authenticated' ? <Shell /> : <LoginPage />
}

export default function AdminApp() {
  useNoIndex()
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
