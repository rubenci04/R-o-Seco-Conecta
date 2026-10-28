import { describe, expect, it, vi } from 'vitest'
import { parseAssistedBlocks } from '../../shared/assistedImport'
import { DEFAULT_GRAPH_VERSION, FacebookPageConnector } from '../connectors/meta'
import { enqueueAlertNotification, enqueuePostNotification, processNotifications } from '../notify'
import { harness, NOW, TEXT } from './helpers'

// Los textos son SINTÉTICOS: redactados para probar reglas, no son publicaciones reales.
const SUSPENSION = 'Se suspende la recolección de residuos de hoy por las intensas lluvias. Se retomará mañana en el horario habitual.'
const FUNERAL = 'Con inmenso dolor comunicamos que partió a la casa del Padre Juana Pérez. Sus restos serán velados en su domicilio, sepelio a las 16 hs.'

const sub = (db: ReturnType<typeof Object>, n: number, topics: string[]) =>
  (db as { prepare: (s: string) => { bind: (...a: unknown[]) => { runSync: () => void } } })
    .prepare('INSERT INTO push_subscriptions (endpoint, p256dh, auth, topics_json, created_at) VALUES (?,?,?,?,?)')
    .bind(`https://push.test/${n}`, 'k', 'a', JSON.stringify(topics), NOW.toISOString())
    .runSync()

describe('migración 0007: categoría residuos (aditiva)', () => {
  it('agrega la categoría sin tocar las demás ni las suscripciones existentes', async () => {
    const h = await harness()
    expect((h.db.raw.prepare('SELECT COUNT(*) n FROM categories').get() as { n: number }).n).toBe(13)
    expect(h.db.raw.prepare("SELECT name FROM categories WHERE id = 'residuos'").get()).toEqual({ name: 'Recolección de residuos y limpieza urbana' })
    // Las preferencias guardadas no se modifican: nadie queda suscripto a «residuos» sin elegirlo.
    sub(h.db, 1, ['agua', 'urgente'])
    expect(h.db.raw.prepare('SELECT topics_json FROM push_subscriptions').get()).toEqual({ topics_json: '["agua","urgente"]' })
  })
})

describe('publicación de residuos: una sola publicación, varias secciones', () => {
  it('queda UNA publicación con varias categorías, en el feed general y en el filtro de residuos, con un aviso de servicio propuesto', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    const r = await h.call('POST', '/api/admin/posts', { cookie, body: { body: SUSPENSION, status: 'published' } })
    expect(r.status).toBe(201)
    expect(r.json.categories).toEqual(expect.arrayContaining(['residuos', 'meteorologica']))
    expect((h.db.raw.prepare('SELECT COUNT(*) n FROM posts').get() as { n: number }).n).toBe(1)

    const feed = await h.call('GET', '/api/public/feed')
    const filtered = await h.call('GET', '/api/public/feed?categoria=residuos')
    const weather = await h.call('GET', '/api/public/feed?categoria=meteorologica')
    expect(feed.json).toHaveLength(1)
    expect(filtered.json.map((p: { id: string }) => p.id)).toEqual(feed.json.map((p: { id: string }) => p.id))
    expect(weather.json).toHaveLength(1)
    expect(feed.json[0].categories).toEqual(expect.arrayContaining(['residuos', 'meteorologica']))

    // El aviso de servicio solo se PROPONE: no es público ni notifica hasta que una persona lo confirma.
    const alert = h.db.raw.prepare('SELECT id, kind, severity, confirmation FROM alerts').get() as { id: number; kind: string; severity: string; confirmation: string }
    expect(alert).toMatchObject({ kind: 'comunicado', severity: 'info', confirmation: 'proposed' })
    expect((await h.call('GET', '/api/public/alerts')).json).toEqual([])
  })

  it('al confirmar el aviso aparece en Alertas con la categoría de residuos y vence solo', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    await h.call('POST', '/api/admin/posts', { cookie, body: { body: SUSPENSION, status: 'published' } })
    const id = (h.db.raw.prepare('SELECT id FROM alerts').get() as { id: number }).id
    expect((await h.call('POST', `/api/admin/alerts/${id}/confirm`, { cookie })).status).toBe(200)
    const active = (await h.call('GET', '/api/public/alerts')).json
    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({ kind: 'comunicado', severity: 'info', categories: expect.arrayContaining(['residuos']) })
    // Vencida: desaparece de los avisos vigentes pero la noticia sigue en el historial.
    h.db.raw.prepare("UPDATE alerts SET expires_at = '2026-10-28T10:00:00Z'").run()
    expect((await h.call('GET', '/api/public/alerts')).json).toEqual([])
    expect((await h.call('GET', '/api/public/feed')).json).toHaveLength(1)
  })

  it('una recolección habitual (informativa) se publica pero no propone alerta', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    const r = await h.call('POST', '/api/admin/posts', { cookie, body: { body: 'Recordamos los días de recolección de residuos domiciliarios: lunes, miércoles y viernes por la mañana.', status: 'published' } })
    expect(r.json.categories).toContain('residuos')
    expect((h.db.raw.prepare('SELECT COUNT(*) n FROM alerts').get() as { n: number }).n).toBe(0)
  })
})

describe('notificaciones de residuos', () => {
  const send = () => vi.fn(async () => ({ status: 201 }))

  it('residuos es un tema independiente: llega solo a quien lo eligió, una sola vez, y abre la publicación exacta', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    sub(h.db, 1, ['residuos'])
    sub(h.db, 2, ['agua', 'urgente', 'institucional'])
    sub(h.db, 3, ['meteorologica'])
    const r = await h.call('POST', '/api/admin/posts', { cookie, body: { body: 'Campaña de limpieza urbana este sábado en la plaza: jornada de limpieza abierta a todos los vecinos del pueblo.', status: 'published', categories: ['residuos'] } })
    expect((await enqueuePostNotification(h.env.DB, r.json.postId, NOW)).queued).toBe(true)
    expect(await enqueuePostNotification(h.env.DB, r.json.postId, NOW)).toEqual({ queued: false, reason: 'ya notificada' })
    const sender = send()
    await processNotifications(h.env.DB, sender, NOW)
    expect(sender).toHaveBeenCalledTimes(1)
    expect(sender.mock.calls[0] as unknown[]).toEqual([expect.objectContaining({ endpoint: 'https://push.test/1' }), expect.objectContaining({ type: 'post', url: `/noticias/${r.json.postId}` }), { urgent: false }])
  })

  it('una publicación multisección avisa UNA vez por dispositivo aunque coincida con varios temas elegidos', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    sub(h.db, 1, ['residuos', 'meteorologica', 'otros'])
    const r = await h.call('POST', '/api/admin/posts', { cookie, body: { body: SUSPENSION, status: 'published' } })
    await enqueuePostNotification(h.env.DB, r.json.postId, NOW)
    const sender = send()
    await processNotifications(h.env.DB, sender, NOW)
    expect(sender).toHaveBeenCalledTimes(1)
    expect((h.db.raw.prepare('SELECT COUNT(*) n FROM notification_deliveries').get() as { n: number }).n).toBe(1)
  })

  it('el aviso de servicio de una publicación de residuos llega a los suscriptos a residuos aunque no hayan elegido institucionales', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    sub(h.db, 1, ['residuos'])
    sub(h.db, 2, ['institucional'])
    const r = await h.call('POST', '/api/admin/posts', { cookie, body: { body: SUSPENSION, status: 'published' } })
    // La noticia todavía no se evaluó: la alerta se confirma primero y cubre la noticia (sin duplicados).
    const alertId = (h.db.raw.prepare('SELECT id FROM alerts WHERE post_id = ?').get(r.json.postId) as { id: number }).id
    await h.call('POST', `/api/admin/alerts/${alertId}/confirm`, { cookie })
    expect((await enqueueAlertNotification(h.env.DB, alertId, NOW)).queued).toBe(true)
    expect(h.db.raw.prepare('SELECT topics_json FROM notification_log').get()).toEqual({ topics_json: '["institucional","residuos"]' })
    expect(await enqueuePostNotification(h.env.DB, r.json.postId, NOW)).toEqual({ queued: false, reason: 'cubierta por una alerta' })
  })

  it('una importación histórica de residuos no notifica a nadie', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    sub(h.db, 1, ['residuos'])
    const r = await h.call('POST', '/api/admin/posts', { cookie, body: { body: SUSPENSION, status: 'published', publishedAt: '2026-09-01T10:00:00Z' } })
    expect((await enqueuePostNotification(h.env.DB, r.json.postId, NOW)).queued).toBe(false)
  })
})

describe('obituarios: revisión humana obligatoria', () => {
  it('un posible obituario nunca se publica solo ni genera notificación', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    const r = await h.call('POST', '/api/admin/posts', { cookie, body: { body: FUNERAL, status: 'published' } })
    expect(r.json.status).toBe('pending')
    expect((await h.call('GET', '/api/public/feed')).json).toEqual([])
    expect((await h.call('GET', '/api/public/obituaries')).json).toEqual([])
    expect((await enqueuePostNotification(h.env.DB, r.json.postId, NOW)).queued).toBe(false)
    expect((h.db.raw.prepare('SELECT COUNT(*) n FROM notification_log').get() as { n: number }).n).toBe(0)
  })
})

describe('importación asistida: vista previa y varias publicaciones', () => {
  const item = (over: Record<string, unknown> = {}) => ({ url: 'https://www.facebook.com/ComunaDeRioSeco/posts/1001', text: TEXT.torneo, ...over })

  it('la vista previa clasifica y detecta duplicados SIN guardar nada', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    const r = await h.call('POST', '/api/admin/posts/import-preview', { cookie, body: { items: [item(), item({ url: 'https://example.com/x' }), item({ url: 'https://www.facebook.com/ComunaDeRioSeco/posts/1002', text: SUSPENSION }), item({ url: 'https://www.facebook.com/ComunaDeRioSeco/posts/1003', text: FUNERAL })] } })
    expect(r.status).toBe(200)
    const [ok, bad, waste, obit] = r.json.items
    expect(ok).toMatchObject({ ok: true, outcome: 'publicada', platform: 'facebook' })
    expect(ok.categories.map((c: { id: string }) => c.id)).toContain('deportes')
    expect(bad).toMatchObject({ ok: false })
    expect(waste.categories.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['residuos']))
    expect(waste.alert).toMatchObject({ kind: 'comunicado', severity: 'info' })
    expect(obit).toMatchObject({ outcome: 'revision-obituario', obituary: expect.anything() })
    expect((h.db.raw.prepare('SELECT COUNT(*) n FROM posts').get() as { n: number }).n).toBe(0)
  })

  it('tras importar, la misma publicación (o la de Instagram con texto casi idéntico) se marca duplicada', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    expect((await h.call('POST', '/api/admin/posts/import-link', { cookie, body: item() })).status).toBe(201)
    const again = await h.call('POST', '/api/admin/posts/import-preview', { cookie, body: { items: [item(), item({ url: 'https://www.instagram.com/p/ABC123/', text: TEXT.torneo.toUpperCase() })] } })
    expect(again.json.items.map((i: { outcome: string }) => i.outcome)).toEqual(['duplicado', 'duplicado'])
    expect(again.json.items[0].duplicate.reason).toBe('external-id')
    expect((h.db.raw.prepare('SELECT COUNT(*) n FROM posts').get() as { n: number }).n).toBe(1)
  })

  it('exige permiso de edición y limita la cantidad', async () => {
    const h = await harness()
    const viewer = await h.loginAs('viewer')
    expect((await h.call('POST', '/api/admin/posts/import-preview', { cookie: viewer, body: { items: [item()] } })).status).toBe(403)
    const editor = await h.loginAs('editor')
    expect((await h.call('POST', '/api/admin/posts/import-preview', { cookie: editor, body: { items: Array.from({ length: 21 }, () => item()) } })).status).toBe(400)
    expect((await h.call('POST', '/api/admin/posts/import-preview', { cookie: editor, body: { items: [] } })).status).toBe(400)
  })

  it('el analizador de bloques separa publicaciones, toma la fecha de Tucumán y avisa lo que falta', () => {
    const r = parseAssistedBlocks(
      'https://www.facebook.com/x/posts/1\nFecha: 2026-10-28 09:30\nPrimer texto\ncon dos líneas\n---\nhttps://www.instagram.com/p/AAA/\nSegundo texto\n---\nTexto sin enlace\n---\nhttps://www.facebook.com/x/posts/3\n',
    )
    expect(r.entries).toEqual([
      { url: 'https://www.facebook.com/x/posts/1', text: 'Primer texto\ncon dos líneas', publishedAt: '2026-10-28T12:30:00.000Z' },
      { url: 'https://www.instagram.com/p/AAA/', text: 'Segundo texto', publishedAt: undefined },
    ])
    expect(r.errors).toEqual(['Bloque 3: falta el enlace de la publicación.', 'Bloque 4: falta el texto de la publicación (no se descarga automáticamente).'])
  })
})

describe('Facebook oficial: conector y ciclo programado (sin credenciales no hay llamadas)', () => {
  it('usa la versión vigente de la Graph API y envía el token en la cabecera, no en la URL', async () => {
    expect(DEFAULT_GRAPH_VERSION).toBe('v25.0')
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      void url
      return new Response(JSON.stringify({ data: [{ id: '1_2', message: 'Texto', created_time: '2026-10-28T12:00:00+0000', permalink_url: 'https://www.facebook.com/1/posts/2' }] }), { status: 200 })
    }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
    const h = await harness({ META_FACEBOOK_PAGE_ID: '123', META_PAGE_ACCESS_TOKEN: 'TOKEN-SECRETO' })
    const source = h.db.raw.prepare("SELECT * FROM sources WHERE id = 'facebook-comuna'").get() as never
    const out = await new FacebookPageConnector().fetchNew({ env: h.env, source, since: '2026-10-28T10:00:00.000Z', fetchImpl, limit: 5 })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/v25.0/123/published_posts?')
    expect(url).toContain('since=')
    expect(url).not.toContain('TOKEN-SECRETO')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN-SECRETO')
    expect(out.posts[0]).toMatchObject({ externalId: '1_2', url: 'https://www.facebook.com/1/posts/2', body: 'Texto' })
  })

  it('el cron sin fuentes habilitadas no llama a Meta; una fuente habilitada sin credenciales queda «sin configurar» sin llamar tampoco', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}')) as unknown as typeof fetch
    const h = await harness({}, { fetchImpl })
    expect((await h.app.scheduled(h.env, NOW)).sync).toEqual([])
    h.db.raw.prepare("UPDATE sources SET enabled = 1, mode = 'api' WHERE id = 'facebook-comuna'").run()
    const r = await h.app.scheduled(h.env, NOW)
    expect(r.sync?.[0]).toMatchObject({ sourceId: 'facebook-comuna', outcome: 'skipped' })
    expect(r.sync?.[0].detail).toMatch(/Faltan credenciales/)
    expect(h.db.raw.prepare("SELECT status FROM sources WHERE id = 'facebook-comuna'").get()).toEqual({ status: 'not-configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('con credenciales, el ciclo incorpora publicaciones, las clasifica, no duplica y retrocede ante un token vencido', async () => {
    const page = [
      { id: '9_1', message: SUSPENSION, created_time: '2026-10-28T14:00:00+0000', permalink_url: 'https://www.facebook.com/9/posts/1' },
      { id: '9_2', message: TEXT.torneo, created_time: '2026-10-28T14:10:00+0000', permalink_url: 'https://www.facebook.com/9/posts/2' },
    ]
    const ok = vi.fn(async () => new Response(JSON.stringify({ data: page }), { status: 200 })) as unknown as typeof fetch
    const h = await harness({ META_FACEBOOK_PAGE_ID: '9', META_PAGE_ACCESS_TOKEN: 'T' }, { fetchImpl: ok })
    h.db.raw.prepare("UPDATE sources SET enabled = 1, mode = 'api' WHERE id = 'facebook-comuna'").run()
    const first = await h.app.scheduled(h.env, NOW)
    expect(first.sync?.[0]).toMatchObject({ outcome: 'success', inserted: 2 })
    expect((await h.call('GET', '/api/public/feed')).json).toHaveLength(2)
    expect(h.db.raw.prepare("SELECT status, cursor FROM sources WHERE id = 'facebook-comuna'").get()).toMatchObject({ status: 'ok', cursor: '2026-10-28T14:10:00.000Z' })
    // Mismo contenido otra vez (p. ej. ventana solapada): no se duplica.
    const later = new Date(NOW.getTime() + 120_000)
    const second = await h.app.scheduled(h.env, later)
    expect(second.sync?.[0]).toMatchObject({ outcome: 'success', inserted: 0 })
    expect((h.db.raw.prepare('SELECT COUNT(*) n FROM posts').get() as { n: number }).n).toBe(2)
    // Token vencido (código 190): se registra, se marca el estado y se espera antes de reintentar.
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { code: 190, message: 'Session has expired' } }), { status: 401 })) as unknown as typeof fetch
    const h2 = await harness({ META_FACEBOOK_PAGE_ID: '9', META_PAGE_ACCESS_TOKEN: 'T' }, { fetchImpl: bad })
    h2.db.raw.prepare("UPDATE sources SET enabled = 1, mode = 'api' WHERE id = 'facebook-comuna'").run()
    const failed = await h2.app.scheduled(h2.env, NOW)
    expect(failed.sync?.[0].outcome).toBe('auth-error')
    expect(h2.db.raw.prepare("SELECT status, next_attempt_at FROM sources WHERE id = 'facebook-comuna'").get()).toMatchObject({ status: 'auth-error', next_attempt_at: expect.any(String) })
    expect((await h2.app.scheduled(h2.env, new Date(NOW.getTime() + 60_000))).sync?.[0].detail).toBe('en espera (retroceso)')
  })
})
