import { isCategoryId } from '../../shared/categories'
import { can } from '../../shared/permissions'
import { assertCsrf, clearCookie, hashPassword, login, logout, readCookie, requirePermission, SESSION_COOKIE, sessionCookie, SESSION_HOURS, verifyPassword } from '../auth'
import { sha256Hex } from '../../shared/text'
import { buildAssistedPost } from '../connectors/assisted'
import { defaultConnectors } from '../connectors/meta'
import { SYSTEM_ACTOR } from '../env'
import { historyStatement } from '../history'
import { actorOf, HttpError, httpUrl, isoDate, json, Router, str, type Ctx } from '../http'
import { ingestPost, type SourceRow } from '../ingest'
import { enqueueAlertNotification, enqueuePostNotification, processNotifications } from '../notify'
import { createVapidSender, pushConfigured } from '../push'
import { syncSource, type SyncDeps } from '../sync'
import { crudRoutes } from './crud'
import type { Features } from '../features'

interface Deps extends SyncDeps {
  now?: () => Date
}

const MANUAL_SOURCE = 'manual'
const SECRET_KEY_PATTERN = /token|secret|password|passwd|clave|api[_-]?key|private/i

async function getSource(ctx: Ctx, id: string): Promise<SourceRow> {
  const s = await ctx.env.DB.prepare('SELECT * FROM sources WHERE id = ?').bind(id).first<SourceRow>()
  if (!s) throw new HttpError(404, 'Fuente no encontrada')
  return s
}

function parseCategories(v: unknown): string[] {
  if (!Array.isArray(v)) throw new HttpError(400, '«categories» debe ser una lista')
  const ids = [...new Set(v.map(String))]
  if (!ids.length) throw new HttpError(400, 'Elegí al menos una categoría')
  const bad = ids.find((c) => !isCategoryId(c))
  if (bad) throw new HttpError(400, `Categoría desconocida: ${bad}`)
  return ids
}

export function adminRoutes(r: Router, deps: Deps = {}, features: Features = { push: true, staticModules: true, syncSources: true }): void {
  // Las notificaciones solo se encolan si Web Push está habilitado (en producción todavía no).
  const off = { queued: false as const, reason: 'notificaciones desactivadas' }
  const enqueuePost = (...a: Parameters<typeof enqueuePostNotification>) => (features.push ? enqueuePostNotification(...a) : Promise.resolve(off))
  const enqueueAlert = (...a: Parameters<typeof enqueueAlertNotification>) => (features.push ? enqueueAlertNotification(...a) : Promise.resolve(off))
  // ---------------------------------------------------------------- sesión
  r.post('/api/admin/login', async (ctx) => {
    const b = await ctx.body()
    const result = await login(ctx.env.DB, str(b.email, 'email', { max: 200 }), str(b.password, 'password', { max: 200 }), ctx.now)
    if (!result.ok) {
      throw new HttpError(result.reason === 'locked' ? 429 : 401, result.reason === 'locked' ? 'Cuenta bloqueada temporalmente por intentos fallidos' : 'Credenciales inválidas')
    }
    return json({ admin: result.admin }, { headers: { 'set-cookie': sessionCookie(result.token, SESSION_HOURS * 3600) } })
  })

  r.post('/api/admin/logout', async (ctx) => {
    const token = readCookie(ctx.req, SESSION_COOKIE)
    if (token) await logout(ctx.env.DB, token)
    return json({ ok: true }, { headers: { 'set-cookie': clearCookie() } })
  })

  r.get('/api/admin/me', (ctx) => {
    if (!ctx.admin) throw new HttpError(401, 'Sin sesión')
    return json({ admin: ctx.admin })
  })

  // ---------------------------------------------------------- publicaciones
  r.get('/api/admin/posts', async (ctx) => {
    requirePermission(ctx, 'content:read')
    const sp = ctx.url.searchParams
    const where: string[] = []
    const binds: unknown[] = []
    for (const [param, column] of [['estado', 'p.status'], ['revision', 'p.review_state'], ['fuente', 'p.source_id']] as const) {
      const v = sp.get(param)
      if (v) {
        where.push(`${column} = ?`)
        binds.push(v)
      }
    }
    const cat = sp.get('categoria')
    if (cat) {
      where.push('EXISTS (SELECT 1 FROM post_categories pc WHERE pc.post_id = p.id AND pc.category_id = ?)')
      binds.push(cat)
    }
    const q = sp.get('q')
    if (q) {
      where.push('(p.title LIKE ? OR p.body LIKE ?)')
      binds.push(`%${q}%`, `%${q}%`)
    }
    const limit = Math.min(Number(sp.get('limite')) || 50, 200)
    const rows = await ctx.env.DB.prepare(
      `SELECT p.id, p.title, p.body, p.url, p.status, p.review_state, p.origin, p.published_at, p.imported_at, p.rectification, p.source_id,
              (SELECT group_concat(category_id || ':' || confidence || ':' || confirmed) FROM post_categories WHERE post_id = p.id) AS cats
       FROM posts p ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.published_at DESC LIMIT ?`,
    )
      .bind(...binds, limit)
      .all<Record<string, string | number | null>>()
    return json(
      rows.results.map(({ cats, ...p }) => ({
        ...p,
        categories: String(cats ?? '')
          .split(',')
          .filter(Boolean)
          .map((c) => {
            const [id, confidence, confirmed] = c.split(':')
            return { id, confidence: Number(confidence), confirmed: confirmed === '1' }
          }),
      })),
    )
  })

  r.get('/api/admin/posts/:id', async (ctx) => {
    requirePermission(ctx, 'content:read')
    const post = await ctx.env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(ctx.params.id).first()
    if (!post) throw new HttpError(404, 'No encontrada')
    const [categories, history] = await Promise.all([
      ctx.env.DB.prepare('SELECT category_id, confidence, proposed_by, confirmed, reasons_json FROM post_categories WHERE post_id = ?').bind(ctx.params.id).all(),
      ctx.env.DB.prepare("SELECT action, actor_label, note, at FROM editorial_history WHERE entity_type = 'post' AND entity_id = ? ORDER BY id DESC").bind(ctx.params.id).all(),
    ])
    return json({ post, categories: categories.results, history: history.results })
  })

  // Publicación manual desde el panel.
  r.post('/api/admin/posts', async (ctx) => {
    const admin = requirePermission(ctx, 'content:write')
    const b = await ctx.body()
    const body = str(b.body, 'body', { max: 20_000 })
    if (b.status !== undefined && !['draft', 'published'].includes(String(b.status))) throw new HttpError(400, 'El estado debe ser «draft» o «published»')
    const wantsDraft = b.status === 'draft'
    const source = await getSource(ctx, MANUAL_SOURCE)
    const result = await ingestPost(
      ctx.env.DB,
      {
        externalId: `manual:${crypto.randomUUID()}`,
        title: b.title ? str(b.title, 'title', { max: 200 }) : undefined,
        body,
        url: httpUrl(b.url, 'url', true),
        sourceLabel: b.sourceLabel ? str(b.sourceLabel, 'sourceLabel', { max: 120 }) : null,
        publishedAt: b.publishedAt ? isoDate(b.publishedAt, 'publishedAt') : ctx.now.toISOString(),
      },
      { source, origin: 'manual', actor: actorOf(admin), now: ctx.now, draft: wantsDraft },
    )
    if (result.outcome === 'duplicate') throw new HttpError(409, `Publicación duplicada (${result.reason}) de la #${result.ofPostId}`)
    if (b.categories) {
      await setCategories(ctx, result.postId, parseCategories(b.categories), admin)
      // El editor clasificó a mano: la revisión queda resuelta (salvo posibles obituarios, que siguen en su cola).
      if (result.obituaryId === null) await ctx.env.DB.prepare("UPDATE posts SET review_state = 'approved' WHERE id = ?").bind(result.postId).run()
    }
    if (result.status === 'published') await enqueuePost(ctx.env.DB, result.postId, ctx.now)
    return json(result, { status: 201 })
  })

  // Importación asistida por enlace (sin descargar nada de la plataforma).
  r.post('/api/admin/posts/import-link', async (ctx) => {
    const admin = requirePermission(ctx, 'content:write')
    const b = await ctx.body()
    const { sourceId, raw } = await buildAssistedPost({ url: str(b.url, 'url', { max: 2048 }), text: str(b.text, 'text', { max: 20_000 }), publishedAt: b.publishedAt ? String(b.publishedAt) : undefined }, ctx.now)
    const result = await ingestPost(ctx.env.DB, raw, { source: await getSource(ctx, sourceId), origin: 'assisted', actor: actorOf(admin), now: ctx.now })
    if (result.outcome === 'duplicate') throw new HttpError(409, `Ya importada (${result.reason}) como #${result.ofPostId}`)
    if (result.status === 'published') await enqueuePost(ctx.env.DB, result.postId, ctx.now)
    return json(result, { status: 201 })
  })

  async function setCategories(ctx: Ctx, postId: number, ids: string[], admin: { id: number; email: string }) {
    const db = ctx.env.DB
    await db.batch([
      db.prepare('DELETE FROM post_categories WHERE post_id = ?').bind(postId),
      ...ids.map((c) => db.prepare("INSERT INTO post_categories (post_id, category_id, confidence, proposed_by, confirmed, reasons_json) VALUES (?,?,1,'editor',1,'[]')").bind(postId, c)),
      historyStatement(db, { entityType: 'post', entityId: postId, action: 'categories-set', actor: { id: admin.id, label: admin.email }, after: ids }, ctx.now),
    ])
  }

  r.patch('/api/admin/posts/:id', async (ctx) => {
    const admin = requirePermission(ctx, 'content:write')
    const id = Number(ctx.params.id)
    const before = await ctx.env.DB.prepare('SELECT title, body, review_state, status FROM posts WHERE id = ?').bind(id).first<Record<string, string>>()
    if (!before) throw new HttpError(404, 'No encontrada')
    const b = await ctx.body()
    const sets: string[] = []
    const binds: unknown[] = []
    if (b.title !== undefined) { sets.push('title = ?'); binds.push(str(b.title, 'title', { max: 200 })) }
    if (b.body !== undefined) { sets.push('body = ?'); binds.push(str(b.body, 'body', { max: 20_000 })) }
    if (b.sourceLabel !== undefined) { sets.push('source_label = ?'); binds.push(b.sourceLabel ? str(b.sourceLabel, 'sourceLabel', { max: 120 }) : null) }
    if (b.url !== undefined) { sets.push('url = ?'); binds.push(httpUrl(b.url, 'url', true)) }
    if (b.publishedAt !== undefined) { sets.push('published_at = ?'); binds.push(isoDate(b.publishedAt, 'publishedAt')) }
    if (b.reviewState !== undefined) {
      if (!['approved', 'rejected', 'needs_review'].includes(String(b.reviewState))) throw new HttpError(400, 'Estado de revisión inválido')
      sets.push('review_state = ?'); binds.push(String(b.reviewState))
    }
    if (sets.length) {
      await ctx.env.DB.batch([
        ctx.env.DB.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id),
        historyStatement(ctx.env.DB, { entityType: 'post', entityId: id, action: 'edited', actor: actorOf(admin), before, after: b }, ctx.now),
      ])
    }
    if (b.categories !== undefined) {
      await setCategories(ctx, id, parseCategories(b.categories), admin)
      // Confirmar la clasificación equivale a revisión aprobada.
      await ctx.env.DB.prepare("UPDATE posts SET review_state = 'approved' WHERE id = ? AND review_state = 'needs_review'").bind(id).run()
    }
    return json({ ok: true })
  })

  // Aceptar una publicación pendiente (no obituario: los obituarios se aprueban en su cola).
  r.post('/api/admin/posts/:id/publish', async (ctx) => {
    const admin = requirePermission(ctx, 'content:write')
    const id = Number(ctx.params.id)
    const obit = await ctx.env.DB.prepare("SELECT 1 AS x FROM obituaries WHERE post_id = ? AND state = 'pending'").bind(id).first()
    if (obit) throw new HttpError(409, 'Es un posible obituario: debe aprobarse desde la cola de obituarios')
    const res = await ctx.env.DB.prepare("UPDATE posts SET status = 'published', review_state = 'approved', deleted_at = NULL WHERE id = ? AND status IN ('draft','pending','rejected','deleted')").bind(id).run()
    if (!res.meta.changes) throw new HttpError(404, 'No hay publicación pendiente con ese id')
    await historyStatement(ctx.env.DB, { entityType: 'post', entityId: id, action: 'published', actor: actorOf(admin) }, ctx.now).run()
    const n = await enqueuePost(ctx.env.DB, id, ctx.now)
    return json({ ok: true, notification: n })
  })

  r.post('/api/admin/posts/:id/reject', async (ctx) => {
    const admin = requirePermission(ctx, 'content:write')
    const id = Number(ctx.params.id)
    const rejectNote = await ctx.body().then((x) => (typeof x.note === 'string' ? x.note : undefined)).catch(() => undefined)
    await ctx.env.DB.batch([
      ctx.env.DB.prepare("UPDATE posts SET status = 'rejected', review_state = 'rejected' WHERE id = ?").bind(id),
      ctx.env.DB.prepare("UPDATE obituaries SET state = 'rejected' WHERE post_id = ? AND state = 'pending'").bind(id),
      historyStatement(ctx.env.DB, { entityType: 'post', entityId: id, action: 'rejected', actor: actorOf(admin), note: rejectNote }, ctx.now),
    ])
    return json({ ok: true })
  })

  r.post('/api/admin/posts/:id/rectify', async (ctx) => {
    const admin = requirePermission(ctx, 'content:write')
    const id = Number(ctx.params.id)
    const note = str((await ctx.body()).note, 'note', { max: 1000 })
    const res = await ctx.env.DB.prepare('UPDATE posts SET rectification = ?, rectified_at = ? WHERE id = ?').bind(note, ctx.now.toISOString(), id).run()
    if (!res.meta.changes) throw new HttpError(404, 'No encontrada')
    await historyStatement(ctx.env.DB, { entityType: 'post', entityId: id, action: 'rectified', actor: actorOf(admin), note }, ctx.now).run()
    return json({ ok: true })
  })

  // Retira la publicación del feed (borrado lógico, queda el historial).
  r.delete('/api/admin/posts/:id', async (ctx) => {
    const admin = requirePermission(ctx, 'content:delete')
    const id = Number(ctx.params.id)
    const res = await ctx.env.DB.prepare("UPDATE posts SET status = 'deleted', deleted_at = ? WHERE id = ? AND status != 'deleted'").bind(ctx.now.toISOString(), id).run()
    if (!res.meta.changes) throw new HttpError(404, 'No encontrada')
    await ctx.env.DB.batch([
      ctx.env.DB.prepare("UPDATE obituaries SET state = 'retracted' WHERE post_id = ? AND state = 'approved'").bind(id),
      historyStatement(ctx.env.DB, { entityType: 'post', entityId: id, action: 'deleted', actor: actorOf(admin) }, ctx.now),
    ])
    return json({ ok: true })
  })

  // -------------------------------------------------------------- obituarios
  r.get('/api/admin/obituaries', async (ctx) => {
    requirePermission(ctx, 'content:read')
    const state = ctx.url.searchParams.get('estado')
    const rows = await ctx.env.DB.prepare(`SELECT * FROM obituaries ${state ? 'WHERE state = ?' : ''} ORDER BY id DESC LIMIT 200`).bind(...(state ? [state] : [])).all()
    return json(rows.results)
  })

  r.patch('/api/admin/obituaries/:id', async (ctx) => {
    const admin = requirePermission(ctx, 'obituary:approve')
    const id = Number(ctx.params.id)
    const before = await ctx.env.DB.prepare('SELECT * FROM obituaries WHERE id = ?').bind(id).first<Record<string, unknown>>()
    if (!before) throw new HttpError(404, 'No encontrado')
    const b = await ctx.body()
    const map: Record<string, string> = { name: 'name', deathDate: 'death_date', message: 'message', serviceInfo: 'service_info' }
    const sets: string[] = []
    const binds: unknown[] = []
    for (const [k, col] of Object.entries(map)) {
      if (b[k] === undefined) continue
      if (k === 'deathDate' && b[k] && !/^\d{4}-\d{2}-\d{2}$/.test(String(b[k]))) throw new HttpError(400, 'La fecha debe ser AAAA-MM-DD')
      sets.push(`${col} = ?`)
      binds.push(b[k] === '' ? null : str(b[k], k, { max: 2000, optional: true }) || null)
    }
    if (!sets.length) throw new HttpError(400, 'Nada para actualizar')
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(`UPDATE obituaries SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id),
      historyStatement(ctx.env.DB, { entityType: 'obituary', entityId: id, action: 'edited', actor: actorOf(admin), before, after: b }, ctx.now),
    ])
    return json({ ok: true })
  })

  // Aprobación humana obligatoria: nombre y fecha deben estar cargados y validados por una persona.
  r.post('/api/admin/obituaries/:id/approve', async (ctx) => {
    const admin = requirePermission(ctx, 'obituary:approve')
    const id = Number(ctx.params.id)
    const o = await ctx.env.DB.prepare('SELECT * FROM obituaries WHERE id = ?').bind(id).first<{ id: number; post_id: number | null; name: string; death_date: string | null; state: string }>()
    if (!o) throw new HttpError(404, 'No encontrado')
    if (o.state !== 'pending') throw new HttpError(409, 'Solo se aprueban obituarios pendientes')
    if (!o.name.trim()) throw new HttpError(422, 'Falta confirmar el nombre de la persona')
    if (!o.death_date) throw new HttpError(422, 'Falta confirmar la fecha de fallecimiento')
    const stmts = [
      ctx.env.DB.prepare("UPDATE obituaries SET state = 'approved', approved_by = ?, approved_at = ? WHERE id = ?").bind(admin.id, ctx.now.toISOString(), id),
      historyStatement(ctx.env.DB, { entityType: 'obituary', entityId: id, action: 'approved', actor: actorOf(admin) }, ctx.now),
    ]
    if (o.post_id) {
      // Pasa al feed general con enlace a la fuente y queda confirmada la categoría Obituarios.
      stmts.push(
        ctx.env.DB.prepare("UPDATE posts SET status = 'published', review_state = 'approved' WHERE id = ?").bind(o.post_id),
        ctx.env.DB.prepare("INSERT INTO post_categories (post_id, category_id, confidence, proposed_by, confirmed, reasons_json) VALUES (?, 'obituarios', 1, 'editor', 1, '[]') ON CONFLICT(post_id, category_id) DO UPDATE SET confirmed = 1").bind(o.post_id),
      )
    }
    await ctx.env.DB.batch(stmts)
    const n = o.post_id ? await enqueuePost(ctx.env.DB, o.post_id, ctx.now) : null
    return json({ ok: true, notification: n })
  })

  r.post('/api/admin/obituaries/:id/reject', async (ctx) => {
    const admin = requirePermission(ctx, 'obituary:approve')
    const id = Number(ctx.params.id)
    const o = await ctx.env.DB.prepare('SELECT post_id FROM obituaries WHERE id = ?').bind(id).first<{ post_id: number | null }>()
    if (!o) throw new HttpError(404, 'No encontrado')
    await ctx.env.DB.batch([
      ctx.env.DB.prepare("UPDATE obituaries SET state = 'rejected' WHERE id = ? AND state = 'pending'").bind(id),
      // No era un aviso fúnebre: la publicación vuelve a la cola general de revisión (sigue oculta hasta decidir).
      ctx.env.DB.prepare("UPDATE posts SET review_state = 'needs_review' WHERE id = ? AND status = 'pending'").bind(o.post_id ?? -1),
      historyStatement(ctx.env.DB, { entityType: 'obituary', entityId: id, action: 'rejected', actor: actorOf(admin) }, ctx.now),
    ])
    return json({ ok: true })
  })

  // Rectificación pública de un obituario ya aprobado.
  r.post('/api/admin/obituaries/:id/rectify', async (ctx) => {
    const admin = requirePermission(ctx, 'obituary:approve')
    const id = Number(ctx.params.id)
    const note = str((await ctx.body()).note, 'note', { max: 1000 })
    const res = await ctx.env.DB.prepare("UPDATE obituaries SET rectification = ? WHERE id = ? AND state = 'approved'").bind(note, id).run()
    if (!res.meta.changes) throw new HttpError(404, 'No hay obituario aprobado con ese id')
    await historyStatement(ctx.env.DB, { entityType: 'obituary', entityId: id, action: 'rectified', actor: actorOf(admin), note }, ctx.now).run()
    return json({ ok: true })
  })

  // Eliminación: se retira de la vista pública (y del feed) conservando el historial.
  const retract = async (ctx: Ctx) => {
    const admin = requirePermission(ctx, 'obituary:approve')
    const id = Number(ctx.params.id)
    const o = await ctx.env.DB.prepare('SELECT post_id FROM obituaries WHERE id = ?').bind(id).first<{ post_id: number | null }>()
    if (!o) throw new HttpError(404, 'No encontrado')
    await ctx.env.DB.batch([
      ctx.env.DB.prepare("UPDATE obituaries SET state = 'retracted' WHERE id = ?").bind(id),
      ctx.env.DB.prepare("UPDATE posts SET status = 'deleted', deleted_at = ? WHERE id = ?").bind(ctx.now.toISOString(), o.post_id ?? -1),
      historyStatement(ctx.env.DB, { entityType: 'obituary', entityId: id, action: 'retracted', actor: actorOf(admin) }, ctx.now),
    ])
    return json({ ok: true })
  }
  r.post('/api/admin/obituaries/:id/retract', retract)
  r.delete('/api/admin/obituaries/:id', retract)

  // ----------------------------------------------------------------- alertas
  r.get('/api/admin/alerts', async (ctx) => {
    requirePermission(ctx, 'content:read')
    const c = ctx.url.searchParams.get('estado')
    return json((await ctx.env.DB.prepare(`SELECT * FROM alerts ${c ? 'WHERE confirmation = ?' : ''} ORDER BY id DESC LIMIT 200`).bind(...(c ? [c] : [])).all()).results)
  })

  r.post('/api/admin/alerts', async (ctx) => {
    const admin = requirePermission(ctx, 'content:write')
    const b = await ctx.body()
    const kind = str(b.kind, 'kind')
    const severity = str(b.severity ?? 'info', 'severity')
    if (!['agua', 'energia', 'calles', 'meteorologica', 'comunicado'].includes(kind)) throw new HttpError(400, 'Tipo de alerta inválido')
    if (!['info', 'urgente'].includes(severity)) throw new HttpError(400, 'Severidad inválida')
    const res = await ctx.env.DB.prepare(
      `INSERT INTO alerts (kind, severity, priority, title, body, source_url, starts_at, expires_at, confirmation, created_at) VALUES (?,?,?,?,?,?,?,?, 'proposed', ?)`,
    )
      .bind(kind, severity, Number(b.priority) || (severity === 'urgente' ? 2 : 0), str(b.title, 'title', { max: 200 }), str(b.body, 'body', { max: 2000 }), httpUrl(b.sourceUrl, 'sourceUrl', true), b.startsAt ? isoDate(b.startsAt, 'startsAt') : ctx.now.toISOString(), b.expiresAt ? isoDate(b.expiresAt, 'expiresAt') : null, ctx.now.toISOString())
      .run()
    const id = Number(res.meta.last_row_id)
    await historyStatement(ctx.env.DB, { entityType: 'alert', entityId: id, action: 'created', actor: actorOf(admin) }, ctx.now).run()
    // Publicar al crear exige el permiso de confirmación; las urgentes, el permiso específico (habilita avisos masivos).
    if (b.confirm === true) {
      requirePermission(ctx, severity === 'urgente' ? 'alert:confirm-urgent' : 'alert:confirm')
      await ctx.env.DB.batch([
        ctx.env.DB.prepare("UPDATE alerts SET confirmation = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE id = ?").bind(admin.id, ctx.now.toISOString(), id),
        historyStatement(ctx.env.DB, { entityType: 'alert', entityId: id, action: 'confirmed', actor: actorOf(admin) }, ctx.now),
      ])
      await enqueueAlert(ctx.env.DB, id, ctx.now)
    }
    return json({ id, confirmed: b.confirm === true }, { status: 201 })
  })

  r.patch('/api/admin/alerts/:id', async (ctx) => {
    const admin = requirePermission(ctx, 'content:write')
    const id = Number(ctx.params.id)
    const b = await ctx.body()
    const before = await ctx.env.DB.prepare('SELECT * FROM alerts WHERE id = ?').bind(id).first<{ severity: string; confirmation: string }>()
    if (!before) throw new HttpError(404, 'No encontrada')
    if (before.confirmation === 'confirmed' && (b.severity === 'urgente' || before.severity === 'urgente') && !can(admin.role, 'alert:confirm-urgent')) throw new HttpError(403, 'No tenés permiso')
    const sets: string[] = []
    const binds: unknown[] = []
    const fields: Record<string, (v: unknown) => unknown> = {
      title: (v) => str(v, 'title', { max: 200 }),
      body: (v) => str(v, 'body', { max: 2000 }),
      priority: (v) => Math.min(Math.max(Number(v) || 0, 0), 3),
      expires_at: (v) => (v ? isoDate(v, 'expires_at') : null),
      severity: (v) => { if (!['info', 'urgente'].includes(String(v))) throw new HttpError(400, 'Severidad inválida'); return String(v) },
    }
    for (const [k, fn] of Object.entries(fields)) if (b[k] !== undefined) { sets.push(`${k} = ?`); binds.push(fn(b[k])) }
    if (b.severity !== undefined && before.confirmation === 'confirmed' && b.severity !== before.severity) {
      // Cambiar la severidad de una alerta ya publicada exige volver a confirmarla.
      sets.push("confirmation = 'proposed'")
    }
    if (!sets.length) throw new HttpError(400, 'Nada para actualizar')
    await ctx.env.DB.batch([ctx.env.DB.prepare(`UPDATE alerts SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id), historyStatement(ctx.env.DB, { entityType: 'alert', entityId: id, action: 'edited', actor: actorOf(admin), before, after: b }, ctx.now)])
    return json({ ok: true })
  })

  r.post('/api/admin/alerts/:id/confirm', async (ctx) => {
    const id = Number(ctx.params.id)
    const a = await ctx.env.DB.prepare('SELECT severity, confirmation FROM alerts WHERE id = ?').bind(id).first<{ severity: string; confirmation: string }>()
    if (!a) throw new HttpError(404, 'No encontrada')
    // Las urgentes requieren el permiso específico: habilita notificaciones masivas.
    const admin = requirePermission(ctx, a.severity === 'urgente' ? 'alert:confirm-urgent' : 'alert:confirm')
    if (a.confirmation === 'confirmed') throw new HttpError(409, 'La alerta ya está confirmada')
    await ctx.env.DB.batch([
      ctx.env.DB.prepare("UPDATE alerts SET confirmation = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE id = ?").bind(admin.id, ctx.now.toISOString(), id),
      historyStatement(ctx.env.DB, { entityType: 'alert', entityId: id, action: 'confirmed', actor: actorOf(admin) }, ctx.now),
    ])
    const n = await enqueueAlert(ctx.env.DB, id, ctx.now)
    return json({ ok: true, notification: n })
  })

  r.post('/api/admin/alerts/:id/dismiss', async (ctx) => {
    const admin = requirePermission(ctx, 'alert:confirm')
    const id = Number(ctx.params.id)
    await ctx.env.DB.batch([ctx.env.DB.prepare("UPDATE alerts SET confirmation = 'dismissed' WHERE id = ?").bind(id), historyStatement(ctx.env.DB, { entityType: 'alert', entityId: id, action: 'dismissed', actor: actorOf(admin) }, ctx.now)])
    return json({ ok: true })
  })

  // ---------------------------------------------------- conectores y sincronización
  r.get('/api/admin/sources', async (ctx) => {
    requirePermission(ctx, 'sources:read')
    const rows = await ctx.env.DB.prepare('SELECT * FROM sources ORDER BY id').all<SourceRow>()
    return json(
      rows.results.map((s) => {
        const connector = s.kind === 'manual' ? null : (deps.connectors ?? defaultConnectors)[s.kind]
        const readiness = connector?.readiness(ctx.env, s) ?? { ready: s.kind === 'manual', missing: [] }
        return { ...s, readiness, automatic: s.mode === 'api' && s.enabled === 1 && readiness.ready }
      }),
    )
  })

  r.patch('/api/admin/sources/:id', async (ctx) => {
    const admin = requirePermission(ctx, 'sources:manage')
    const s = await getSource(ctx, ctx.params.id)
    const b = await ctx.body()
    const sets: string[] = []
    const binds: unknown[] = []
    if (b.enabled !== undefined) { sets.push('enabled = ?'); binds.push(b.enabled ? 1 : 0) }
    if (b.mode !== undefined) {
      if (!['api', 'assisted', 'manual'].includes(String(b.mode))) throw new HttpError(400, 'Modo inválido')
      sets.push('mode = ?'); binds.push(String(b.mode))
    }
    if (b.pollIntervalSeconds !== undefined) {
      const n = Number(b.pollIntervalSeconds)
      if (!Number.isInteger(n) || n < 60 || n > 86_400) throw new HttpError(400, 'El intervalo debe estar entre 60 y 86400 segundos')
      sets.push('poll_interval_seconds = ?'); binds.push(n)
    }
    if (b.config !== undefined) {
      if (!b.config || typeof b.config !== 'object' || Array.isArray(b.config)) throw new HttpError(400, '«config» debe ser un objeto')
      const bad = Object.keys(b.config).find((k) => SECRET_KEY_PATTERN.test(k))
      if (bad) throw new HttpError(400, `«${bad}» parece un secreto: los secretos se cargan con wrangler secret, no en la base de datos`)
      sets.push('config_json = ?'); binds.push(JSON.stringify(b.config))
    }
    if (!sets.length) throw new HttpError(400, 'Nada para actualizar')
    // Al reconfigurar se levanta el retroceso para reintentar de inmediato.
    sets.push('next_attempt_at = NULL', 'consecutive_failures = 0')
    await ctx.env.DB.batch([ctx.env.DB.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, s.id), historyStatement(ctx.env.DB, { entityType: 'source', entityId: s.id, action: 'configured', actor: actorOf(admin), after: { ...b } }, ctx.now)])
    return json({ ok: true })
  })

  r.post('/api/admin/sources/:id/sync-now', async (ctx) => {
    requirePermission(ctx, 'sources:manage')
    const s = await getSource(ctx, ctx.params.id)
    if (s.kind === 'manual') throw new HttpError(400, 'La fuente manual no se sincroniza')
    return json(await syncSource(ctx.env, { ...s, enabled: 1 }, ctx.now, deps))
  })

  r.get('/api/admin/sync-runs', async (ctx) => {
    requirePermission(ctx, 'sources:read')
    const src = ctx.url.searchParams.get('fuente')
    const onlyErrors = ctx.url.searchParams.get('errores') === '1'
    const where = [src ? 'source_id = ?' : '', onlyErrors ? "outcome != 'success'" : ''].filter(Boolean)
    return json((await ctx.env.DB.prepare(`SELECT * FROM sync_runs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 100`).bind(...(src ? [src] : [])).all()).results)
  })

  if (features.push) r.get('/api/admin/notifications', async (ctx) => {
    requirePermission(ctx, 'content:read')
    const [log, subs] = await Promise.all([
      ctx.env.DB.prepare('SELECT * FROM notification_log ORDER BY id DESC LIMIT 100').all(),
      ctx.env.DB.prepare('SELECT COUNT(*) AS total, SUM(active) AS active FROM push_subscriptions').first(),
    ])
    return json({ configured: pushConfigured(ctx.env), subscriptions: subs, log: log.results })
  })

  if (features.push) r.post('/api/admin/notifications/process', async (ctx) => {
    requirePermission(ctx, 'sources:manage')
    return json(await processNotifications(ctx.env.DB, createVapidSender(ctx.env), ctx.now))
  })

  r.get('/api/admin/history', async (ctx) => {
    requirePermission(ctx, 'content:read')
    const type = ctx.url.searchParams.get('tipo')
    const id = ctx.url.searchParams.get('id')
    const where = [type ? 'entity_type = ?' : '', id ? 'entity_id = ?' : ''].filter(Boolean)
    return json((await ctx.env.DB.prepare(`SELECT * FROM editorial_history ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 100`).bind(...[type, id].filter((x): x is string => !!x)).all()).results)
  })

  // ---------------------------------------------------------------- usuarios
  r.get('/api/admin/users', async (ctx) => {
    requirePermission(ctx, 'users:manage')
    return json((await ctx.env.DB.prepare('SELECT id, email, display_name, role, active, last_login_at, created_at FROM admins ORDER BY id').all()).results)
  })

  r.post('/api/admin/users', async (ctx) => {
    const admin = requirePermission(ctx, 'users:manage')
    const b = await ctx.body()
    const role = str(b.role, 'role')
    if (!['admin', 'editor', 'viewer'].includes(role)) throw new HttpError(400, 'Rol inválido')
    const email = str(b.email, 'email', { max: 200 }).toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Correo inválido')
    const hash = await hashPassword(str(b.password, 'password', { max: 200 }))
    try {
      const res = await ctx.env.DB.prepare('INSERT INTO admins (email, display_name, role, password_hash, created_at) VALUES (?,?,?,?,?)').bind(email, str(b.displayName ?? email, 'displayName', { max: 100 }), role, hash, ctx.now.toISOString()).run()
      const id = Number(res.meta.last_row_id)
      await historyStatement(ctx.env.DB, { entityType: 'admin', entityId: id, action: 'created', actor: actorOf(admin), after: { email, role } }, ctx.now).run()
      return json({ id }, { status: 201 })
    } catch (e) {
      if (e instanceof Error && /UNIQUE/i.test(e.message)) throw new HttpError(409, 'Ya existe un usuario con ese correo')
      throw e
    }
  })

  r.patch('/api/admin/users/:id', async (ctx) => {
    const admin = requirePermission(ctx, 'users:manage')
    const id = Number(ctx.params.id)
    const b = await ctx.body()
    const target = await ctx.env.DB.prepare('SELECT id, role, active FROM admins WHERE id = ?').bind(id).first<{ id: number; role: string; active: number }>()
    if (!target) throw new HttpError(404, 'No encontrado')
    const sets: string[] = []
    const binds: unknown[] = []
    if (b.role !== undefined) { if (!['admin', 'editor', 'viewer'].includes(String(b.role))) throw new HttpError(400, 'Rol inválido'); sets.push('role = ?'); binds.push(String(b.role)) }
    if (b.active !== undefined) { sets.push('active = ?'); binds.push(b.active ? 1 : 0) }
    if (b.password !== undefined) { sets.push('password_hash = ?', 'failed_attempts = 0', 'locked_until = NULL'); binds.push(await hashPassword(String(b.password))) }
    if (!sets.length) throw new HttpError(400, 'Nada para actualizar')
    // Nunca dejar el sistema sin administradores activos.
    if (target.role === 'admin' && ((b.role && b.role !== 'admin') || b.active === false)) {
      const others = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM admins WHERE role = 'admin' AND active = 1 AND id != ?").bind(id).first<{ n: number }>()
      if (!others?.n) throw new HttpError(409, 'Debe quedar al menos un administrador activo')
    }
    const stmts = [ctx.env.DB.prepare(`UPDATE admins SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id), historyStatement(ctx.env.DB, { entityType: 'admin', entityId: id, action: 'updated', actor: actorOf(admin), after: { role: b.role, active: b.active, passwordChanged: b.password !== undefined } }, ctx.now)]
    if (b.active === false || b.password !== undefined) stmts.push(ctx.env.DB.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').bind(id))
    await ctx.env.DB.batch(stmts)
    return json({ ok: true })
  })

  // ---------------------------------------------------------------- cuenta y panel
  // Cambio de contraseña propio (cualquier rol). Cierra las demás sesiones de la cuenta.
  r.post('/api/admin/password', async (ctx) => {
    const admin = requirePermission(ctx, 'content:read')
    const b = await ctx.body()
    const current = str(b.currentPassword, 'currentPassword', { max: 200 })
    const next = str(b.newPassword, 'newPassword', { max: 200 })
    const row = await ctx.env.DB.prepare('SELECT password_hash FROM admins WHERE id = ?').bind(admin.id).first<{ password_hash: string }>()
    if (!row || !(await verifyPassword(current, row.password_hash))) throw new HttpError(403, 'La contraseña actual no es correcta')
    if (next === current) throw new HttpError(400, 'La contraseña nueva debe ser distinta de la actual')
    const hash = await hashPassword(next)
    const token = readCookie(ctx.req, SESSION_COOKIE)
    await ctx.env.DB.batch([
      ctx.env.DB.prepare('UPDATE admins SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').bind(hash, admin.id),
      ctx.env.DB.prepare('DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash != ?').bind(admin.id, token ? await sha256Hex(token) : ''),
      historyStatement(ctx.env.DB, { entityType: 'admin', entityId: admin.id, action: 'password-changed', actor: actorOf(admin) }, ctx.now),
    ])
    return json({ ok: true })
  })

  r.get('/api/admin/dashboard', async (ctx) => {
    requirePermission(ctx, 'content:read')
    const db = ctx.env.DB
    const now = ctx.now.toISOString()
    const [byStatus, review, alertsActive, alertsProposed, eventsUpcoming, nextEvents, obits, history, sources] = await Promise.all([
      db.prepare('SELECT status, COUNT(*) AS n FROM posts GROUP BY status').all<{ status: string; n: number }>(),
      db.prepare("SELECT COUNT(*) AS n FROM posts WHERE review_state = 'needs_review' AND status IN ('published','pending','draft')").first<{ n: number }>(),
      db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE confirmation = 'confirmed' AND starts_at <= ? AND (expires_at IS NULL OR expires_at > ?)").bind(now, now).first<{ n: number }>(),
      db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE confirmation = 'proposed'").first<{ n: number }>(),
      db.prepare('SELECT COUNT(*) AS n FROM events WHERE published = 1 AND COALESCE(ends_at, starts_at) >= ?').bind(now).first<{ n: number }>(),
      db.prepare('SELECT id, title, starts_at FROM events WHERE published = 1 AND COALESCE(ends_at, starts_at) >= ? ORDER BY starts_at LIMIT 5').bind(now).all(),
      db.prepare("SELECT COUNT(*) AS n FROM obituaries WHERE state = 'pending'").first<{ n: number }>(),
      db.prepare('SELECT entity_type, entity_id, action, actor_label, note, at FROM editorial_history ORDER BY id DESC LIMIT 10').all(),
      db.prepare('SELECT * FROM sources ORDER BY id').all<SourceRow>(),
    ])
    const posts = Object.fromEntries(byStatus.results.map((r) => [r.status, r.n]))
    return json({
      posts: { published: posts.published ?? 0, draft: posts.draft ?? 0, pending: posts.pending ?? 0, rejected: posts.rejected ?? 0, withdrawn: posts.deleted ?? 0, needsReview: review?.n ?? 0 },
      alerts: { active: alertsActive?.n ?? 0, proposed: alertsProposed?.n ?? 0 },
      events: { upcoming: eventsUpcoming?.n ?? 0, next: nextEvents.results },
      obituaries: { pending: obits?.n ?? 0 },
      history: history.results,
      sources: sources.results.map((s) => {
        const connector = s.kind === 'manual' ? null : (deps.connectors ?? defaultConnectors)[s.kind]
        const readiness = connector?.readiness(ctx.env, s) ?? { ready: s.kind === 'manual', missing: [] }
        return { id: s.id, name: s.name, kind: s.kind, mode: s.mode, enabled: !!s.enabled, status: s.status, readiness, lastSuccessAt: s.last_success_at, lastCheckedAt: s.last_checked_at, nextAttemptAt: s.next_attempt_at, lastError: s.last_error }
      }),
      generatedAt: now,
    })
  })

  crudRoutes(r, features)
}

export { assertCsrf, SYSTEM_ACTOR }
