import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { AdminApiError, api, type Admin } from './api'

interface AuthState {
  /** 'loading' mientras se comprueba la sesión; 'anonymous' si no hay sesión válida. */
  status: 'loading' | 'anonymous' | 'authenticated'
  admin: Admin | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: AuthState['status']; admin: Admin | null }>({ status: 'loading', admin: null })

  useEffect(() => {
    let alive = true
    api.get<{ admin: Admin | null }>('/me').then(
      (r) => alive && setState(r.admin ? { status: 'authenticated', admin: r.admin } : { status: 'anonymous', admin: null }),
      () => alive && setState({ status: 'anonymous', admin: null }),
    )
    return () => {
      alive = false
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    try {
      const r = await api.post<{ admin: Admin }>('/login', { email, password })
      setState({ status: 'authenticated', admin: r.admin })
    } catch (e) {
      // Mensajes claros sin revelar si el correo existe.
      if (e instanceof AdminApiError && e.status === 401) throw new Error('Correo o contraseña incorrectos.', { cause: e })
      if (e instanceof AdminApiError && e.status === 429) throw new Error('Demasiados intentos fallidos. La cuenta está bloqueada unos minutos; probá más tarde.', { cause: e })
      throw e
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/logout')
    } finally {
      setState({ status: 'anonymous', admin: null })
    }
  }, [])

  return <AuthContext.Provider value={{ ...state, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}

/** Permisos en la interfaz (solo para mostrar u ocultar controles: el servidor vuelve a comprobarlos siempre). */
export const canEdit = (a: Admin | null) => a?.role === 'admin' || a?.role === 'editor'
export const isAdmin = (a: Admin | null) => a?.role === 'admin'
