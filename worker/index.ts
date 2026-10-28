import { adminRoutes } from './api/admin'
import { publicRoutes } from './api/public'
import { assertCsrf, authenticate } from './auth'
import type { Env } from './env'
import { HttpError, json, makeBody, Router, type Ctx } from './http'
import { cleanupPush, processNotifications } from './notify'
import { createVapidSender } from './push'
import { PRODUCTION_FEATURES, type Features } from './features'
import { runSyncCycle, type SyncDeps } from './sync'

export interface AppDeps extends SyncDeps {
  now?: () => Date
  /** Por defecto, las de producción (push y módulos estáticos desactivados). */
  features?: Partial<Features>
  /** Solo pruebas: reemplaza `fetch` en el envío de notificaciones (servidor push simulado). */
  pushFetch?: typeof fetch
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
}

export function createApp(deps: AppDeps = {}) {
  const features: Features = { ...PRODUCTION_FEATURES, ...deps.features }
  const router = new Router()
  publicRoutes(router, features)
  adminRoutes(router, deps, features)

  /** Atiende solo /api/*. Devuelve null si la ruta no es de la API. */
  async function handleApi(req: Request, env: Env, waitUntil?: (p: Promise<unknown>) => void): Promise<Response | null> {
    const url = new URL(req.url)
    if (!url.pathname.startsWith('/api/')) return null
    const now = deps.now?.() ?? new Date()
    try {
      // La API administrativa exige sesión ANTES de resolver la ruta: sin sesión nunca se revela qué rutas existen.
      let admin: Ctx['admin']
      if (url.pathname.startsWith('/api/admin/')) {
        assertCsrf(req)
        admin = (await authenticate(env, req, now)) ?? undefined
        // /me es la única ruta que responde sin sesión (con admin: null): así la aplicación sabe si mostrar el acceso sin generar un error 401 en la consola.
        if (!admin && url.pathname !== '/api/admin/login' && url.pathname !== '/api/admin/me') throw new HttpError(401, 'Iniciá sesión para continuar')
      }
      const match = router.match(req.method, url.pathname)
      if (match === null) throw new HttpError(404, 'No encontrado')
      if (match === 'method-not-allowed') throw new HttpError(405, 'Método no permitido')
      const after = (work: Promise<unknown>) => (waitUntil ? waitUntil(work.catch((e) => console.error('Tarea posterior fallida', e))) : void work.catch(() => undefined))
      const ctx: Ctx = { req, env, url, params: match.params, now, body: makeBody(req), admin, after }
      const res = await match.handler(ctx)
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v)
      return res
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, { status: e.status, headers: SECURITY_HEADERS })
      console.error('Error no controlado en la API', e)
      return json({ error: 'Error interno' }, { status: 500, headers: SECURITY_HEADERS })
    }
  }

  /**
   * Tarea programada (cada 5 minutos): continúa y reintenta envíos pendientes y limpia datos viejos.
   * La sincronización con fuentes solo corre si `scheduledSync` está activo (hoy no: Sprint 06).
   */
  async function scheduled(env: Env, now = deps.now?.() ?? new Date()) {
    const sync = features.scheduledSync ? await runSyncCycle(env, now, deps) : null
    const push = features.push ? await processNotifications(env.DB, createVapidSender(env, () => now, deps.pushFetch), now) : null
    if (features.push && now.getUTCMinutes() < 5) await cleanupPush(env.DB, now)
    return { sync, push }
  }

  return { handleApi, scheduled }
}

const app = createApp()

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return (await app.handleApi(req, env, (p) => ctx.waitUntil(p))) ?? env.ASSETS.fetch(req)
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(app.scheduled(env).then(() => undefined))
  },
} satisfies ExportedHandler<Env>
