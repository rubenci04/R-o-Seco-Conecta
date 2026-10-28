import { Moon, Sun } from 'lucide-react'
import { Suspense } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { LoadingState } from '@/components/shared/States'
import { APP } from '@/config/app'
import { BOTTOM_NAV, NAV_ITEMS } from '@/config/nav'
import { cn } from '@/lib/utils'
import { useTheme } from '@/services/theme'

function Brand() {
  return (
    <NavLink to="/" className="flex items-center gap-2.5" aria-label="Río Seco Conecta, ir al inicio">
      <img src="/brand/logo-mark-v2.png" alt="" className="h-9 w-auto rounded-lg dark:bg-white dark:p-0.5" width={45} height={36} />
      <span className="font-display text-lg font-extrabold leading-none">
        Río Seco <span className="text-primary">Conecta</span>
      </span>
    </NavLink>
  )
}

function ThemeToggle() {
  const { isDark, toggle } = useTheme()
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      className="grid size-11 cursor-pointer place-items-center rounded-full text-foreground transition hover:bg-muted active:scale-95"
    >
      {isDark ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </button>
  )
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition',
    isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground hover:bg-muted',
  )

export function AppShell() {
  const { pathname } = useLocation()
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[17rem_1fr]">
      <aside className="hidden border-r border-border bg-card/60 p-5 md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:gap-6">
        <Brand />
        <nav aria-label="Secciones" className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={linkClass}>
              <Icon className="size-5" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
          <span>v{APP.version}</span>
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/90 px-4 py-2 backdrop-blur md:hidden">
          <Brand />
          <ThemeToggle />
        </header>

        <main id="contenido" className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-12 md:pt-8" key={pathname}>
          <Suspense fallback={<LoadingState />}>
            <Outlet />
          </Suspense>
        </main>

        <footer className="mx-auto hidden w-full max-w-3xl px-8 pb-8 text-xs text-muted-foreground md:block">{APP.disclaimer}</footer>
      </div>

      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {BOTTOM_NAV.map(({ to, label, short, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-16 flex-col items-center justify-center gap-1 text-[0.7rem] font-semibold transition',
                    isActive ? 'text-primary' : 'text-muted-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cn('grid h-7 w-14 place-items-center rounded-full transition', isActive && 'bg-primary/15')}>
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span aria-label={label}>{short ?? label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
