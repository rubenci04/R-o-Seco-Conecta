import { bytesToB64url, checkPushEndpoint, checkSubscriptionKeys } from '../../shared/pushEndpoints'
import { requirePermission } from '../auth'
import { HttpError, json, Router, str } from '../http'
import { enqueueTestNotification, processNotifications } from '../notify'
import { createVapidSender, pushConfigured, testHosts } from '../push'

/**
 * Sección «Notificaciones» del panel. NO existe un envío masivo manual: los avisos nacen solo de publicar una noticia
 * o confirmar una alerta (con sus reglas editoriales). La única emisión manual es una prueba a UN dispositivo de prueba
 * registrado expresamente por un administrador.
 */
export function notificationAdminRoutes(r: Router, pushFetch?: typeof fetch): void {
  r.get('/api/admin/notifications', async (ctx) => {
    requirePermission(ctx, 'content:read')
    const db = ctx.env.DB
    const [subs, byTopic, logStates, deliveryStates, log] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(active = 1 AND is_test = 0), 0) AS active, COALESCE(SUM(active = 0), 0) AS inactive, COALESCE(SUM(is_test = 1 AND active = 1), 0) AS test FROM push_subscriptions').first(),
      db.prepare("SELECT j.value AS topic, COUNT(*) AS n FROM push_subscriptions s, json_each(s.topics_json) j WHERE s.active = 1 AND s.is_test = 0 GROUP BY j.value ORDER BY n DESC").all<{ topic: string; n: number }>(),
      db.prepare('SELECT state, COUNT(*) AS n FROM notification_log GROUP BY state').all<{ state: string; n: number }>(),
      db.prepare('SELECT state, COUNT(*) AS n FROM notification_deliveries GROUP BY state').all<{ state: string; n: number }>(),
      db.prepare('SELECT id, entity_type, entity_id, topics_json, urgent, title, url, state, suppressed_reason, attempted, succeeded, failed, last_error, created_at, finished_at, test_subscription_id FROM notification_log ORDER BY id DESC LIMIT 100').all(),
    ])
    return json({
      configured: pushConfigured(ctx.env),
      subscriptions: subs,
      topics: byTopic.results,
      notificationStates: Object.fromEntries(logStates.results.map((x) => [x.state, x.n])),
      deliveryStates: Object.fromEntries(deliveryStates.results.map((x) => [x.state, x.n])),
      log: log.results,
    })
  })

  // Historial de intentos de un aviso: sin endpoints ni claves, solo el resultado por dispositivo.
  r.get('/api/admin/notifications/:id/deliveries', async (ctx) => {
    requirePermission(ctx, 'content:read')
    const id = Number(ctx.params.id)
    const rows = await ctx.env.DB.prepare(
      `SELECT d.id, d.subscription_id, s.service, s.is_test, d.state, d.attempts, d.last_status, d.last_error, d.next_attempt_at, d.sent_at, d.created_at
       FROM notification_deliveries d JOIN push_subscriptions s ON s.id = d.subscription_id WHERE d.notification_id = ? ORDER BY d.id LIMIT 200`,
    ).bind(id).all()
    return json(rows.results)
  })

  r.post('/api/admin/notifications/process', async (ctx) => {
    requirePermission(ctx, 'notifications:manage')
    return json(await processNotifications(ctx.env.DB, createVapidSender(ctx.env, () => ctx.now, pushFetch), ctx.now))
  })

  // ---- Dispositivos de prueba ----
  r.get('/api/admin/notifications/test-devices', async (ctx) => {
    requirePermission(ctx, 'notifications:manage')
    const rows = await ctx.env.DB.prepare('SELECT id, label, service, active, last_success_at, last_error, created_at FROM push_subscriptions WHERE is_test = 1 ORDER BY id').all()
    return json(rows.results)
  })

  r.post('/api/admin/notifications/test-devices', async (ctx) => {
    requirePermission(ctx, 'notifications:manage')
    if (!pushConfigured(ctx.env)) throw new HttpError(503, 'Faltan las claves VAPID')
    const b = await ctx.body()
    const check = checkPushEndpoint(b.endpoint, testHosts(ctx.env))
    if (!check.ok) throw new HttpError(400, check.reason)
    const k = (b.keys ?? {}) as Record<string, unknown>
    const keys = checkSubscriptionKeys(k.p256dh, k.auth)
    if (!keys) throw new HttpError(400, 'Claves de suscripción inválidas')
    const label = str(b.label, 'label', { max: 60 })
    const endpoint = b.endpoint as string
    const now = ctx.now.toISOString()
    // Un dispositivo de prueba nunca recibe avisos masivos: topics vacío y bandera is_test.
    await ctx.env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, topics_json, active, failure_count, created_at, updated_at, service, is_test, label, token_hash)
       VALUES (?,?,?,'[]',1,0,?,?,?,1,?,?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, active = 1, failure_count = 0, is_test = 1, topics_json = '[]', label = excluded.label, updated_at = excluded.updated_at`,
    )
      .bind(endpoint, keys.p256dh, keys.auth, now, now, check.service.id, label, bytesToB64url(crypto.getRandomValues(new Uint8Array(16))))
      .run()
    const row = await ctx.env.DB.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).first<{ id: number }>()
    return json({ id: row?.id }, { status: 201 })
  })

  r.delete('/api/admin/notifications/test-devices/:id', async (ctx) => {
    requirePermission(ctx, 'notifications:manage')
    await ctx.env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ? AND is_test = 1').bind(Number(ctx.params.id)).run()
    return json({ ok: true })
  })

  r.post('/api/admin/notifications/test-devices/:id/send', async (ctx) => {
    requirePermission(ctx, 'notifications:manage')
    const sender = createVapidSender(ctx.env, () => ctx.now, pushFetch)
    if (!sender) throw new HttpError(503, 'Faltan las claves VAPID')
    const queued = await enqueueTestNotification(ctx.env.DB, Number(ctx.params.id), ctx.now, bytesToB64url(crypto.getRandomValues(new Uint8Array(6))))
    if (!queued.queued) throw new HttpError(404, queued.reason)
    ctx.after(processNotifications(ctx.env.DB, sender, ctx.now))
    return json({ ok: true, notificationId: queued.id })
  })
}
