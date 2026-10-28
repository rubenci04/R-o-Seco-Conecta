import { isCategoryId } from '../../shared/categories'
import { pushRoutes } from './push'
import { truncate } from '../../shared/text'
import type { Features } from '../features'
import { etagJson, HttpError, json, Router, type Ctx } from '../http'

interface PostRow {
  id: number
  title: string
  body: string
  url: string | null
  source_label: string | null
  published_at: string
  source_name: string
  source_url: string | null
  origin: 'api' | 'assisted' | 'manual'
  review_state: 'unreviewed' | 'needs_review' | 'approved' | 'rejected'
  rectified_at: string | null
  rectification: string | null
  media_json: string
  link_only: number
  date_verified: number
  historical: number
  content_type: string | null
}

/**
 * DTO público de una publicación (compatible con `newsItemSchema` del frontend).
 * `verified` = una persona de la redacción revisó/aprobó el contenido. NO es verdadero por defecto:
 * lo importado automáticamente sin revisión se muestra como «sin revisión editorial» pero con su fuente.
 */
export const postDto = (p: PostRow, categories: string[]) => ({
  id: String(p.id),
  title: p.title,
  summary: truncate(p.body, 280),
  body: p.body,
  publishedAt: p.published_at,
  source: { label: p.source_label || p.source_name, url: p.url ?? p.source_url ?? undefined },
  origin: p.origin,
  verified: p.review_state === 'approved',
  categories,
  rectification: p.rectification ?? undefined,
  rectifiedAt: p.rectified_at ?? undefined,
  media: JSON.parse(p.media_json) as string[],
  // Tarjeta de una publicación externa: sin texto propio, con enlace y (opcionalmente) contenido embebido oficial.
  linkOnly: p.link_only === 1,
  dateVerified: p.date_verified === 1,
  historical: p.historical === 1,
  contentType: p.content_type ?? undefined,
})

async function categoriesFor(ctx: Ctx, ids: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>()
  if (!ids.length) return map
  const rows = await ctx.env.DB.prepare(`SELECT post_id, category_id FROM post_categories WHERE post_id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ post_id: number; category_id: string }>()
  for (const r of rows.results) map.set(r.post_id, [...(map.get(r.post_id) ?? []), r.category_id])
  return map
}

export function publicRoutes(r: Router, features: Features): void {
  // Comprobación de salud sin datos sensibles (sirve para verificar el despliegue y el enlace con D1).
  r.get('/api/health', async (ctx) => {
    const row = await ctx.env.DB.prepare('SELECT COUNT(*) AS categories FROM categories').first<{ categories: number }>()
    return json({ ok: true, database: row ? 'ok' : 'error', now: ctx.now.toISOString() })
  })

  r.get('/api/public/categories', async (ctx) => {
    const rows = await ctx.env.DB.prepare('SELECT id, name, description FROM categories ORDER BY sort_order').all()
    return etagJson(ctx, rows.results)
  })

  // Feed general (todas las publicaciones visibles) o filtrado por una categoría. Paginado por fecha (`antes`).
  r.get('/api/public/feed', async (ctx) => {
    const category = ctx.url.searchParams.get('categoria')
    if (category && !isCategoryId(category)) throw new HttpError(400, 'Categoría desconocida')
    const limit = Math.min(Math.max(Number(ctx.url.searchParams.get('limite')) || 20, 1), 50)
    const before = ctx.url.searchParams.get('antes')
    if (before && Number.isNaN(Date.parse(before))) throw new HttpError(400, 'Cursor «antes» inválido')
    const where = ["p.status = 'published'"]
    const binds: unknown[] = []
    if (category) {
      where.push('EXISTS (SELECT 1 FROM post_categories pc WHERE pc.post_id = p.id AND pc.category_id = ?)')
      binds.push(category)
    }
    if (before) {
      where.push('p.published_at < ?')
      binds.push(before)
    }
    const rows = await ctx.env.DB.prepare(
      `SELECT p.id, p.title, p.body, p.url, p.source_label, p.published_at, p.origin, p.review_state, p.rectified_at, p.rectification, p.media_json, p.link_only, p.date_verified, p.historical, p.content_type,
              s.name AS source_name, s.url AS source_url
       FROM posts p JOIN sources s ON s.id = p.source_id WHERE ${where.join(' AND ')} ORDER BY p.published_at DESC, p.id DESC LIMIT ?`,
    )
      .bind(...binds, limit)
      .all<PostRow>()
    const cats = await categoriesFor(ctx, rows.results.map((p) => p.id))
    return etagJson(ctx, rows.results.map((p) => postDto(p, cats.get(p.id) ?? [])))
  })

  // Alertas vigentes: SOLO las confirmadas por una persona y no vencidas.
  r.get('/api/public/alerts', async (ctx) => {
    const rows = await ctx.env.DB.prepare(
      `SELECT id, kind, severity, priority, title, body, source_url, starts_at, expires_at,
              (SELECT group_concat(category_id) FROM post_categories pc WHERE pc.post_id = alerts.post_id) AS cats FROM alerts
       WHERE confirmation = 'confirmed' AND starts_at <= ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY priority DESC, starts_at DESC`,
    )
      .bind(ctx.now.toISOString(), ctx.now.toISOString())
      .all<{ id: number; kind: string; severity: 'info' | 'urgente'; priority: number; title: string; body: string; source_url: string | null; starts_at: string; expires_at: string | null; cats: string | null }>()
    return etagJson(
      ctx,
      rows.results.map((a) => ({
        id: String(a.id),
        title: a.title,
        body: a.body,
        severity: a.severity === 'urgente' ? 'urgente' : 'info',
        publishedAt: a.starts_at,
        expiresAt: a.expires_at ?? undefined,
        source: { label: 'Comuna de Río Seco', url: a.source_url ?? undefined },
        kind: a.kind,
        priority: a.priority,
        categories: a.cats ? a.cats.split(',') : [],
      })),
    )
  })

  // Obituarios: solo aprobados por una persona; retractados desaparecen.
  r.get('/api/public/obituaries', async (ctx) => {
    const rows = await ctx.env.DB.prepare(
      `SELECT id, name, death_date, message, service_info, source_url, approved_at, rectification FROM obituaries
       WHERE state = 'approved' ORDER BY approved_at DESC LIMIT 100`,
    ).all<{ id: number; name: string; death_date: string | null; message: string | null; service_info: string | null; source_url: string | null; approved_at: string; rectification: string | null }>()
    return etagJson(
      ctx,
      rows.results.map((o) => ({
        id: String(o.id),
        name: o.name,
        message: o.message ?? undefined,
        date: o.death_date ?? o.approved_at.slice(0, 10),
        service: o.service_info ?? undefined,
        source: { label: 'Comuna de Río Seco', url: o.source_url ?? undefined },
        verified: true,
        rectification: o.rectification ?? undefined,
      })),
    )
  })

  r.get('/api/public/events', async (ctx) => {
    const rows = await ctx.env.DB.prepare(
      `SELECT id, title, description, starts_at, place_text, category, source_label, source_url FROM events
       WHERE published = 1 AND COALESCE(ends_at, starts_at) >= ? ORDER BY starts_at`,
    )
      .bind(new Date(ctx.now.getTime() - 24 * 3_600_000).toISOString())
      .all<{ id: number; title: string; description: string | null; starts_at: string; place_text: string | null; category: string; source_label: string; source_url: string }>()
    return etagJson(
      ctx,
      rows.results.map((e) => ({
        id: String(e.id),
        title: e.title,
        description: e.description ?? undefined,
        startsAt: e.starts_at,
        place: e.place_text ?? undefined,
        category: e.category,
        source: { label: e.source_label, url: e.source_url },
      })),
    )
  })

  if (features.staticModules) {
    // Contratos preparados, NO activos en producción: lugares, radios y transporte siguen en JSON validado.
    r.get('/api/public/radios', async (ctx) => {
      const rows = await ctx.env.DB.prepare('SELECT id, name, frequency, site_url, tagline FROM radios WHERE active = 1 ORDER BY name').all<{ id: string; name: string; frequency: string; site_url: string; tagline: string | null }>()
      return etagJson(ctx, rows.results.map((x) => ({ id: x.id, name: x.name, frequency: x.frequency, siteUrl: x.site_url, tagline: x.tagline ?? undefined })))
    })
    r.get('/api/public/places', async (ctx) => {
      const rows = await ctx.env.DB.prepare('SELECT id, kind, name, address, phone, hours, url, notes FROM places WHERE active = 1 ORDER BY kind, name').all()
      return etagJson(ctx, rows.results)
    })
    r.get('/api/public/transport', async (ctx) => {
      const db = ctx.env.DB
      const [companies, localities, stops, services] = await Promise.all([
        db.prepare('SELECT id, name FROM bus_companies ORDER BY name').all<{ id: string; name: string }>(),
        db.prepare('SELECT id, name, status, reference_url FROM bus_localities ORDER BY name').all<{ id: string; name: string; status: string; reference_url: string | null }>(),
        db.prepare('SELECT id, name, locality_id FROM bus_stops ORDER BY name').all<{ id: string; name: string; locality_id: string }>(),
        db.prepare('SELECT * FROM bus_services ORDER BY departure').all<Record<string, string | number | null>>(),
      ])
      return etagJson(
        ctx,
        {
          companies: companies.results,
          localities: localities.results.map((l) => ({ id: l.id, name: l.name, status: l.status, referenceUrl: l.reference_url ?? undefined })),
          stops: stops.results.map((s) => ({ id: s.id, name: s.name, localityId: s.locality_id })),
          services: services.results.map((s) => ({
            id: s.id,
            companyId: s.company_id,
            localityId: s.locality_id,
            direction: s.direction,
            originStopId: s.origin_stop_id,
            destinationStopId: s.destination_stop_id,
            departure: s.departure,
            arrival: s.arrival ?? undefined,
            serviceType: s.service_type,
            dayTypes: JSON.parse(String(s.day_types)),
            precision: s.precision,
            source: { label: s.source_label, url: s.source_url, reuseAuthorized: s.reuse_authorized === 1 },
            lastVerified: s.last_verified,
            validFrom: s.valid_from ?? undefined,
            validTo: s.valid_to ?? undefined,
            exceptions: JSON.parse(String(s.exceptions_json)),
          })),
        },
      )
    })
  }

  // ---- Detalle de un contenido: cada notificación abre EXACTAMENTE el contenido que la originó ----
  r.get('/api/public/posts/:id', async (ctx) => {
    const id = Number(ctx.params.id)
    if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'No encontrado')
    const row = await ctx.env.DB.prepare(
      `SELECT p.id, p.title, p.body, p.url, p.source_label, p.published_at, p.origin, p.review_state, p.rectified_at, p.rectification, p.media_json, p.link_only, p.date_verified, p.historical, p.content_type,
              s.name AS source_name, s.url AS source_url
       FROM posts p JOIN sources s ON s.id = p.source_id WHERE p.id = ? AND p.status = 'published'`,
    ).bind(id).first<PostRow>()
    if (!row) throw new HttpError(404, 'La publicación no existe o ya no está disponible')
    const cats = await categoriesFor(ctx, [id])
    return etagJson(ctx, postDto(row, cats.get(id) ?? []))
  })

  // Una alerta confirmada se puede abrir aunque haya vencido (se informa si sigue vigente).
  r.get('/api/public/alerts/:id', async (ctx) => {
    const id = Number(ctx.params.id)
    if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'No encontrado')
    const a = await ctx.env.DB.prepare(
      "SELECT id, kind, severity, priority, title, body, source_url, starts_at, expires_at FROM alerts WHERE id = ? AND confirmation = 'confirmed'",
    ).bind(id).first<{ id: number; kind: string; severity: 'info' | 'urgente'; priority: number; title: string; body: string; source_url: string | null; starts_at: string; expires_at: string | null }>()
    if (!a) throw new HttpError(404, 'La alerta no existe o ya no está disponible')
    return etagJson(ctx, {
      id: String(a.id),
      title: a.title,
      body: a.body,
      severity: a.severity === 'urgente' ? 'urgente' : 'info',
      publishedAt: a.starts_at,
      expiresAt: a.expires_at ?? undefined,
      source: { label: 'Comuna de Río Seco', url: a.source_url ?? undefined },
      kind: a.kind,
      priority: a.priority,
      active: a.starts_at <= ctx.now.toISOString() && (!a.expires_at || a.expires_at > ctx.now.toISOString()),
    })
  })

  r.get('/api/public/obituaries/:id', async (ctx) => {
    const id = Number(ctx.params.id)
    if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'No encontrado')
    const o = await ctx.env.DB.prepare(
      "SELECT id, name, death_date, message, service_info, source_url, approved_at, rectification FROM obituaries WHERE id = ? AND state = 'approved'",
    ).bind(id).first<{ id: number; name: string; death_date: string | null; message: string | null; service_info: string | null; source_url: string | null; approved_at: string; rectification: string | null }>()
    if (!o) throw new HttpError(404, 'El comunicado no existe o ya no está disponible')
    return etagJson(ctx, {
      id: String(o.id),
      name: o.name,
      message: o.message ?? undefined,
      date: o.death_date ?? o.approved_at.slice(0, 10),
      service: o.service_info ?? undefined,
      source: { label: 'Comuna de Río Seco', url: o.source_url ?? undefined },
      verified: true,
      rectification: o.rectification ?? undefined,
    })
  })

  if (features.push) pushRoutes(r)
}
