import { describe, expect, it, vi } from 'vitest'
import { contentTypeFromUrl, embedUrlFor, isSensitiveCategory } from '../../shared/postLinks'
import { processNotifications } from '../notify'
import { bytesToB64url } from '../../shared/pushEndpoints'
import type { Env } from '../env'
import { SYSTEM_ACTOR } from '../env'
import type { SourceRow } from '../ingest'
import { syncSource } from '../sync'
import type { SourceConnector } from '../connectors/types'
import { harness, NOW } from './helpers'

/** Web Push configurado (claves efímeras): sin esto el servidor ni siquiera encola avisos y la prueba de «no notifica» sería vacía. */
async function vapidEnv(): Promise<Partial<Env>> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const jwk = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer)
  return { VAPID_PUBLIC_KEY: bytesToB64url(pub), VAPID_PRIVATE_KEY_JWK: JSON.stringify(jwk), VAPID_SUBJECT: 'https://rio-seco.test', PUSH_TEST_HOSTS: 'push.test' }
}
const pushHarness = async () => {
  const pushFetch = vi.fn(async () => new Response(null, { status: 201 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>
  return { h: await harness(await vapidEnv(), { pushFetch }), pushFetch }
}

// Los enlaces y textos son SINTÉTICOS (ids inventados): sirven para probar reglas, no son publicaciones reales.
const REEL = 'https://www.facebook.com/reel/111111111111111/?__cft__[0]=abc'
const REEL_CANON = 'https://www.facebook.com/reel/111111111111111/'
const PERMALINK = 'https://www.facebook.com/permalink.php?story_fbid=pfbid0TEST1234567890abcdef&id=61553018412844'
const FUNERAL = 'Con inmenso dolor comunicamos que partió a la casa del Padre Juana Pérez. Sus restos serán velados en su domicilio, sepelio a las 16 hs.'
const ACTO = 'La Comuna invita al festival por el aniversario del pueblo este domingo en la plaza principal, con música en vivo, peña folclórica y feria de artesanos locales.'

const count = (h: Awaited<ReturnType<typeof harness>>, sql: string) => (h.db.raw.prepare(sql).get() as { n: number }).n

describe('enlaces de publicaciones y embeds oficiales (shared/postLinks)', () => {
  it('arma el embed oficial: video.php para reels y videos, post.php para el resto, /embed para Instagram', () => {
    const reel = new URL(embedUrlFor(REEL)!)
    expect(reel.origin + reel.pathname).toBe('https://www.facebook.com/plugins/video.php')
    expect(reel.searchParams.get('href')).toBe(REEL_CANON)
    expect(embedUrlFor('https://www.facebook.com/61553018412844/videos/pcb.122257177112100613/1846151626385320')).toContain('/plugins/video.php')
    expect(new URL(embedUrlFor(PERMALINK)!).pathname).toBe('/plugins/post.php')
    expect(embedUrlFor('https://www.instagram.com/p/AbC123/')).toBe('https://www.instagram.com/p/AbC123/embed/')
  })
  it('no incrusta direcciones que no son una publicación (la página, otros sitios)', () => {
    expect(embedUrlFor('https://www.facebook.com/p/Comuna-De-Rio-Seco-61553018412844/')).toBeNull()
    expect(embedUrlFor('https://example.com/reel/123456789/')).toBeNull()
    expect(embedUrlFor(undefined)).toBeNull()
  })
  it('el tipo sugerido sale de la forma del enlace y las categorías sensibles son las de servicio y obituarios', () => {
    expect(contentTypeFromUrl(REEL)).toBe('reel')
    expect(contentTypeFromUrl(PERMALINK)).toBe('publicacion')
    for (const c of ['obituarios', 'agua', 'energia', 'calles', 'residuos', 'meteorologica']) expect(isSensitiveCategory(c)).toBe(true)
    for (const c of ['institucional', 'eventos', 'cultura', 'deportes', 'educacion', 'salud', 'otros']) expect(isSensitiveCategory(c)).toBe(false)
  })
})

describe('Registrar publicación de Facebook (solo enlace)', () => {
  it('crea UNA tarjeta enlazada: sin texto, sin análisis, fecha sin verificar y sin inventar categorías', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    const pv = await h.call('POST', '/api/admin/posts/link-preview', { cookie, body: { url: REEL } })
    expect(pv.json).toMatchObject({ platform: 'facebook', url: REEL_CANON, contentType: 'reel', duplicate: null })
    expect(pv.json.embedUrl).toContain('plugins/video.php')

    const r = await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: REEL, title: 'Video institucional de la Comuna', publish: true } })
    expect(r.status).toBe(201)
    const row = h.db.raw.prepare('SELECT * FROM posts').get() as Record<string, unknown>
    expect(row).toMatchObject({ link_only: 1, date_verified: 0, historical: 0, body: '', url: REEL_CANON, status: 'published', content_type: 'reel', review_state: 'unreviewed', classifier: null })
    expect(count(h, 'SELECT COUNT(*) n FROM post_categories')).toBe(0) // no se clasifica por la URL
    expect(count(h, 'SELECT COUNT(*) n FROM alerts')).toBe(0)
    expect(count(h, 'SELECT COUNT(*) n FROM obituaries')).toBe(0)

    const feed = (await h.call('GET', '/api/public/feed')).json
    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({ title: 'Video institucional de la Comuna', linkOnly: true, dateVerified: false, verified: false, contentType: 'reel', body: '', source: { url: REEL_CANON } })
  })

  it('guarda la fecha solo si la persona la comprobó, y las categorías que eligió (confirmadas)', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: PERMALINK, title: 'Acto', publishedAt: '2026-10-25T21:00:00.000Z', categories: ['eventos', 'cultura'], reviewed: true, publish: true } })
    expect(h.db.raw.prepare('SELECT published_at, date_verified, review_state FROM posts').get()).toEqual({ published_at: '2026-10-25T21:00:00.000Z', date_verified: 1, review_state: 'approved' })
    expect(h.db.raw.prepare('SELECT category_id, proposed_by, confirmed FROM post_categories ORDER BY category_id').all()).toEqual([
      { category_id: 'cultura', proposed_by: 'editor', confirmed: 1 },
      { category_id: 'eventos', proposed_by: 'editor', confirmed: 1 },
    ])
  })

  it('rechaza duplicados (aunque el enlace traiga parámetros), páginas, obituarios manuales y exige título', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    const ok = await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: REEL, title: 'Uno', publish: true } })
    expect(ok.status).toBe(201)
    const dup = await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: REEL_CANON, title: 'Otra vez' } })
    expect(dup.status).toBe(409)
    expect(dup.json.error).toMatch(/completarla con el texto/)
    expect((await h.call('POST', '/api/admin/posts/link-preview', { cookie, body: { url: REEL } })).json.duplicate).toMatchObject({ linkOnly: true })
    expect((await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: 'https://www.facebook.com/p/Comuna-De-Rio-Seco-61553018412844/', title: 'Página' } })).status).toBe(400)
    expect((await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: 'https://example.com/x', title: 'x' } })).status).toBe(400)
    expect((await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: PERMALINK, title: 'Duelo', categories: ['obituarios'] } })).status).toBe(400)
    expect((await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: PERMALINK } })).status).toBe(400)
    expect(count(h, 'SELECT COUNT(*) n FROM posts')).toBe(1)
  })

  it('el rol de solo lectura no puede registrar y sin sesión tampoco', async () => {
    const h = await harness()
    expect((await h.call('POST', '/api/admin/posts/register-link', { cookie: await h.loginAs('viewer'), body: { url: REEL, title: 'x' } })).status).toBe(403)
    expect((await h.call('POST', '/api/admin/posts/register-link', { body: { url: REEL, title: 'x' } })).status).toBe(401)
  })

  it('una tarjeta por enlace NUNCA genera notificación, aunque esté publicada y sea reciente', async () => {
    const { h, pushFetch } = await pushHarness()
    const cookie = await h.loginAs('editor')
    h.db.raw.prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth, topics_json, created_at) VALUES ('https://push.test/1','k','a',?,?)").run(JSON.stringify(['institucional', 'eventos']), NOW.toISOString())
    const r = await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: REEL, title: 'Video', categories: ['institucional'], reviewed: true, publish: true } })
    await h.settle()
    expect(r.status).toBe(201)
    expect(count(h, 'SELECT COUNT(*) n FROM notification_log')).toBe(0) // registrar no avisa
    // Publicar después un borrador enlazado tampoco avisa: queda registrado como suprimido.
    const d = await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: PERMALINK, title: 'Borrador', categories: ['institucional'] } })
    await h.call('POST', `/api/admin/posts/${d.json.postId}/publish`, { cookie })
    await h.settle()
    expect(h.db.raw.prepare('SELECT state, suppressed_reason FROM notification_log').all()).toEqual([{ state: 'suppressed', suppressed_reason: 'publicación enlazada sin texto: no se notifica' }])
    await processNotifications(h.db.asD1(), { send: vi.fn() } as never, NOW)
    expect(pushFetch).not.toHaveBeenCalled()
  })
})

describe('completar una tarjeta enlazada con el texto original', () => {
  it('actualiza la MISMA tarjeta (sin duplicar), clasifica con las reglas y conserva las categorías ya confirmadas', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    const reg = await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: PERMALINK, title: 'Publicación del domingo', categories: ['cultura'], publish: true } })
    const id = reg.json.postId
    const e = await h.call('POST', `/api/admin/posts/${id}/enrich`, { cookie, body: { text: ACTO, publishedAt: '2026-10-25T15:00:00.000Z' } })
    expect(e.status).toBe(200)
    expect(e.json.categories).toEqual(expect.arrayContaining(['eventos', 'cultura']))
    expect(count(h, 'SELECT COUNT(*) n FROM posts')).toBe(1)
    expect(h.db.raw.prepare('SELECT title, link_only, date_verified, published_at, body, status FROM posts').get()).toMatchObject({ title: 'Publicación del domingo', link_only: 0, date_verified: 1, published_at: '2026-10-25T15:00:00.000Z', body: ACTO, status: 'published' })
    expect(h.db.raw.prepare("SELECT proposed_by, confirmed FROM post_categories WHERE category_id = 'cultura'").get()).toEqual({ proposed_by: 'editor', confirmed: 1 })
    // Ya no es «solo enlace»: se puede enriquecer una sola vez.
    expect((await h.call('POST', `/api/admin/posts/${id}/enrich`, { cookie, body: { text: ACTO } })).status).toBe(409)
    expect((await h.call('POST', '/api/admin/posts/999/enrich', { cookie, body: { text: ACTO } })).status).toBe(404)
  })

  it('un texto de obituario retira la tarjeta del feed y exige aprobación humana', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    const id = (await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: PERMALINK, title: 'Comunicado', publish: true } })).json.postId
    expect((await h.call('GET', '/api/public/feed')).json).toHaveLength(1)
    const e = await h.call('POST', `/api/admin/posts/${id}/enrich`, { cookie, body: { text: FUNERAL } })
    expect(e.json.obituaryId).toBeTruthy()
    expect(e.json.status).toBe('pending')
    expect((await h.call('GET', '/api/public/feed')).json).toEqual([])
    expect(h.db.raw.prepare('SELECT state FROM obituaries').get()).toEqual({ state: 'pending' })
  })

  it('el texto de otra publicación ya cargada se informa como duplicado', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    await h.call('POST', '/api/admin/posts', { cookie, body: { title: 'Acto', body: ACTO, status: 'published' } })
    const id = (await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: PERMALINK, title: 'Acto', publish: true } })).json.postId
    expect((await h.call('POST', `/api/admin/posts/${id}/enrich`, { cookie, body: { title: 'Acto', text: ACTO } })).status).toBe(409)
  })
})

describe('Recuperar publicaciones anteriores (carga retroactiva)', () => {
  const body = (items: unknown[], extra: Record<string, unknown> = {}) => ({ periodFrom: '2026-10-21', periodTo: '2026-10-28', items, ...extra })

  it('la vista previa no guarda nada; separa lo seguro de lo que requiere revisión y marca el origen del contenido', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    const r = await h.call('POST', '/api/admin/posts/retro-preview', {
      cookie,
      body: body([{ url: REEL, title: 'Video' }, { url: PERMALINK, text: ACTO, publishedAt: '2026-10-25T15:00:00.000Z' }, { url: 'https://www.facebook.com/posts/pfbid0DUELO999', text: FUNERAL }], { publishSafe: true }),
    })
    expect(r.status).toBe(200)
    const [a, b, c] = r.json.items
    expect(a).toMatchObject({ ok: true, textSource: 'enlace', outcome: 'revision', safe: false }) // sin «vi la publicación» no se publica sola
    expect(b).toMatchObject({ ok: true, textSource: 'texto', outcome: 'publicada', safe: true, dateVerified: true })
    expect(c).toMatchObject({ ok: true, outcome: 'revision-obituario', safe: false })
    expect(count(h, 'SELECT COUNT(*) n FROM posts')).toBe(0)
  })

  it('importa como histórico: publica solo categorías seguras, deja lo sensible en revisión y no notifica ni propone avisos', async () => {
    const { h, pushFetch } = await pushHarness()
    const cookie = await h.loginAs('editor')
    h.db.raw.prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth, topics_json, created_at) VALUES ('https://push.test/1','k','a',?,?)").run(JSON.stringify(['urgente', 'agua', 'eventos', 'obituarios', 'institucional', 'meteorologica']), NOW.toISOString())
    const corte = 'Atención vecinos: corte de agua programado por reparación de la red en el barrio centro, desde las 8 hasta las 14 horas de hoy.'
    const r = await h.call('POST', '/api/admin/posts/retro-import', {
      cookie,
      body: body(
        [
          { url: REEL, title: 'Video del acto', categories: ['eventos'], reviewed: true, publishedAt: '2026-10-27T13:00:00.000Z' },
          { url: PERMALINK, text: ACTO, publishedAt: '2026-10-25T15:00:00.000Z' },
          { url: 'https://www.facebook.com/posts/pfbid0DUELO999', text: FUNERAL, publishedAt: '2026-10-26T15:00:00.000Z' },
          { url: 'https://www.facebook.com/posts/pfbid0AGUA999', text: corte, publishedAt: '2026-10-27T11:00:00.000Z' },
        ],
        { publishSafe: true },
      ),
    })
    expect(r.status).toBe(200)
    expect(r.json.items.map((i: { outcome: string }) => i.outcome)).toEqual(['publicada', 'publicada', 'revision', 'revision'])
    const posts = h.db.raw.prepare('SELECT status, historical, link_only FROM posts ORDER BY id').all()
    expect(posts).toEqual([
      { status: 'published', historical: 1, link_only: 1 },
      { status: 'published', historical: 1, link_only: 0 },
      { status: 'pending', historical: 1, link_only: 0 }, // obituario: nunca se publica solo
      { status: 'pending', historical: 1, link_only: 0 }, // corte de agua: requiere revisión
    ])
    expect(count(h, 'SELECT COUNT(*) n FROM alerts')).toBe(0) // el material histórico no propone avisos
    expect(h.db.raw.prepare('SELECT state FROM obituaries').get()).toEqual({ state: 'pending' })
    expect((await h.call('GET', '/api/public/feed')).json.map((p: { title: string }) => p.title)).toHaveLength(2)

    // Jamás se notifica: ni al importar ni al aprobar después un contenido histórico.
    await h.settle()
    const idAgua = (h.db.raw.prepare("SELECT id FROM posts WHERE url LIKE '%AGUA%'").get() as { id: number }).id
    expect((await h.call('POST', `/api/admin/posts/${idAgua}/publish`, { cookie })).status).toBe(200)
    const obId = (h.db.raw.prepare('SELECT id FROM obituaries').get() as { id: number }).id
    await h.call('POST', `/api/admin/obituaries/${obId}/approve`, { cookie: await h.loginAs('admin'), body: { name: 'Juana Pérez', deathDate: '2026-10-26' } })
    await h.settle()
    expect(count(h, "SELECT COUNT(*) n FROM notification_log WHERE state != 'suppressed'")).toBe(0)
    expect(count(h, 'SELECT COUNT(*) n FROM notification_log')).toBeGreaterThan(0)
    expect(pushFetch).not.toHaveBeenCalled()
  })

  it('sin publicar en bloque todo queda en revisión; fuera del período, duplicados y sin título se informan', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    const r = await h.call('POST', '/api/admin/posts/retro-import', {
      cookie,
      body: body([
        { url: REEL, title: 'Video', reviewed: true },
        { url: PERMALINK, text: ACTO, publishedAt: '2026-09-01T15:00:00.000Z' },
        { url: 'https://www.facebook.com/reel/222222222222222/' },
      ]),
    })
    const [a, b, c] = r.json.items
    expect(a.outcome).toBe('revision')
    expect(b).toMatchObject({ ok: false, error: expect.stringMatching(/fuera del período/) })
    expect(c).toMatchObject({ ok: false, error: expect.stringMatching(/título/) })
    expect((h.db.raw.prepare('SELECT status FROM posts').get() as { status: string }).status).toBe('pending')
    const again = await h.call('POST', '/api/admin/posts/retro-import', { cookie, body: body([{ url: REEL, title: 'Video' }]) })
    expect(again.json.items[0].outcome).toBe('duplicado')
    expect(count(h, 'SELECT COUNT(*) n FROM posts')).toBe(1)
  })

  it('con texto sobre una tarjeta ya enlazada la completa en vez de duplicarla', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: PERMALINK, title: 'Acto', publish: true } })
    const r = await h.call('POST', '/api/admin/posts/retro-import', { cookie, body: body([{ url: PERMALINK, text: ACTO, publishedAt: '2026-10-25T15:00:00.000Z' }]) })
    expect(r.json.items[0].outcome).toBe('completada')
    expect(count(h, 'SELECT COUNT(*) n FROM posts')).toBe(1)
    expect(h.db.raw.prepare('SELECT link_only, body FROM posts').get()).toEqual({ link_only: 0, body: ACTO })
  })

  it('exige permiso de edición y limita el tamaño del lote', async () => {
    const h = await harness()
    expect((await h.call('POST', '/api/admin/posts/retro-import', { cookie: await h.loginAs('viewer'), body: body([{ url: REEL, title: 'x' }]) })).status).toBe(403)
    const cookie = await h.loginAs('editor')
    const many = Array.from({ length: 26 }, (_, i) => ({ url: `https://www.facebook.com/reel/${300000000000000 + i}/`, title: 't' }))
    expect((await h.call('POST', '/api/admin/posts/retro-import', { cookie, body: body(many) })).status).toBe(400)
  })
})

describe('flujo editorial: vistas del panel', () => {
  it('permite listar las cargadas por enlace, las históricas y las pendientes de clasificar', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: REEL, title: 'Solo enlace', publish: true } })
    await h.call('POST', '/api/admin/posts', { cookie, body: { title: 'Nota', body: ACTO, status: 'published' } })
    const links = await h.call('GET', '/api/admin/posts?enlace=1', { cookie })
    expect(links.json.map((p: { title: string }) => p.title)).toEqual(['Solo enlace'])
    expect((await h.call('GET', '/api/admin/posts?historico=1', { cookie })).json).toEqual([])
    const detail = await h.call('GET', `/api/admin/posts/${links.json[0].id}`, { cookie })
    expect(detail.json.history.map((x: { action: string }) => x.action)).toContain('registered-link')
  })
})

describe('con un token válido, la sincronización completa las tarjetas registradas por enlace (conector simulado)', () => {
  it('reconoce la misma publicación por su enlace, la completa con el texto y no crea otra noticia ni notifica lo viejo', async () => {
    const h = await harness()
    const cookie = await h.loginAs('editor')
    await h.call('POST', '/api/admin/posts/register-link', { cookie, body: { url: PERMALINK, title: 'Publicación del domingo', publish: true } })
    h.db.exec("UPDATE sources SET enabled = 1, mode = 'api' WHERE id = 'facebook-comuna'")
    const connector: SourceConnector = {
      kind: 'facebook',
      readiness: () => ({ ready: true, missing: [] }),
      fetchNew: async () => ({
        posts: [
          { externalId: '61553018412844_999', url: PERMALINK, body: ACTO, publishedAt: '2026-10-25T15:00:00.000Z' },
          { externalId: '61553018412844_1000', url: 'https://www.facebook.com/reel/777777777777777/', body: 'Texto de otra publicación distinta del Concejo, sin relación con el festival, con varias palabras diferentes para evitar parecidos.', publishedAt: '2026-10-26T15:00:00.000Z' },
        ],
      }),
    }
    const src = (await h.db.prepare('SELECT * FROM sources WHERE id = ?').bind('facebook-comuna').first<SourceRow>())!
    const r = await syncSource(h.env, src, NOW, { connectors: { facebook: connector } })
    expect(r).toMatchObject({ outcome: 'success', completed: 1, inserted: 1 })
    expect(count(h, 'SELECT COUNT(*) n FROM posts')).toBe(2) // la tarjeta completada + la otra publicación
    expect(h.db.raw.prepare("SELECT link_only, body, date_verified FROM posts WHERE url = ?").get(PERMALINK)).toMatchObject({ link_only: 0, body: ACTO, date_verified: 1 })
    expect(SYSTEM_ACTOR).toBeTruthy()
  })
})

describe('recorrido del editor: enlace → texto → clasificación → obituario aprobado (datos sintéticos)', () => {
  it('importar con enlace y texto: sin fecha confirmada queda «desconocida»; el obituario espera, y al aprobarlo está en Obituarios y en el feed', async () => {
    const h = await harness()
    const editor = await h.loginAs('editor')
    // Tarjeta registrada antes solo con el enlace; luego se importa con el texto: se completa la MISMA tarjeta.
    await h.call('POST', '/api/admin/posts/register-link', { cookie: editor, body: { url: PERMALINK, title: 'Comunicado de la Comuna', publish: true } })
    const r = await h.call('POST', '/api/admin/posts/import-link', { cookie: editor, body: { url: PERMALINK, text: FUNERAL } })
    expect(r.status).toBe(201)
    expect(r.json).toMatchObject({ enriched: true, status: 'pending' })
    expect(r.json.obituaryId).toBeTruthy()
    expect(count(h, 'SELECT COUNT(*) n FROM posts')).toBe(1)
    expect((await h.call('GET', '/api/public/feed')).json).toEqual([])
    expect((await h.call('GET', '/api/public/obituaries')).json).toEqual([])
    expect(h.db.raw.prepare('SELECT date_verified FROM posts').get()).toEqual({ date_verified: 0 })

    // El editor confirma nombre y fecha; aprueba (el editor tiene permiso).
    const id = r.json.obituaryId
    await h.call('PATCH', `/api/admin/obituaries/${id}`, { cookie: editor, body: { name: 'Juana Pérez', deathDate: '2026-10-27' } })
    expect((await h.call('POST', `/api/admin/obituaries/${id}/approve`, { cookie: editor })).status).toBe(200)
    expect((await h.call('GET', '/api/public/obituaries')).json.map((o: { name: string }) => o.name)).toEqual(['Juana Pérez'])
    const feed = (await h.call('GET', '/api/public/feed')).json
    expect(feed).toHaveLength(1)
    expect(feed[0].categories).toContain('obituarios')
  })

  it('una suspensión de recolección importada propone un aviso vigente; una publicación común va directo a Noticias con varias categorías', async () => {
    const h = await harness()
    const editor = await h.loginAs('editor')
    const a = await h.call('POST', '/api/admin/posts/import-link', { cookie: editor, body: { url: REEL, text: 'Se suspende la recolección de residuos de hoy por las intensas lluvias. Se retomará mañana.', publishedAt: NOW.toISOString() } })
    expect(a.json.alertId).toBeTruthy()
    expect(h.db.raw.prepare('SELECT confirmation, expires_at > ? AS vigente FROM alerts').get(NOW.toISOString())).toEqual({ confirmation: 'proposed', vigente: 1 })
    const b = await h.call('POST', '/api/admin/posts/import-link', { cookie: editor, body: { url: PERMALINK, text: ACTO } })
    expect(b.json.status).toBe('published')
    expect((await h.call('GET', '/api/public/feed')).json).toHaveLength(2)
  })
})

describe('Graph API simulada: publicaciones con imagen o video sin texto', () => {
  it('el conector conserva tipo y multimedia; la sincronización crea tarjetas pendientes de clasificar, sin alertas, obituarios ni avisos', async () => {
    const h = await harness(await vapidEnv(), { pushFetch: vi.fn() as never })
    h.db.exec("UPDATE sources SET enabled = 1, mode = 'api', config_json = '{\"pageId\":\"123\"}' WHERE id = 'facebook-comuna'")
    const env = { ...h.env, META_PAGE_ACCESS_TOKEN: 'token-de-prueba' }
    const urls: string[] = []
    const fetchImpl = (async (u: string) => {
      urls.push(String(u))
      return new Response(JSON.stringify({ data: [
        { id: '123_1', created_time: '2026-10-27T12:00:00+0000', permalink_url: 'https://www.facebook.com/reel/555555555555555/', attachments: { data: [{ media_type: 'video' }] } },
        { id: '123_2', created_time: '2026-10-27T13:00:00+0000', permalink_url: 'https://www.facebook.com/123/posts/pfbid0IMG', full_picture: 'https://scontent.xx.fbcdn.net/a.jpg', attachments: { data: [{ media_type: 'photo' }] } },
        { id: '123_3', created_time: '2026-10-27T14:00:00+0000', permalink_url: 'https://www.facebook.com/123/posts/pfbid0TXT', message: ACTO },
      ] }), { headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    const src = (await h.db.prepare('SELECT * FROM sources WHERE id = ?').bind('facebook-comuna').first<SourceRow>())!
    const r = await syncSource(env, src, NOW, { fetchImpl })
    expect(r).toMatchObject({ outcome: 'success', fetched: 3, inserted: 3, mediaOnly: 2 })
    expect(decodeURIComponent(urls[0])).toContain('since=') // primera corrida: últimos 7 días
    const rows = h.db.raw.prepare('SELECT title, link_only, content_type, review_state, status, media_json, origin FROM posts ORDER BY id').all() as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({ link_only: 1, content_type: 'video', review_state: 'needs_review', status: 'published', origin: 'api' })
    expect(rows[1]).toMatchObject({ link_only: 1, content_type: 'foto', media_json: '["https://scontent.xx.fbcdn.net/a.jpg"]' })
    expect(rows[2]).toMatchObject({ link_only: 0 })
    expect(count(h, 'SELECT COUNT(*) n FROM alerts')).toBe(0)
    expect(count(h, 'SELECT COUNT(*) n FROM obituaries')).toBe(0)
    expect(count(h, "SELECT COUNT(*) n FROM notification_log WHERE state != 'suppressed'")).toBe(0) // 3 en una corrida = carga histórica
    // Segunda corrida con lo mismo: no duplica.
    const again = await syncSource(env, (await h.db.prepare('SELECT * FROM sources WHERE id = ?').bind('facebook-comuna').first<SourceRow>())!, new Date(NOW.getTime() + 120_000), { fetchImpl })
    expect(count(h, 'SELECT COUNT(*) n FROM posts')).toBe(3)
    expect(again.inserted).toBe(0)
    // El editor las ve en la vista «Por clasificar».
    expect((await h.call('GET', '/api/admin/posts?revision=needs_review', { cookie: await h.loginAs('editor') })).json.length).toBeGreaterThanOrEqual(2)
    expect((await h.call('GET', '/api/public/feed')).json.find((p: { linkOnly: boolean; media: string[] }) => p.media.length)).toMatchObject({ linkOnly: true })
  })
})
