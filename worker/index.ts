import { adminRoutes } from './api/admin'
import { publicRoutes } from './api/public'
import { assertCsrf, authenticate } from './auth'
import type { Env } from './env'
import { HttpError, json, makeBody, Router, type Ctx } from './http'
import { processNotifications } from './notify'
import { createVapidSender } from './push'
import { PRODUCTION_FEATURES, type Features } from './features'
import { runSyncCycle, type SyncDeps } from './sync'

export interface AppDeps extends SyncDeps {
  now?: () => Date
  /** Por defecto, las de producción (push y módulos estáticos desactivados). */
  features?: Partial<Features>
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
  async function handleApi(req: Request, env: Env): Promise<Response | null> {
    const url = new URL(req.url)
    if (!url.pathname.startsWith('/api/')) return null
    const now = deps.now?.() ?? new Date()
    try {
      const match = router.match(req.method, url.pathname)
      if (match === null) throw new HttpError(404, 'No encontrado')
      if (match === 'method-not-allowed') throw new HttpError(405, 'Método no permitido')
      const ctx: Ctx = { req, env, url, params: match.params, now, body: makeBody(req) }
      if (url.pathname.startsWith('/api/admin/')) {
        assertCsrf(req)
        ctx.admin = (await authenticate(env, req, now)) ?? undefined
        if (!ctx.admin && url.pathname !== '/api/admin/login') throw new HttpError(401, 'Iniciá sesión para continuar')
      }
      const res = await match.handler(ctx)
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v)
      return res
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, { status: e.status, headers: SECURITY_HEADERS })
      console.error('Error no controlado en la API', e)
      return json({ error: 'Error interno' }, { status: 500, headers: SECURITY_HEADERS })
    }
  }

  /** Tarea programada (cada minuto): sincroniza fuentes habilitadas y envía notificaciones pendientes. */
  async function scheduled(env: Env, now = deps.now?.() ?? new Date()) {
    const sync = await runSyncCycle(env, now, deps)
    const push = await processNotifications(env.DB, createVapidSender(env, () => now), now)
    return { sync, push }
  }

  return { handleApi, scheduled }
}

const app = createApp()

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return (await app.handleApi(req, env)) ?? env.ASSETS.fetch(req)
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(app.scheduled(env).then(() => undefined))
  },
} satisfies ExportedHandler<Env>
