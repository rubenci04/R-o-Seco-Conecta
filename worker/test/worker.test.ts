// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { SyncError } from '../../shared/backoff'
import { mapGraphError, parseUsageHeaders, FacebookPageConnector, InstagramConnector } from '../connectors/meta'
import type { SourceConnector } from '../connectors/types'
import { SYSTEM_ACTOR } from '../env'
import { ingestPost, type SourceRow } from '../ingest'
import { syncSource, runSyncCycle, MAX_POSTS_PER_RUN } from '../sync'
import { freshDb, migrate, TestD1 } from './d1shim'
import { harness, NOW, TEXT } from './helpers'

const sourceOf = async (db: TestD1, id: string) => (await db.prepare('SELECT * FROM sources WHERE id = ?').bind(id).first<SourceRow>())!
const ingest = async (db: TestD1, sourceId: string, body: string, over: { externalId?: string; publishedAt?: string; url?: string } = {}) =>
  ingestPost(db.asD1(), { externalId: over.externalId ?? crypto.randomUUID(), body, publishedAt: over.publishedAt ?? NOW.toISOString(), url: over.url }, { source: await sourceOf(db, sourceId), origin: 'api', actor: SYSTEM_ACTOR, now: NOW })

describe('A · esquema D1 y migraciones', () => {
  it('aplica todas las migraciones y crea las tablas requeridas', () => {
    const db = new TestD1()
    expect(migrate(db)).toHaveLength(8)
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all as never as () => never)
    void tables
    const names = (db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name)
    for (const t of ['posts', 'sources', 'categories', 'alerts', 'obituaries', 'events', 'places', 'admins', 'editorial_history', 'sync_runs', 'notification_log', 'push_subscriptions', 'post_categories', 'admin_sessions', 'notification_deliveries', 'rate_limits']) {
      expect(names, t).toContain(t)
    }
  })
  it('siembra 13 categorías y fuentes oficiales deshabilitadas y sin configurar', () => {
    const db = freshDb()
    expect((db.raw.prepare('SELECT COUNT(*) n FROM categories').get() as { n: number }).n).toBe(13)
    const sources = db.raw.prepare("SELECT id, enabled, status FROM sources WHERE kind != 'manual'").all() as { id: string; enabled: number; status: string }[]
    expect(sources.map((s) => s.id).sort()).toEqual(['facebook-comuna', 'instagram-comuna'])
    expect(sources.every((s) => s.enabled === 0 && s.status === 'not-configured')).toBe(true)
  })
  it('no siembra publicaciones, administradores ni horarios', () => {
    const db = freshDb()
    for (const t of ['posts', 'admins', 'bus_services', 'alerts', 'obituaries', 'push_subscriptions']) {
      expect((db.raw.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n, t).toBe(0)
    }
  })
  it('rechaza horarios sin autorización de reutilización a nivel de base de datos', () => {
    const db = freshDb()
    db.exec("INSERT INTO bus_companies (id,name) VALUES ('c','C')")
    expect(() =>
      db.exec(`INSERT INTO bus_services (id, company_id, locality_id, direction, origin_stop_id, destination_stop_id, departure, day_types, precision, source_label, source_url, reuse_authorized, last_verified)
        VALUES ('s','c','concepcion','from-rio-seco','a','b','06:00','["weekday"]','confirmed','x','https://x.com',0,'2026-01-01')`),
    ).toThrow()
  })
  it('una publicación no puede repetir (fuente, id externo)', async () => {
    const db = freshDb()
    await ingest(db, 'manual', TEXT.torneo, { externalId: 'x' })
    const again = await ingest(db, 'manual', 'otro texto distinto totalmente diferente al anterior publicado', { externalId: 'x' })
    expect(again.outcome).toBe('duplicate')
  })
})

describe('B · ingesta, persistencia y deduplicación', () => {
  it('guarda publicación, categorías con confianza, estado de revisión e historial', async () => {
    const db = freshDb()
    const r = await ingest(db, 'facebook-comuna', TEXT.torneo)
    expect(r.outcome).toBe('inserted')
    const post = db.raw.prepare('SELECT status, review_state, classifier FROM posts').get() as Record<string, string>
    expect(post.status).toBe('published')
    expect(post.classifier).toBe('rules-v1')
    const cats = db.raw.prepare('SELECT category_id, confidence, proposed_by, confirmed FROM post_categories').all() as { category_id: string; confidence: number; confirmed: number }[]
    expect(cats.map((c) => c.category_id)).toContain('deportes')
    expect(cats.every((c) => c.confidence > 0 && c.confirmed === 0)).toBe(true)
    expect((db.raw.prepare("SELECT COUNT(*) n FROM editorial_history WHERE entity_type='post'").get() as { n: number }).n).toBe(1)
  })
  it('deduplica por id estable, URL, huella exacta y similitud (cruce Facebook/Instagram)', async () => {
    const db = freshDb()
    const first = await ingest(db, 'facebook-comuna', TEXT.agua, { externalId: 'fb1', url: 'https://www.facebook.com/p/1' })
    expect(first.outcome).toBe('inserted')
    const reasons = [
      await ingest(db, 'facebook-comuna', 'texto completamente distinto sobre otro tema de la comuna para vecinos', { externalId: 'fb1' }),
      await ingest(db, 'instagram-comuna', 'otra cosa sin relación alguna con el aviso anterior de la semana', { externalId: 'ig1', url: 'https://www.facebook.com/p/1' }),
      await ingest(db, 'instagram-comuna', TEXT.agua.toUpperCase(), { externalId: 'ig2' }),
      await ingest(db, 'instagram-comuna', `${TEXT.agua} 💧 #RioSeco`, { externalId: 'ig3' }),
    ].map((r) => (r.outcome === 'duplicate' ? r.reason : 'inserted'))
    expect(reasons).toEqual(['external-id', 'url', 'content-hash', 'near-duplicate'])
    expect((db.raw.prepare('SELECT COUNT(*) n FROM posts').get() as { n: number }).n).toBe(1)
  })
  it('baja confianza: queda publicada pero marcada para revisión', async () => {
    const db = freshDb()
    await ingest(db, 'facebook-comuna', TEXT.saludo)
    expect((db.raw.prepare('SELECT review_state FROM posts').get() as { review_state: string }).review_state).toBe('needs_review')
  })
  it('una fuente no confiable deja la publicación oculta (pendiente)', async () => {
    const db = freshDb()
    db.exec("UPDATE sources SET trusted = 0 WHERE id = 'facebook-comuna'")
    await ingest(db, 'facebook-comuna', TEXT.torneo)
    expect((db.raw.prepare('SELECT status FROM posts').get() as { status: string }).status).toBe('pending')
  })
})

describe('C · permisos y autenticación en el servidor', () => {
  it('sin sesión: 401 en todo /api/admin', async () => {
    const h = await harness()
    for (const [m, p] of [['GET', '/api/admin/posts'], ['POST', '/api/admin/obituaries/1/approve'], ['GET', '/api/admin/users']] as const) {
      expect((await h.call(m, p)).status, p).toBe(401)
    }
  })
  it('credenciales inválidas → 401 sin revelar si el usuario existe; bloqueo tras 5 fallos', async () => {
    const h = await harness()
    const bad = await h.call('POST', '/api/admin/login', { body: { email: 'nadie@test.local', password: 'x'.repeat(14) } })
    expect(bad.status).toBe(401)
    for (let i = 0; i < 5; i++) await h.call('POST', '/api/admin/login', { body: { email: 'editor@test.local', password: 'incorrecta-incorrecta' } })
    const locked = await h.call('POST', '/api/admin/login', { body: { email: 'editor@test.local', password: 'contraseña-de-prueba-1' } })
    expect(locked.status).toBe(429)
  })
  it('la cookie de sesión es HttpOnly, Secure y SameSite=Strict, y el token no se guarda en claro', async () => {
    const h = await harness()
    const r = await h.call('POST', '/api/admin/login', { body: { email: 'admin@test.local', password: 'contraseña-de-prueba-1' } })
    const cookie = r.headers.get('set-cookie')!
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/Secure/)
    expect(cookie).toMatch(/SameSite=Strict/)
    const token = cookie.split(';')[0].split('=')[1]
    const stored = h.db.raw.prepare('SELECT token_hash FROM admin_sessions').get() as { token_hash: string }
    expect(stored.token_hash).not.toContain(token)
    expect((h.db.raw.prepare('SELECT password_hash FROM admins LIMIT 1').get() as { password_hash: string }).password_hash).toMatch(/^pbkdf2\$/)
  })
  it('CSRF: las modificaciones sin cabecera de protección se rechazan', async () => {
    const h = await harness()
    const cookie = await h.loginAs('admin')
    expect((await h.call('POST', '/api/admin/posts', { cookie, csrf: false, body: { body: TEXT.torneo } })).status).toBe(403)
  })
  it('viewer solo lee: no puede crear ni aprobar ni gestionar', async () => {
    const h = await harness()
    const cookie = await h.loginAs('viewer')
    expect((await h.call('GET', '/api/admin/posts', { cookie })).status).toBe(200)
    expect((await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.torneo } })).status).toBe(403)
    expect((await h.call('POST', '/api/admin/obituaries/1/approve', { cookie })).status).toBe(403)
    expect((await h.call('GET', '/api/admin/users', { cookie })).status).toBe(403)
  })
  it('editor modera contenido pero no gestiona usuarios ni conectores', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    expect((await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.torneo } })).status).toBe(201)
    expect((await h.call('GET', '/api/admin/users', { cookie })).status).toBe(403)
    expect((await h.call('PATCH', '/api/admin/sources/facebook-comuna', { cookie, body: { enabled: true } })).status).toBe(403)
    expect((await h.call('POST', '/api/admin/sources/facebook-comuna/sync-now', { cookie })).status).toBe(403)
  })
  it('desactivar un usuario invalida sus sesiones; no se puede dejar el sistema sin administradores', async () => {
    const h = await harness()
    const adminCookie = await h.loginAs('admin')
    const editorCookie = await h.loginAs('editor')
    const editorId = (h.db.raw.prepare("SELECT id FROM admins WHERE role='editor'").get() as { id: number }).id
    await h.call('PATCH', `/api/admin/users/${editorId}`, { cookie: adminCookie, body: { active: false } })
    expect((await h.call('GET', '/api/admin/me', { cookie: editorCookie })).json).toEqual({ admin: null })
    const adminId = (h.db.raw.prepare("SELECT id FROM admins WHERE role='admin'").get() as { id: number }).id
    expect((await h.call('PATCH', `/api/admin/users/${adminId}`, { cookie: adminCookie, body: { role: 'viewer' } })).status).toBe(409)
  })
  it('los secretos no se pueden guardar en la configuración de una fuente', async () => {
    const h = await harness()
    const cookie = await h.loginAs('admin')
    const r = await h.call('PATCH', '/api/admin/sources/facebook-comuna', { cookie, body: { config: { pageId: '123', accessToken: 'abc' } } })
    expect(r.status).toBe(400)
    expect((await h.call('PATCH', '/api/admin/sources/facebook-comuna', { cookie, body: { config: { pageId: '123' } } })).status).toBe(200)
  })
  it('rechaza contraseñas cortas al crear usuarios', async () => {
    const h = await harness()
    const cookie = await h.loginAs('admin')
    expect((await h.call('POST', '/api/admin/users', { cookie, body: { email: 'n@test.local', role: 'editor', password: 'corta' } })).status).toBe(400)
  })
})

describe('D · conectores y sincronización', () => {
  const fbPost = (id: string, msg: string, time: string) => ({ id, message: msg, created_time: time, permalink_url: `https://www.facebook.com/p/${id}` })
  const jsonRes = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init })
  const enableFb = async (db: TestD1) => db.exec("UPDATE sources SET enabled = 1, mode = 'api' WHERE id = 'facebook-comuna'")

  it('sin credenciales: no sincroniza, informa qué falta y NO finge éxito', async () => {
    const h = await harness()
    await enableFb(h.db)
    const fetchImpl = vi.fn()
    const report = await syncSource(h.env, await sourceOf(h.db, 'facebook-comuna'), NOW, { fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(report.outcome).toBe('skipped')
    const s = await sourceOf(h.db, 'facebook-comuna')
    expect(s.status).toBe('not-configured')
    expect(s.last_success_at).toBeNull()
    expect(s.last_error).toContain('META_PAGE_ACCESS_TOKEN')
  })
  it('Facebook: consulta incremental, ingesta, cursor y registro de última sincronización exitosa', async () => {
    const h = await harness({ META_FACEBOOK_PAGE_ID: '111', META_PAGE_ACCESS_TOKEN: 'tok' })
    await enableFb(h.db)
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url))
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok') // token por cabecera, no en la URL
      return jsonRes({ data: [fbPost('111_1', TEXT.torneo, '2026-10-28T14:30:00+0000'), fbPost('111_2', TEXT.agua, '2026-10-28T14:45:00+0000')] })
    })
    const report = await syncSource(h.env, await sourceOf(h.db, 'facebook-comuna'), NOW, { fetchImpl: fetchImpl as never })
    expect(report).toMatchObject({ outcome: 'success', fetched: 2, inserted: 2, duplicates: 0 })
    const s = await sourceOf(h.db, 'facebook-comuna')
    expect(s.status).toBe('ok')
    expect(s.last_success_at).toBe(NOW.toISOString())
    expect(s.cursor).toBe('2026-10-28T14:45:00.000Z')
    expect(urls[0]).not.toContain('tok')
    expect(urls[0]).toContain('since=') // primera corrida: solo los últimos 7 días

    // Segundo ciclo: usa `since` y no duplica.
    const second = await syncSource(h.env, await sourceOf(h.db, 'facebook-comuna'), new Date(NOW.getTime() + 60_000), {
      fetchImpl: (async (url: string | URL | Request) => {
        urls.push(String(url))
        return jsonRes({ data: [fbPost('111_2', TEXT.agua, '2026-10-28T14:45:00+0000')] })
      }) as never,
    })
    expect(urls[1]).toContain('since=')
    expect(second).toMatchObject({ outcome: 'success', inserted: 0, duplicates: 1 })
    expect((h.db.raw.prepare('SELECT COUNT(*) n FROM posts').get() as { n: number }).n).toBe(2)
  })
  it('limita las publicaciones procesadas por ciclo y avanza el cursor solo hasta donde procesó', async () => {
    const h = await harness({ META_FACEBOOK_PAGE_ID: '1', META_PAGE_ACCESS_TOKEN: 't' })
    await enableFb(h.db)
    const topics = ['Torneo de fútbol en el club', 'Taller de música y danza en la biblioteca', 'Campaña de vacunación en el centro de salud', 'Inscripciones abiertas en la escuela', 'Festival folclórico en la plaza con peña', 'Corte de luz programado en el centro por trabajos', 'Ruta cortada por trabajos de vialidad']
    const posts = topics.map((t, i) => fbPost(`p${i}`, `${t} número ${i} con detalles para los vecinos de la zona`, `2026-10-28T1${i}:00:00+0000`))
    const r = await syncSource(h.env, await sourceOf(h.db, 'facebook-comuna'), NOW, { fetchImpl: (async () => jsonRes({ data: posts })) as never })
    expect(r.inserted).toBe(MAX_POSTS_PER_RUN)
    expect((await sourceOf(h.db, 'facebook-comuna')).cursor).toBe('2026-10-28T14:00:00.000Z')
  })
  it('error de límite de API: retroceso mínimo de 15 min, estado visible y registro del error', async () => {
    const h = await harness({ META_FACEBOOK_PAGE_ID: '1', META_PAGE_ACCESS_TOKEN: 't' })
    await enableFb(h.db)
    const r = await syncSource(h.env, await sourceOf(h.db, 'facebook-comuna'), NOW, { fetchImpl: (async () => jsonRes({ error: { code: 4, message: 'Application request limit reached' } }, { status: 400 })) as never })
    expect(r.outcome).toBe('rate-limited')
    const s = await sourceOf(h.db, 'facebook-comuna')
    expect(s.status).toBe('rate-limited')
    expect(new Date(s.next_attempt_at!).getTime() - NOW.getTime()).toBeGreaterThanOrEqual(15 * 60_000)
    expect(s.consecutive_failures).toBe(1)
    const run = h.db.raw.prepare('SELECT outcome, error FROM sync_runs').get() as { outcome: string; error: string }
    expect(run.outcome).toBe('rate-limited')
    expect(run.error).toContain('Límite')
  })
  it('el ciclo respeta el retroceso: no consulta mientras la fuente espera', async () => {
    const h = await harness({ META_FACEBOOK_PAGE_ID: '1', META_PAGE_ACCESS_TOKEN: 't' })
    await enableFb(h.db)
    const fail = vi.fn(async () => jsonRes({ error: { code: 1, message: 'boom' } }, { status: 500 }))
    await runSyncCycle(h.env, NOW, { fetchImpl: fail as never, random: () => 0.5 })
    expect(fail).toHaveBeenCalledTimes(1)
    await runSyncCycle(h.env, new Date(NOW.getTime() + 30_000), { fetchImpl: fail as never })
    expect(fail).toHaveBeenCalledTimes(1) // sigue en espera
    await runSyncCycle(h.env, new Date(NOW.getTime() + 5 * 60_000), { fetchImpl: fail as never, random: () => 0.5 })
    expect(fail).toHaveBeenCalledTimes(2)
    expect((await sourceOf(h.db, 'facebook-comuna')).consecutive_failures).toBe(2)
  })
  it('token vencido y permisos faltantes se distinguen y no se reintentan cada minuto', async () => {
    const h = await harness({ META_FACEBOOK_PAGE_ID: '1', META_PAGE_ACCESS_TOKEN: 't' })
    await enableFb(h.db)
    const a = await syncSource(h.env, await sourceOf(h.db, 'facebook-comuna'), NOW, { fetchImpl: (async () => jsonRes({ error: { code: 190, message: 'expired' } }, { status: 401 })) as never })
    expect(a.outcome).toBe('auth-error')
    expect(new Date((await sourceOf(h.db, 'facebook-comuna')).next_attempt_at!).getTime() - NOW.getTime()).toBeGreaterThanOrEqual(6 * 3600_000)
    const b = await syncSource(h.env, { ...(await sourceOf(h.db, 'facebook-comuna')), next_attempt_at: null }, NOW, { fetchImpl: (async () => jsonRes({ error: { code: 10, message: 'Requires pages_read_engagement' } }, { status: 403 })) as never })
    expect(b.outcome).toBe('permission-missing')
  })
  it('mapGraphError y cabeceras de uso', () => {
    expect(mapGraphError(400, { error: { code: 613 } }, new Headers()).kind).toBe('rate-limited')
    expect(mapGraphError(400, { error: { code: 190 } }, new Headers()).kind).toBe('auth-error')
    expect(mapGraphError(400, { error: { code: 200 } }, new Headers()).kind).toBe('permission-missing')
    expect(mapGraphError(500, null, new Headers()).kind).toBe('error')
    expect(mapGraphError(429, null, new Headers({ 'retry-after': '1200' })).retryAfterSeconds).toBe(1200)
    expect(parseUsageHeaders(new Headers({ 'x-app-usage': '{"call_count":92,"total_time":10}' })).maxPercent).toBe(92)
    expect(parseUsageHeaders(new Headers({ 'x-business-use-case-usage': '{"1":[{"call_count":5,"estimated_time_to_regain_access":10}]}' })).regainSeconds).toBe(600)
  })
  it('cuota casi agotada: se espacia la próxima consulta', async () => {
    const h = await harness({ META_FACEBOOK_PAGE_ID: '1', META_PAGE_ACCESS_TOKEN: 't' })
    await enableFb(h.db)
    await syncSource(h.env, await sourceOf(h.db, 'facebook-comuna'), NOW, { fetchImpl: (async () => jsonRes({ data: [] }, { headers: { 'x-app-usage': '{"call_count":95}' } })) as never })
    expect((await sourceOf(h.db, 'facebook-comuna')).next_attempt_at).not.toBeNull()
  })
  it('Instagram: modo propio y Business Discovery (filtrado por fecha), con readiness', async () => {
    const ig = new InstagramConnector()
    const src = (cfg: object) => ({ config_json: JSON.stringify(cfg) }) as SourceRow
    expect(ig.readiness({} as never, src({ mode: 'business-discovery' })).missing).toEqual(expect.arrayContaining(['META_INSTAGRAM_ACCESS_TOKEN (secreto)', 'META_INSTAGRAM_TARGET_USERNAME (o config.targetUsername)']))
    const env = { META_INSTAGRAM_USER_ID: '9', META_INSTAGRAM_ACCESS_TOKEN: 't' } as never
    let calledUrl = ''
    const bd = await ig.fetchNew({
      env, limit: 25, since: '2026-10-28T10:00:00Z', source: src({ mode: 'business-discovery', targetUsername: 'comunaderioseco' }),
      fetchImpl: (async (u: string) => { calledUrl = u; return jsonRes({ business_discovery: { media: { data: [{ id: 'a', caption: 'viejo', timestamp: '2026-10-28T09:00:00+0000', permalink: 'https://www.instagram.com/p/a/' }, { id: 'b', caption: 'nuevo', timestamp: '2026-10-28T12:00:00+0000', permalink: 'https://www.instagram.com/p/b/' }] } } }) }) as never,
    })
    expect(decodeURIComponent(calledUrl)).toContain('business_discovery.username(comunaderioseco)')
    expect(bd.posts.map((p) => p.externalId)).toEqual(['b'])
    const own = await ig.fetchNew({ env, limit: 25, since: null, source: src({}), fetchImpl: (async () => jsonRes({ data: [{ id: 'c', caption: 'hola', timestamp: '2026-10-28T12:00:00+0000' }, { id: 'd', timestamp: '2026-10-28T12:00:00+0000' }] })) as never })
    expect(own.posts.map((p) => p.externalId)).toEqual(['c', 'd']) // sin texto igual se conserva (body vacío)
    expect(new FacebookPageConnector().readiness({} as never, { config_json: '{}' } as SourceRow).ready).toBe(false)
  })
  it('un conector que falla de forma inesperada queda registrado como error genérico', async () => {
    const h = await harness()
    h.db.exec("UPDATE sources SET enabled = 1, mode = 'api' WHERE id = 'instagram-comuna'")
    const broken: SourceConnector = { kind: 'instagram', readiness: () => ({ ready: true, missing: [] }), fetchNew: async () => { throw new Error('red caída') } }
    const r = await syncSource(h.env, await sourceOf(h.db, 'instagram-comuna'), NOW, { connectors: { instagram: broken } })
    expect(r).toMatchObject({ outcome: 'error' })
    expect((await sourceOf(h.db, 'instagram-comuna')).last_error).toContain('red caída')
    expect(new SyncError('error', 'x').kind).toBe('error')
  })
})

describe('E · importación asistida y publicación manual (sin credenciales)', () => {
  it('crea una publicación manual, clasificada y visible en el feed general y en su categoría', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    const created = await h.call('POST', '/api/admin/posts', { cookie, body: { title: 'Torneo infantil', body: TEXT.torneo } })
    expect(created.status).toBe(201)
    const feed = await h.call('GET', '/api/public/feed')
    expect(feed.json).toHaveLength(1)
    expect(feed.json[0]).toMatchObject({ title: 'Torneo infantil', verified: true })
    expect(feed.json[0].categories).toContain('deportes')
    expect((await h.call('GET', '/api/public/feed?categoria=deportes')).json).toHaveLength(1)
    expect((await h.call('GET', '/api/public/feed?categoria=salud')).json).toHaveLength(0)
    expect((await h.call('GET', '/api/public/feed?categoria=inventada')).status).toBe(400)
  })
  it('el editor puede corregir categorías: quedan confirmadas', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    const id = (await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.saludo } })).json.postId
    expect((await h.call('PATCH', `/api/admin/posts/${id}`, { cookie, body: { categories: ['institucional', 'cultura'] } })).status).toBe(200)
    const cats = h.db.raw.prepare('SELECT category_id, confirmed, proposed_by FROM post_categories WHERE post_id = ? ORDER BY category_id').all(id) as { category_id: string; confirmed: number; proposed_by: string }[]
    expect(cats).toEqual([{ category_id: 'cultura', confirmed: 1, proposed_by: 'editor' }, { category_id: 'institucional', confirmed: 1, proposed_by: 'editor' }])
    expect((h.db.raw.prepare('SELECT review_state FROM posts WHERE id = ?').get(id) as { review_state: string }).review_state).toBe('approved')
    expect((await h.call('PATCH', `/api/admin/posts/${id}`, { cookie, body: { categories: ['no-existe'] } })).status).toBe(400)
  })
  it('importación por enlace: valida host, deduplica por enlace y conserva la fuente', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    const ok = await h.call('POST', '/api/admin/posts/import-link', { cookie, body: { url: 'https://www.instagram.com/p/Cabc123/?igsh=x', text: TEXT.torneo } })
    expect(ok.status).toBe(201)
    expect((await h.call('POST', '/api/admin/posts/import-link', { cookie, body: { url: 'https://www.instagram.com/p/Cabc123/', text: 'distinto texto sobre algo diferente en la plaza del pueblo hoy' } })).status).toBe(409)
    expect((await h.call('POST', '/api/admin/posts/import-link', { cookie, body: { url: 'https://example.com/p/abc', text: 'x' } })).status).toBe(400)
    expect((await h.call('POST', '/api/admin/posts/import-link', { cookie, body: { url: 'https://www.instagram.com/p/Zzz999/' } })).status).toBe(400)
    const feed = (await h.call('GET', '/api/public/feed')).json
    expect(feed[0].source.url).toBe('https://www.instagram.com/p/Cabc123/')
    expect(feed[0].source.label).toContain('Instagram')
  })
  it('un duplicado manual se rechaza con 409', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.torneo } })
    expect((await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.torneo } })).status).toBe(409)
  })
  it('rectificar y eliminar: la rectificación se muestra y la eliminación retira del feed', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    const id = (await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.torneo } })).json.postId
    await h.call('POST', `/api/admin/posts/${id}/rectify`, { cookie, body: { note: 'El torneo es el domingo, no el sábado.' } })
    expect((await h.call('GET', '/api/public/feed')).json[0].rectification).toContain('domingo')
    expect((await h.call('DELETE', `/api/admin/posts/${id}`, { cookie })).status).toBe(200)
    expect((await h.call('GET', '/api/public/feed')).json).toHaveLength(0)
    expect((h.db.raw.prepare("SELECT COUNT(*) n FROM editorial_history WHERE entity_type='post' AND action IN ('rectified','deleted')").get() as { n: number }).n).toBe(2)
  })
})

describe('F · obituarios', () => {
  it('un posible obituario NO se publica solo: queda en cola y fuera del feed y de Obituarios', async () => {
    const h = await harness()
    const r = await ingest(h.db, 'facebook-comuna', TEXT.obit)
    expect(r.outcome === 'inserted' && r.status).toBe('pending')
    expect((await h.call('GET', '/api/public/feed')).json).toHaveLength(0)
    expect((await h.call('GET', '/api/public/obituaries')).json).toHaveLength(0)
    const o = h.db.raw.prepare('SELECT name, state, death_date FROM obituaries').get() as { name: string; state: string; death_date: string | null }
    expect(o).toEqual({ name: 'Juan Carlos Pérez', state: 'pending', death_date: null })
  })
  it('no se puede aprobar sin confirmar nombre y fecha; al aprobar aparece en Obituarios y en el feed con enlace a la fuente', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    await ingest(h.db, 'facebook-comuna', TEXT.obit, { url: 'https://www.facebook.com/p/obit1' })
    expect((await h.call('POST', '/api/admin/obituaries/1/approve', { cookie })).status).toBe(422)
    await h.call('PATCH', '/api/admin/obituaries/1', { cookie, body: { name: 'Juan Carlos Pérez', deathDate: '2026-10-27', serviceInfo: 'Sepelio 16 hs' } })
    const ok = await h.call('POST', '/api/admin/obituaries/1/approve', { cookie })
    expect(ok.status).toBe(200)
    const pub = (await h.call('GET', '/api/public/obituaries')).json
    expect(pub).toHaveLength(1)
    expect(pub[0]).toMatchObject({ name: 'Juan Carlos Pérez', date: '2026-10-27', source: { url: 'https://www.facebook.com/p/obit1' } })
    const feed = (await h.call('GET', '/api/public/feed')).json
    expect(feed).toHaveLength(1)
    expect(feed[0].categories).toContain('obituarios')
    expect(feed[0].source.url).toBe('https://www.facebook.com/p/obit1')
    expect((await h.call('POST', '/api/admin/obituaries/1/approve', { cookie })).status).toBe(409)
  })
  it('viewer no puede aprobar; rechazar mantiene la publicación oculta', async () => {
    const h = await harness()
    await ingest(h.db, 'facebook-comuna', TEXT.obit)
    expect((await h.call('POST', '/api/admin/obituaries/1/approve', { cookie: await h.loginAs('viewer') })).status).toBe(403)
    const cookie = await h.loginAs('editor')
    await h.call('POST', '/api/admin/obituaries/1/reject', { cookie })
    expect((await h.call('GET', '/api/public/feed')).json).toHaveLength(0)
    expect((await h.call('GET', '/api/public/obituaries')).json).toHaveLength(0)
  })
  it('rectificación y eliminación posteriores a la aprobación', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    await ingest(h.db, 'facebook-comuna', TEXT.obit)
    await h.call('PATCH', '/api/admin/obituaries/1', { cookie, body: { name: 'Juan Carlos Pérez', deathDate: '2026-10-27' } })
    await h.call('POST', '/api/admin/obituaries/1/approve', { cookie })
    await h.call('POST', '/api/admin/obituaries/1/rectify', { cookie, body: { note: 'Se corrige el horario del sepelio: 17 hs.' } })
    expect((await h.call('GET', '/api/public/obituaries')).json[0].rectification).toContain('17 hs')
    expect((await h.call('DELETE', '/api/admin/obituaries/1', { cookie })).status).toBe(200)
    expect((await h.call('GET', '/api/public/obituaries')).json).toHaveLength(0)
    expect((await h.call('GET', '/api/public/feed')).json).toHaveLength(0)
  })
  it('un posible obituario aprobado no pasa por el endpoint genérico de publicación', async () => {
    const h = await harness()
    await ingest(h.db, 'facebook-comuna', TEXT.obit)
    expect((await h.call('POST', '/api/admin/posts/1/publish', { cookie: await h.loginAs('editor') })).status).toBe(409)
  })
})

describe('G · alertas', () => {
  it('se proponen sin publicarse: no aparecen hasta que una persona las confirma', async () => {
    const h = await harness()
    await ingest(h.db, 'facebook-comuna', TEXT.agua)
    const a = h.db.raw.prepare('SELECT kind, severity, confirmation, expires_at FROM alerts').get() as Record<string, string>
    expect(a).toMatchObject({ kind: 'agua', severity: 'info', confirmation: 'proposed' })
    expect(a.expires_at).toBeTruthy()
    expect((await h.call('GET', '/api/public/alerts')).json).toHaveLength(0)
    await h.call('POST', '/api/admin/alerts/1/confirm', { cookie: await h.loginAs('editor') })
    const pub = (await h.call('GET', '/api/public/alerts')).json
    expect(pub).toHaveLength(1)
    expect(pub[0]).toMatchObject({ kind: 'agua', severity: 'info' })
  })
  it('las alertas vencidas dejan de mostrarse', async () => {
    const h = await harness()
    await h.call('POST', '/api/admin/alerts', { cookie: await h.loginAs('editor'), body: { kind: 'agua', title: 'Corte', body: 'Corte de agua', startsAt: '2026-10-27T10:00:00Z', expiresAt: '2026-10-27T20:00:00Z' } })
    await h.call('POST', '/api/admin/alerts/1/confirm', { cookie: await h.loginAs('editor') })
    expect((await h.call('GET', '/api/public/alerts')).json).toHaveLength(0)
  })
  it('una alerta urgente se detecta con contexto + marcador y exige permiso específico para confirmarse', async () => {
    const h = await harness()
    await ingest(h.db, 'facebook-comuna', TEXT.alertaUrgente)
    expect(h.db.raw.prepare('SELECT severity, priority FROM alerts').get()).toMatchObject({ severity: 'urgente', priority: 3 })
    expect((await h.call('POST', '/api/admin/alerts/1/confirm', { cookie: await h.loginAs('viewer') })).status).toBe(403)
    expect((await h.call('POST', '/api/admin/alerts/1/confirm', { cookie: await h.loginAs('editor') })).status).toBe(200)
  })
  it('una palabra aislada no genera alerta', async () => {
    const h = await harness()
    await ingest(h.db, 'facebook-comuna', 'Es urgente que pasen por la oficina a retirar los boletos de la feria de artesanos del domingo.')
    expect((h.db.raw.prepare('SELECT COUNT(*) n FROM alerts').get() as { n: number }).n).toBe(0)
  })
})

describe('I · administración de contenido, horarios y conectores', () => {
  it('CRUD de radios, lugares y eventos con historial; solo contenido público activo', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    expect((await h.call('POST', '/api/admin/radios', { cookie, body: { name: 'Radio Prueba', frequency: '99.9 FM', site_url: 'https://radio.example.com', active: true } })).status).toBe(201)
    expect((await h.call('GET', '/api/public/radios')).json.map((r: { id: string }) => r.id)).toContain('radio-prueba')
    expect((await h.call('POST', '/api/admin/radios', { cookie, body: { name: 'X', frequency: '1', site_url: 'javascript:alert(1)' } })).status).toBe(400)
    const place = await h.call('POST', '/api/admin/places', { cookie, body: { kind: 'institucion', name: 'Centro de salud', active: true } })
    expect(place.status).toBe(201)
    await h.call('POST', '/api/admin/events', { cookie, body: { title: 'Fiesta', starts_at: '2026-11-01T20:00:00-03:00', place_ref: 'comuna-rio-seco', place_text: 'Centro de salud', category: 'festividad', source_label: 'Comuna', source_url: 'https://www.facebook.com/p/x', published: true } })
    const ev = (await h.call('GET', '/api/public/events')).json
    expect(ev[0]).toMatchObject({ title: 'Fiesta', place: 'Centro de salud', category: 'festividad' })
    expect((await h.call('DELETE', `/api/admin/events/${ev[0].id}`, { cookie })).status).toBe(200)
    expect((h.db.raw.prepare("SELECT COUNT(*) n FROM editorial_history WHERE entity_type IN ('events','radios','places')").get() as { n: number }).n).toBeGreaterThanOrEqual(4)
  })
  it('horarios de colectivos: exige fuente autorizada y formato válido; luego alimentan la API pública', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    await h.call('POST', '/api/admin/bus-companies', { cookie, body: { name: 'Empresa Prueba' } })
    await h.call('POST', '/api/admin/bus-localities', { cookie, body: { id: 'concepcion', name: 'Concepción', status: 'sin-datos' } })
    await h.call('POST', '/api/admin/bus-stops', { cookie, body: { id: 'a', name: 'Plaza', locality_id: 'rio-seco' } })
    await h.call('POST', '/api/admin/bus-stops', { cookie, body: { id: 'b', name: 'Terminal', locality_id: 'concepcion' } })
    const svc = { id: 's1', company_id: 'empresa-prueba', locality_id: 'concepcion', direction: 'from-rio-seco', origin_stop_id: 'a', destination_stop_id: 'b', departure: '06:30', arrival: '07:15', day_types: ['weekday'], precision: 'confirmed', source_label: 'Fuente de prueba', source_url: 'https://example.com/h', reuse_authorized: true, last_verified: '2026-10-01' }
    expect((await h.call('POST', '/api/admin/bus-services', { cookie, body: { ...svc, reuse_authorized: false } })).status).toBe(400)
    expect((await h.call('POST', '/api/admin/bus-services', { cookie, body: { ...svc, departure: '6:3' } })).status).toBe(400)
    expect((await h.call('POST', '/api/admin/bus-services', { cookie, body: { ...svc, day_types: ['lunes'] } })).status).toBe(400)
    expect((await h.call('POST', '/api/admin/bus-services', { cookie, body: svc })).status).toBe(201)
    expect((await h.call('POST', '/api/admin/bus-services', { cookie, body: svc })).status).toBe(409)
    const t = (await h.call('GET', '/api/public/transport')).json
    expect(t.services[0]).toMatchObject({ departure: '06:30', dayTypes: ['weekday'], source: { reuseAuthorized: true } })
    expect(t.localities.map((l: { id: string }) => l.id)).toContain('concepcion')
  })
  it('estado de conectores: indica faltantes y que no hay sincronización automática activa', async () => {
    const h = await harness()
    const cookie = await h.loginAs('viewer')
    const src = (await h.call('GET', '/api/admin/sources', { cookie })).json as { id: string; automatic: boolean; readiness: { ready: boolean; missing: string[] } }[]
    const fb = src.find((s) => s.id === 'facebook-comuna')!
    expect(fb.automatic).toBe(false)
    expect(fb.readiness.missing.length).toBeGreaterThan(0)
    expect(src.find((s) => s.id === 'manual')!.readiness.ready).toBe(true)
  })
  it('sync manual con credenciales de prueba inyectadas registra la corrida; el administrador ve los errores', async () => {
    const h = await harness({ META_FACEBOOK_PAGE_ID: '1', META_PAGE_ACCESS_TOKEN: 't' }, { fetchImpl: (async () => new Response(JSON.stringify({ error: { code: 190, message: 'expired' } }), { status: 401 })) as never })
    const cookie = await h.loginAs('admin')
    const res = await h.call('POST', '/api/admin/sources/facebook-comuna/sync-now', { cookie })
    expect(res.json.outcome).toBe('auth-error')
    const runs = (await h.call('GET', '/api/admin/sync-runs?errores=1', { cookie })).json
    expect(runs[0]).toMatchObject({ source_id: 'facebook-comuna', outcome: 'auth-error' })
  })
  it('una fuente manual no se sincroniza', async () => {
    const h = await harness()
    expect((await h.call('POST', '/api/admin/sources/manual/sync-now', { cookie: await h.loginAs('admin') })).status).toBe(400)
  })
  it('rutas inexistentes y métodos incorrectos devuelven 404/405 en JSON', async () => {
    const h = await harness()
    expect((await h.call('GET', '/api/public/nada')).status).toBe(404)
    expect((await h.call('PUT', '/api/public/feed')).status).toBe(405)
  })
  it('el cron sin credenciales no hace nada y no falla', async () => {
    const h = await harness()
    const r = await h.app.scheduled(h.env, NOW)
    expect(r.sync).toEqual([])
    expect(r.push?.processed).toBe(false)
  })
})
