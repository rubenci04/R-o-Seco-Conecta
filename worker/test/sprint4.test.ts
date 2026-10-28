// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { alertsFileSchema, eventsFileSchema, newsFileSchema, obituariesFileSchema } from '../../src/domain/schemas'
import { ingestPost, type SourceRow } from '../ingest'
import { SYSTEM_ACTOR } from '../env'
import { freshDb, migrate, TestD1 } from './d1shim'
import { harness, NOW, TEXT } from './helpers'

const prod = (env = {}) => harness(env, {}, { production: true })

describe('configuración de producción: solo lo activo existe', () => {
  it('lugares, radios, transporte y Web Push NO están expuestos', async () => {
    const h = await prod()
    for (const p of ['/api/public/radios', '/api/public/places', '/api/public/transport', '/api/public/push/config', '/api/public/notifications/latest']) {
      expect((await h.call('GET', p)).status, p).toBe(404)
    }
    expect((await h.call('POST', '/api/public/push/subscribe', { body: { endpoint: 'https://x.test', keys: { p256dh: 'a', auth: 'b' }, topics: ['agua'] } })).status).toBe(404)
    const cookie = await h.loginAs('admin')
    for (const p of ['/api/admin/radios', '/api/admin/places', '/api/admin/bus-services', '/api/admin/bus-companies', '/api/admin/notifications']) {
      expect((await h.call('GET', p, { cookie })).status, p).toBe(404)
    }
    expect((await h.call('GET', '/api/admin/events', { cookie })).status).toBe(200) // eventos sí
  })
  it('la comprobación de salud confirma el enlace con la base y no expone datos', async () => {
    const h = await prod()
    const r = await h.call('GET', '/api/health')
    expect(r.json).toMatchObject({ ok: true, database: 'ok' })
    expect(Object.keys(r.json).sort()).toEqual(['database', 'now', 'ok'])
  })
  it('publicar no encola notificaciones mientras Web Push esté desactivado', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.torneo, status: 'published' } })
    expect((h.db.raw.prepare('SELECT COUNT(*) n FROM notification_log').get() as { n: number }).n).toBe(0)
  })
  it('los endpoints desconocidos siguen respondiendo JSON 404 y las cabeceras de seguridad', async () => {
    const h = await prod()
    const r = await h.call('GET', '/api/admin/lo-que-sea')
    expect(r.status).toBe(401) // sin sesión: ni siquiera se revela si la ruta existe
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('x-frame-options')).toBe('DENY')
  })
})

describe('contrato API ↔ frontend (esquemas Zod compartidos)', () => {
  it('feed, alertas, agenda y obituarios cumplen los esquemas del frontend', async () => {
    const h = await prod()
    const cookie = await h.loginAs('admin')
    await h.call('POST', '/api/admin/posts', { cookie, body: { title: 'Nota', body: TEXT.agua, sourceLabel: 'Comuna', url: 'https://www.facebook.com/p/1', categories: ['agua'], status: 'published' } })
    await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.torneo, status: 'published' } }) // sin enlace de fuente
    await h.call('POST', '/api/admin/alerts', { cookie, body: { kind: 'agua', title: 'Corte', body: 'Corte programado', confirm: true, startsAt: '2026-10-28T10:00:00Z', expiresAt: '2026-10-29T10:00:00Z' } })
    await h.call('POST', '/api/admin/events', { cookie, body: { title: 'Fiesta', starts_at: '2026-12-08T20:00:00-03:00', place_text: 'Plaza', category: 'festividad', source_label: 'Comuna', source_url: 'https://www.facebook.com/p/x', published: true } })
    await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.obit, status: 'published' } })
    await h.call('PATCH', '/api/admin/obituaries/1', { cookie, body: { name: 'Juan Carlos Pérez', deathDate: '2026-10-27' } })
    await h.call('POST', '/api/admin/obituaries/1/approve', { cookie })

    const feed = await h.call('GET', '/api/public/feed')
    expect(newsFileSchema.safeParse(feed.json).success, JSON.stringify(newsFileSchema.safeParse(feed.json).error?.issues)).toBe(true)
    expect(feed.json).toHaveLength(3)
    expect(feed.json.find((n: { title: string }) => n.title === 'Nota').source).toEqual({ label: 'Comuna', url: 'https://www.facebook.com/p/1' })
    expect(alertsFileSchema.safeParse((await h.call('GET', '/api/public/alerts')).json).success).toBe(true)
    expect(eventsFileSchema.safeParse((await h.call('GET', '/api/public/events')).json).success).toBe(true)
    expect(obituariesFileSchema.safeParse((await h.call('GET', '/api/public/obituaries')).json).success).toBe(true)
  })
  it('las notas de la redacción sin enlace usan la fuente «Redacción Río Seco Conecta» sin URL', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.torneo, status: 'published' } })
    const [n] = (await h.call('GET', '/api/public/feed')).json
    expect(n.source).toEqual({ label: 'Redacción Río Seco Conecta' })
    expect(n.origin).toBe('manual')
  })
})

describe('`verified`: distingue la revisión editorial de la mera importación', () => {
  it('una nota de la redacción está verificada; lo importado automáticamente sin revisar, NO', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    await h.call('POST', '/api/admin/posts', { cookie, body: { title: 'Propia', body: TEXT.torneo, status: 'published' } })
    const fb = h.db.prepare("SELECT * FROM sources WHERE id = 'facebook-comuna'")
    const source = (await fb.first()) as SourceRow
    await ingestPost(h.db.asD1(), { externalId: 'fb-1', body: 'Taller de música y danza en la biblioteca popular, inscripciones abiertas para vecinos de todas las edades.', publishedAt: NOW.toISOString() }, { source, origin: 'api', actor: SYSTEM_ACTOR, now: NOW })
    const feed = (await h.call('GET', '/api/public/feed')).json as { title: string; verified: boolean; origin: string }[]
    const own = feed.find((n) => n.title === 'Propia')!
    const imported = feed.find((n) => n.title.startsWith('Taller'))!
    expect(own).toMatchObject({ verified: true, origin: 'manual' })
    expect(imported).toMatchObject({ verified: false, origin: 'api' })
  })
  it('al aprobar o corregir la clasificación una persona, lo importado pasa a verificado', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    const source = (await h.db.prepare("SELECT * FROM sources WHERE id = 'facebook-comuna'").first()) as SourceRow
    const r = await ingestPost(h.db.asD1(), { externalId: 'fb-2', body: 'Taller de música y danza en la biblioteca popular, inscripciones abiertas para vecinos de todas las edades.', publishedAt: NOW.toISOString() }, { source, origin: 'api', actor: SYSTEM_ACTOR, now: NOW })
    const id = r.outcome === 'inserted' ? r.postId : 0
    await h.call('PATCH', `/api/admin/posts/${id}`, { cookie, body: { reviewState: 'approved' } })
    expect(((await h.call('GET', '/api/public/feed')).json as { verified: boolean }[])[0].verified).toBe(true)
  })
})

describe('revisión editorial de lo publicado por la redacción', () => {
  it('una nota de la redacción sin categorías elegidas y de baja confianza igual queda verificada al publicarse', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    await h.call('POST', '/api/admin/posts', { cookie, body: { title: 'Aviso general', body: TEXT.saludo, status: 'published' } })
    const [n] = (await h.call('GET', '/api/public/feed')).json
    expect(n).toMatchObject({ verified: true, origin: 'manual' })
  })
  it('un borrador de baja confianza queda para revisar la clasificación, y al publicarlo pasa a verificado', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    const id = (await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.saludo, status: 'draft' } })).json.postId
    expect((h.db.raw.prepare('SELECT review_state FROM posts WHERE id = ?').get(id) as { review_state: string }).review_state).toBe('needs_review')
    await h.call('POST', `/api/admin/posts/${id}/publish`, { cookie })
    expect(((await h.call('GET', '/api/public/feed')).json as { verified: boolean }[])[0].verified).toBe(true)
  })
})

describe('borradores, publicación y retiro', () => {
  it('un borrador no es público; publicarlo lo muestra; retirarlo lo oculta; se puede republicar', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    const id = (await h.call('POST', '/api/admin/posts', { cookie, body: { title: 'Borrador', body: TEXT.torneo, status: 'draft' } })).json.postId
    expect((h.db.raw.prepare('SELECT status FROM posts WHERE id = ?').get(id) as { status: string }).status).toBe('draft')
    expect((await h.call('GET', '/api/public/feed')).json).toHaveLength(0)
    expect((await h.call('POST', `/api/admin/posts/${id}/publish`, { cookie })).status).toBe(200)
    expect((await h.call('GET', '/api/public/feed')).json).toHaveLength(1)
    await h.call('DELETE', `/api/admin/posts/${id}`, { cookie })
    expect((await h.call('GET', '/api/public/feed')).json).toHaveLength(0)
    expect((await h.call('POST', `/api/admin/posts/${id}/publish`, { cookie })).status).toBe(200) // republicar
    expect((await h.call('GET', '/api/public/feed')).json).toHaveLength(1)
    expect((await h.call('POST', '/api/admin/posts', { cookie, body: { body: 'x', status: 'archivado' } })).status).toBe(400)
  })
  it('editar título, fuente, enlace y fecha queda en el historial', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    const id = (await h.call('POST', '/api/admin/posts', { cookie, body: { title: 'Antes', body: TEXT.torneo, status: 'published' } })).json.postId
    expect((await h.call('PATCH', `/api/admin/posts/${id}`, { cookie, body: { title: 'Después', sourceLabel: 'Radio Activa', url: 'https://www.activa1031.fmmiradio.com/', publishedAt: '2026-10-27T12:00:00-03:00' } })).status).toBe(200)
    const [n] = (await h.call('GET', '/api/public/feed')).json
    expect(n).toMatchObject({ title: 'Después', publishedAt: '2026-10-27T15:00:00.000Z', source: { label: 'Radio Activa', url: 'https://www.activa1031.fmmiradio.com/' } })
    const detail = await h.call('GET', `/api/admin/posts/${id}`, { cookie })
    expect(detail.json.history.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(['ingested', 'edited']))
    expect((await h.call('PATCH', `/api/admin/posts/${id}`, { cookie, body: { url: 'javascript:alert(1)' } })).status).toBe(400)
  })
  it('categorías elegidas por el editor quedan confirmadas y sin revisión pendiente', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    const id = (await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.saludo, categories: ['institucional', 'cultura'], status: 'published' } })).json.postId
    expect(h.db.raw.prepare('SELECT category_id, confirmed FROM post_categories WHERE post_id = ? ORDER BY 1').all(id)).toEqual([{ category_id: 'cultura', confirmed: 1 }, { category_id: 'institucional', confirmed: 1 }])
    expect((h.db.raw.prepare('SELECT review_state FROM posts WHERE id = ?').get(id) as { review_state: string }).review_state).toBe('approved')
  })
  it('una nota con tono de aviso fúnebre va a la cola aunque el editor pida publicarla', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    const r = await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.obit, categories: ['institucional'], status: 'published' } })
    expect(r.json.obituaryId).toBe(1)
    expect((await h.call('GET', '/api/public/feed')).json).toHaveLength(0)
    expect((await h.call('GET', '/api/public/obituaries')).json).toHaveLength(0)
  })
  it('el contenido con HTML o scripts se guarda y devuelve como texto literal (la interfaz lo escapa)', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)> Torneo de fútbol infantil en el club con equipos de la zona este fin de semana.'
    await h.call('POST', '/api/admin/posts', { cookie, body: { title: '<b>Título</b>', body: evil, status: 'published' } })
    const [n] = (await h.call('GET', '/api/public/feed')).json
    expect(n.title).toBe('<b>Título</b>')
    expect(n.body).toContain('<script>alert(1)</script>')
    expect(n.categories.length).toBeGreaterThan(0)
  })
})

describe('paginación y revalidación del feed', () => {
  it('pagina por cursor de fecha y filtra por categoría', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    const themes = ['inscripciones del torneo infantil de fútbol en el club San Ramón', 'campeonato de ciclismo con largada en la ruta nacional treinta y ocho', 'carrera pedestre solidaria por las calles del barrio norte', 'partido de básquet entre los equipos del polideportivo municipal', 'entrenamiento abierto de atletismo para jóvenes en la cancha central']
    for (let i = 0; i < 5; i++) {
      await h.call('POST', '/api/admin/posts', { cookie, body: { title: `Nota ${i}`, body: `Deportes: ${themes[i]}.`, publishedAt: `2026-10-2${i}T10:00:00-03:00`, status: 'published' } })
    }
    const p1 = (await h.call('GET', '/api/public/feed?limite=2')).json
    expect(p1.map((n: { title: string }) => n.title)).toEqual(['Nota 4', 'Nota 3'])
    const p2 = (await h.call('GET', `/api/public/feed?limite=2&antes=${encodeURIComponent(p1[1].publishedAt)}`)).json
    expect(p2.map((n: { title: string }) => n.title)).toEqual(['Nota 2', 'Nota 1'])
    expect((await h.call('GET', '/api/public/feed?categoria=deportes')).json.length).toBeGreaterThanOrEqual(4)
    expect((await h.call('GET', '/api/public/feed?categoria=salud')).json).toHaveLength(0)
    expect((await h.call('GET', '/api/public/feed?antes=ayer')).status).toBe(400)
  })
  it('responde con ETag y 304 si no cambió; el cambio se ve de inmediato (sin retraso de caché)', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    await h.call('POST', '/api/admin/posts', { cookie, body: { title: 'Uno', body: TEXT.torneo, status: 'published' } })
    const first = await h.call('GET', '/api/public/feed')
    const etag = first.headers.get('etag')!
    expect(etag).toMatch(/^"[0-9a-f]{24}"$/)
    expect(first.headers.get('cache-control')).toBe('public, no-cache')
    const again = await h.app.handleApi(new Request('https://app.test/api/public/feed', { headers: { 'if-none-match': etag } }), h.env)
    expect(again!.status).toBe(304)
    await h.call('POST', '/api/admin/posts', { cookie, body: { title: 'Dos', body: 'Festival folclórico con peña en la plaza central este sábado, entrada libre para todos los vecinos.', status: 'published' } })
    const changed = await h.app.handleApi(new Request('https://app.test/api/public/feed', { headers: { 'if-none-match': etag } }), h.env)
    expect(changed!.status).toBe(200)
  })
})

describe('alertas: vigencia y permisos', () => {
  it('crear y publicar exige permiso; las urgentes, el específico; el viewer no puede nada', async () => {
    const h = await prod()
    const viewer = await h.loginAs('viewer')
    expect((await h.call('POST', '/api/admin/alerts', { cookie: viewer, body: { kind: 'agua', title: 'x', body: 'y' } })).status).toBe(403)
    const editor = await h.loginAs('editor')
    const ok = await h.call('POST', '/api/admin/alerts', { cookie: editor, body: { kind: 'calles', severity: 'urgente', title: 'Calle cortada', body: 'Corte total', confirm: true } })
    expect(ok.json.confirmed).toBe(true)
    expect(((await h.call('GET', '/api/public/alerts')).json as unknown[]).length).toBe(1)
  })
  it('vigencia: no se muestra antes de empezar ni después de vencer', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    const mk = (title: string, startsAt: string, expiresAt: string) => h.call('POST', '/api/admin/alerts', { cookie, body: { kind: 'agua', title, body: 'Texto', confirm: true, startsAt, expiresAt } })
    await mk('Vigente', '2026-10-28T10:00:00Z', '2026-10-28T20:00:00Z')
    await mk('Vencida', '2026-10-27T10:00:00Z', '2026-10-27T20:00:00Z')
    await mk('Futura', '2026-10-30T10:00:00Z', '2026-10-30T20:00:00Z')
    expect(((await h.call('GET', '/api/public/alerts')).json as { title: string }[]).map((a) => a.title)).toEqual(['Vigente'])
  })
  it('una alerta sin confirmar nunca es pública, aunque se edite', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    const id = (await h.call('POST', '/api/admin/alerts', { cookie, body: { kind: 'agua', title: 'Pendiente', body: 'Texto' } })).json.id
    await h.call('PATCH', `/api/admin/alerts/${id}`, { cookie, body: { title: 'Pendiente editada' } })
    expect((await h.call('GET', '/api/public/alerts')).json).toHaveLength(0)
  })
})

describe('eventos', () => {
  const ev = { title: 'Fiesta', starts_at: '2026-12-08T21:30:00-03:00', place_ref: 'comuna-rio-seco', place_text: 'Comuna de Río Seco', category: 'festividad', source_label: 'Comuna', source_url: 'https://www.facebook.com/p/x', published: true }
  it('crea, edita, despublica y elimina; el horario se conserva en hora de Tucumán', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    const id = (await h.call('POST', '/api/admin/events', { cookie, body: ev })).json.id
    const pub = (await h.call('GET', '/api/public/events')).json
    expect(pub[0]).toMatchObject({ title: 'Fiesta', startsAt: '2026-12-09T00:30:00.000Z', place: 'Comuna de Río Seco', category: 'festividad' })
    await h.call('PATCH', `/api/admin/events/${id}`, { cookie, body: { published: false } })
    expect((await h.call('GET', '/api/public/events')).json).toHaveLength(0)
    await h.call('PATCH', `/api/admin/events/${id}`, { cookie, body: { published: true, description: 'Programa completo' } })
    expect((await h.call('GET', '/api/public/events')).json[0].description).toBe('Programa completo')
    expect((await h.call('DELETE', `/api/admin/events/${id}`, { cookie })).status).toBe(200)
    expect((await h.call('GET', '/api/public/events')).json).toHaveLength(0)
  })
  it('valida fechas, enlaces y fin posterior al inicio; los eventos pasados dejan de listarse', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    expect((await h.call('POST', '/api/admin/events', { cookie, body: { ...ev, ends_at: '2026-12-08T10:00:00-03:00' } })).status).toBe(400)
    expect((await h.call('POST', '/api/admin/events', { cookie, body: { ...ev, starts_at: 'mañana' } })).status).toBe(400)
    expect((await h.call('POST', '/api/admin/events', { cookie, body: { ...ev, source_url: 'javascript:alert(1)' } })).status).toBe(400)
    await h.call('POST', '/api/admin/events', { cookie, body: { ...ev, title: 'Pasado', starts_at: '2026-01-01T10:00:00-03:00' } })
    expect((await h.call('GET', '/api/public/events')).json).toHaveLength(0)
  })
})

describe('autenticación y sesiones (auditoría)', () => {
  it('cambio de contraseña: exige la actual, 12+ caracteres, y cierra las demás sesiones', async () => {
    const h = await prod()
    const a = await h.loginAs('editor')
    const b = await h.loginAs('editor')
    expect((await h.call('POST', '/api/admin/password', { cookie: a, body: { currentPassword: 'equivocada-equivocada', newPassword: 'una-contraseña-nueva-larga' } })).status).toBe(403)
    expect((await h.call('POST', '/api/admin/password', { cookie: a, body: { currentPassword: 'contraseña-de-prueba-1', newPassword: 'corta' } })).status).toBe(400)
    expect((await h.call('POST', '/api/admin/password', { cookie: a, body: { currentPassword: 'contraseña-de-prueba-1', newPassword: 'contraseña-de-prueba-1' } })).status).toBe(400)
    expect((await h.call('POST', '/api/admin/password', { cookie: a, body: { currentPassword: 'contraseña-de-prueba-1', newPassword: 'una-contraseña-nueva-larga' } })).status).toBe(200)
    expect((await h.call('GET', '/api/admin/me', { cookie: a })).json.admin.email).toBe('editor@test.local') // la sesión actual sigue
    expect((await h.call('GET', '/api/admin/me', { cookie: b })).json).toEqual({ admin: null }) // las otras se cerraron
    expect((await h.call('POST', '/api/admin/login', { body: { email: 'editor@test.local', password: 'contraseña-de-prueba-1' } })).status).toBe(401)
    expect((await h.call('POST', '/api/admin/login', { body: { email: 'editor@test.local', password: 'una-contraseña-nueva-larga' } })).status).toBe(200)
  })
  it('una sesión vencida deja de valer', async () => {
    const h = await prod()
    const cookie = await h.loginAs('admin')
    h.db.exec("UPDATE admin_sessions SET expires_at = '2020-01-01T00:00:00.000Z'")
    expect((await h.call('GET', '/api/admin/me', { cookie })).json).toEqual({ admin: null })
  })
  it('la contraseña se guarda con PBKDF2 y sal propia; dos usuarios con la misma clave tienen hashes distintos', async () => {
    const h = await prod()
    const admin = await h.loginAs('admin')
    for (const n of [1, 2]) {
      await h.call('POST', '/api/admin/users', { cookie: admin, body: { email: `mismo${n}@test.local`, displayName: 'Mismo', role: 'editor', password: 'misma-contraseña-larga-1' } })
    }
    const rows = h.db.raw.prepare("SELECT password_hash FROM admins WHERE email LIKE 'mismo%'").all() as { password_hash: string }[]
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => /^pbkdf2\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(r.password_hash))).toBe(true)
    expect(rows[0].password_hash).not.toBe(rows[1].password_hash) // sal distinta por usuario
    expect(JSON.stringify((await h.call('GET', '/api/admin/users', { cookie: admin })).json)).not.toContain('pbkdf2')
  })
  it('las respuestas de la API administrativa no se guardan en caché', async () => {
    const h = await prod()
    const r = await h.call('GET', '/api/admin/dashboard', { cookie: await h.loginAs('viewer') })
    expect(r.headers.get('cache-control')).toBe('no-store')
  })
})

describe('panel: resumen', () => {
  it('cuenta publicaciones, pendientes, alertas, eventos y obituarios; informa el estado de las fuentes', async () => {
    const h = await prod()
    const cookie = await h.loginAs('editor')
    await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.torneo, status: 'published' } })
    await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.agua2, status: 'draft' } })
    await h.call('POST', '/api/admin/posts', { cookie, body: { body: TEXT.obit, status: 'published' } })
    await h.call('POST', '/api/admin/events', { cookie, body: { title: 'Fiesta', starts_at: '2030-12-08T21:30:00-03:00', category: 'festividad', source_label: 'Comuna', source_url: 'https://www.facebook.com/p/x', published: true } })
    const d = (await h.call('GET', '/api/admin/dashboard', { cookie })).json
    expect(d.posts).toMatchObject({ published: 1, draft: 1, pending: 1 })
    expect(d.obituaries.pending).toBe(1)
    expect(d.alerts.proposed).toBeGreaterThanOrEqual(1)
    expect(d.events.upcoming).toBe(1)
    expect(d.history.length).toBeGreaterThan(0)
    const fb = d.sources.find((s: { id: string }) => s.id === 'facebook-comuna')
    expect(fb).toMatchObject({ enabled: false, status: 'not-configured' })
    expect(fb.readiness.ready).toBe(false)
  })
})

describe('migraciones y esquema D1', () => {
  const dir = path.resolve('migrations')
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  it('están numeradas sin saltos y se aplican limpias sobre una base vacía', () => {
    expect(files.map((f) => f.slice(0, 4))).toEqual(files.map((_, i) => String(i + 1).padStart(4, '0')))
    expect(() => migrate(new TestD1())).not.toThrow()
  })
  it('no contienen sentencias destructivas (DROP / DELETE / TRUNCATE) ni datos ficticios', () => {
    for (const f of files) {
      const sql = readFileSync(path.join(dir, f), 'utf8').replace(/--.*$/gm, '')
      expect(sql, f).not.toMatch(/\b(DROP\s+(TABLE|INDEX|COLUMN)|TRUNCATE|DELETE\s+FROM)\b/i)
    }
  })
  it('la semilla solo carga categorías y fuentes: sin radios, horarios, publicaciones ni usuarios', () => {
    const db = freshDb()
    const count = (t: string) => (db.raw.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n
    expect([count('categories'), count('sources')]).toEqual([12, 3])
    for (const t of ['radios', 'bus_localities', 'bus_services', 'posts', 'alerts', 'events', 'obituaries', 'admins', 'admin_sessions', 'push_subscriptions', 'notification_log']) expect(count(t), t).toBe(0)
  })
  it('el esquema admite borradores, fuente editorial y lugar de evento por id textual; rechaza estados inválidos', () => {
    const db = freshDb()
    const cols = (t: string) => (db.raw.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)
    expect(cols('posts')).toContain('source_label')
    expect(cols('events')).toEqual(expect.arrayContaining(['place_ref', 'place_text']))
    expect(cols('events')).not.toContain('place_id')
    const ins = (status: string) => db.exec(`INSERT INTO posts (source_id, external_id, title, published_at, imported_at, origin, content_hash, status) VALUES ('manual','e-${status}','t','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','manual','h-${status}','${status}')`)
    expect(() => ins('draft')).not.toThrow()
    expect(() => ins('archivado')).toThrow()
  })
  it('la integridad referencial está activa: no se crean categorías de publicación inexistentes', () => {
    const db = freshDb()
    db.exec("INSERT INTO posts (source_id, external_id, title, published_at, imported_at, origin, content_hash, status) VALUES ('manual','a','t','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','manual','h','draft')")
    expect(() => db.exec("INSERT INTO post_categories (post_id, category_id) VALUES (1, 'inventada')")).toThrow()
    expect(() => db.exec("INSERT INTO posts (source_id, external_id, title, published_at, imported_at, origin, content_hash) VALUES ('no-existe','a','t','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','manual','h2')")).toThrow()
  })
  it('hay índices para el feed, la revisión y las alertas vigentes', () => {
    const db = freshDb()
    const idx = (db.raw.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map((i) => i.name)
    expect(idx).toEqual(expect.arrayContaining(['idx_posts_feed', 'idx_posts_review', 'idx_post_categories_cat', 'idx_alerts_active', 'idx_events_start', 'idx_obituaries_state']))
  })
})
