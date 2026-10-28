import { isPushTopic } from '../../shared/categories'
import { bytesToB64url, checkPushEndpoint, checkSubscriptionKeys } from '../../shared/pushEndpoints'
import { TOPIC_INFO, TOPIC_ORDER } from '../../shared/pushTopics'
import { HttpError, json, Router, str, type Ctx } from '../http'
import { pushConfigured, testHosts } from '../push'
import { rateLimit, safeEqual, sha256 } from '../ratelimit'

/** Tope de dispositivos activos: protege el plan gratuito (D1 y envíos) frente a registros masivos. */
export const MAX_ACTIVE_SUBSCRIPTIONS = 5000

function parseTopics(v: unknown): string[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'Elegí al menos un tema')
  const topics = [...new Set(v.filter((t): t is string => typeof t === 'string' && isPushTopic(t)))]
  if (topics.length !== new Set(v).size) throw new HttpError(400, 'Tema desconocido')
  if (!topics.length) throw new HttpError(400, 'Elegí al menos un tema')
  return topics
}

interface Row {
  id: number
  token_hash: string | null
  active: number
  topics_json: string
  is_test: number
}

/** Un dispositivo se identifica por su endpoint + el token que solo él conoce (se entrega una sola vez al registrarse). */
async function authorize(ctx: Ctx, b: Record<string, unknown>): Promise<Row | null> {
  const endpoint = str(b.endpoint, 'endpoint', { max: 1024 })
  const token = str(b.token, 'token', { max: 128 })
  const row = await ctx.env.DB.prepare('SELECT id, token_hash, active, topics_json, is_test FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).first<Row>()
  if (!row) return null
  if (!row.token_hash || !safeEqual(row.token_hash, await sha256(token))) throw new HttpError(403, 'No autorizado para este dispositivo')
  return row
}

export function pushRoutes(r: Router): void {
  r.get('/api/public/push/config', (ctx) =>
    json({
      enabled: pushConfigured(ctx.env),
      publicKey: pushConfigured(ctx.env) ? ctx.env.VAPID_PUBLIC_KEY : null,
      topics: TOPIC_ORDER.map((id) => ({ id, ...TOPIC_INFO[id] })),
    }),
  )

  r.post('/api/public/push/subscribe', async (ctx) => {
    if (!pushConfigured(ctx.env)) throw new HttpError(503, 'Las notificaciones no están disponibles por ahora')
    await rateLimit(ctx, 'push-sub', 20, 3600)
    const b = await ctx.body()
    const endpointRaw = typeof b.endpoint === 'string' ? b.endpoint : ''
    const check = checkPushEndpoint(endpointRaw, testHosts(ctx.env))
    if (!check.ok) throw new HttpError(400, check.reason)
    const keysRaw = (b.keys ?? {}) as Record<string, unknown>
    const keys = checkSubscriptionKeys(keysRaw.p256dh, keysRaw.auth)
    if (!keys) throw new HttpError(400, 'Claves de suscripción inválidas')
    const topics = parseTopics(b.topics)
    const now = ctx.now.toISOString()

    const existing = await ctx.env.DB.prepare('SELECT id, token_hash, active, topics_json, is_test FROM push_subscriptions WHERE endpoint = ?').bind(endpointRaw).first<Row>()
    if (existing) {
      // Reenviar un endpoint conocido sin el token no permite alterar la suscripción de otra persona.
      const token = typeof b.token === 'string' ? b.token : ''
      if (!existing.token_hash || !token || !safeEqual(existing.token_hash, await sha256(token))) throw new HttpError(403, 'Este dispositivo ya está registrado. Desactivá las notificaciones y volvé a activarlas.')
      await ctx.env.DB.prepare('UPDATE push_subscriptions SET p256dh = ?, auth = ?, topics_json = ?, active = 1, failure_count = 0, last_error = NULL, service = ?, updated_at = ? WHERE id = ?')
        .bind(keys.p256dh, keys.auth, JSON.stringify(topics), check.service.id, now, existing.id)
        .run()
      return json({ ok: true, topics })
    }
    const total = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE active = 1').first<{ n: number }>()
    if ((total?.n ?? 0) >= MAX_ACTIVE_SUBSCRIPTIONS) throw new HttpError(503, 'Se alcanzó el máximo de dispositivos registrados')
    const token = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)))
    await ctx.env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, topics_json, active, failure_count, created_at, updated_at, token_hash, service)
       VALUES (?,?,?,?,1,0,?,?,?,?)`,
    )
      .bind(endpointRaw, keys.p256dh, keys.auth, JSON.stringify(topics), now, now, await sha256(token), check.service.id)
      .run()
    return json({ ok: true, topics, token }, { status: 201 })
  })

  r.post('/api/public/push/preferences', async (ctx) => {
    await rateLimit(ctx, 'push-pref', 60, 3600)
    const b = await ctx.body()
    const topics = parseTopics(b.topics)
    const row = await authorize(ctx, b)
    if (!row) throw new HttpError(404, 'Este dispositivo no está registrado')
    await ctx.env.DB.prepare('UPDATE push_subscriptions SET topics_json = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(topics), ctx.now.toISOString(), row.id).run()
    return json({ ok: true, topics })
  })

  r.post('/api/public/push/status', async (ctx) => {
    await rateLimit(ctx, 'push-status', 120, 3600)
    const row = await authorize(ctx, await ctx.body())
    if (!row) return json({ registered: false })
    return json({ registered: true, active: !!row.active, topics: JSON.parse(row.topics_json) as string[] })
  })

  r.post('/api/public/push/unsubscribe', async (ctx) => {
    await rateLimit(ctx, 'push-unsub', 60, 3600)
    const row = await authorize(ctx, await ctx.body())
    // Se elimina por completo (no queda ningún dato del dispositivo). Es idempotente.
    if (row) await ctx.env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(row.id).run()
    return json({ ok: true })
  })
}

