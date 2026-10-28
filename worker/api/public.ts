import { CATEGORY_IDS, isCategoryId, isPushTopic } from '../../shared/categories'
import { truncate } from '../../shared/text'
import type { Features } from '../features'
import { HttpError, json, Router, str, type Ctx } from '../http'

/** Revalida rápido (el contenido editorial debe verse enseguida) pero evita golpear D1 en cada visita. */
const CACHE = { 'cache-control': 'public, max-age=15, stale-while-revalidate=60' }

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
    return json(rows.results, { headers: CACHE })
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
      `SELECT p.id, p.title, p.body, p.url, p.source_label, p.published_at, p.origin, p.review_state, p.rectified_at, p.rectification, p.media_json,
              s.name AS source_name, s.url AS source_url
       FROM posts p JOIN sources s ON s.id = p.source_id WHERE ${where.join(' AND ')} ORDER BY p.published_at DESC, p.id DESC LIMIT ?`,
    )
      .bind(...binds, limit)
      .all<PostRow>()
    const cats = await categoriesFor(ctx, rows.results.map((p) => p.id))
    return json(rows.results.map((p) => postDto(p, cats.get(p.id) ?? [])), { headers: CACHE })
  })

  // Alertas vigentes: SOLO las confirmadas por una persona y no vencidas.
  r.get('/api/public/alerts', async (ctx) => {
    const rows = await ctx.env.DB.prepare(
      `SELECT id, kind, severity, priority, title, body, source_url, starts_at, expires_at FROM alerts
       WHERE confirmation = 'confirmed' AND starts_at <= ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY priority DESC, starts_at DESC`,
    )
      .bind(ctx.now.toISOString(), ctx.now.toISOString())
      .all<{ id: number; kind: string; severity: 'info' | 'urgente'; priority: number; title: string; body: string; source_url: string | null; starts_at: string; expires_at: string | null }>()
    return json(
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
      })),
      { headers: CACHE },
    )
  })

  // Obituarios: solo aprobados por una persona; retractados desaparecen.
  r.get('/api/public/obituaries', async (ctx) => {
    const rows = await ctx.env.DB.prepare(
      `SELECT id, name, death_date, message, service_info, source_url, approved_at, rectification FROM obituaries
       WHERE state = 'approved' ORDER BY approved_at DESC LIMIT 100`,
    ).all<{ id: number; name: string; death_date: string | null; message: string | null; service_info: string | null; source_url: string | null; approved_at: string; rectification: string | null }>()
    return json(
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
      { headers: CACHE },
    )
  })

  r.get('/api/public/events', async (ctx) => {
    const rows = await ctx.env.DB.prepare(
      `SELECT id, title, description, starts_at, place_text, category, source_label, source_url FROM events
       WHERE published = 1 AND COALESCE(ends_at, starts_at) >= ? ORDER BY starts_at`,
    )
      .bind(new Date(ctx.now.getTime() - 24 * 3_600_000).toISOString())
      .all<{ id: number; title: string; description: string | null; starts_at: string; place_text: string | null; category: string; source_label: string; source_url: string }>()
    return json(
      rows.results.map((e) => ({
        id: String(e.id),
        title: e.title,
        description: e.description ?? undefined,
        startsAt: e.starts_at,
        place: e.place_text ?? undefined,
        category: e.category,
        source: { label: e.source_label, url: e.source_url },
      })),
      { headers: CACHE },
    )
  })

  if (features.staticModules) {
    // Contratos preparados, NO activos en producción: lugares, radios y transporte siguen en JSON validado.
    r.get('/api/public/radios', async (ctx) => {
      const rows = await ctx.env.DB.prepare('SELECT id, name, frequency, site_url, tagline FROM radios WHERE active = 1 ORDER BY name').all<{ id: string; name: string; frequency: string; site_url: string; tagline: string | null }>()
      return json(rows.results.map((x) => ({ id: x.id, name: x.name, frequency: x.frequency, siteUrl: x.site_url, tagline: x.tagline ?? undefined })), { headers: CACHE })
    })
    r.get('/api/public/places', async (ctx) => {
      const rows = await ctx.env.DB.prepare('SELECT id, kind, name, address, phone, hours, url, notes FROM places WHERE active = 1 ORDER BY kind, name').all()
      return json(rows.results, { headers: CACHE })
    })
    r.get('/api/public/transport', async (ctx) => {
      const db = ctx.env.DB
      const [companies, localities, stops, services] = await Promise.all([
        db.prepare('SELECT id, name FROM bus_companies ORDER BY name').all<{ id: string; name: string }>(),
        db.prepare('SELECT id, name, status, reference_url FROM bus_localities ORDER BY name').all<{ id: string; name: string; status: string; reference_url: string | null }>(),
        db.prepare('SELECT id, name, locality_id FROM bus_stops ORDER BY name').all<{ id: string; name: string; locality_id: string }>(),
        db.prepare('SELECT * FROM bus_services ORDER BY departure').all<Record<string, string | number | null>>(),
      ])
      return json(
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
        { headers: CACHE },
      )
    })
  }

  if (features.push) {
    // ---- Web Push (consentimiento explícito del usuario: el navegador solo suscribe tras aceptar el permiso) ----
    r.get('/api/public/push/config', (ctx) =>
      json({ enabled: !!(ctx.env.VAPID_PUBLIC_KEY && ctx.env.VAPID_PRIVATE_KEY_JWK && ctx.env.VAPID_SUBJECT), publicKey: ctx.env.VAPID_PUBLIC_KEY ?? null, topics: [...CATEGORY_IDS, 'urgente'] }),
    )

    r.post('/api/public/push/subscribe', async (ctx) => {
      const b = await ctx.body()
      const endpoint = str(b.endpoint, 'endpoint', { max: 1024 })
      if (!endpoint.startsWith('https://')) throw new HttpError(400, 'Endpoint inválido')
      const keys = (b.keys ?? {}) as Record<string, unknown>
      const p256dh = str(keys.p256dh, 'keys.p256dh', { max: 256 })
      const auth = str(keys.auth, 'keys.auth', { max: 128 })
      const topics = Array.isArray(b.topics) ? [...new Set(b.topics.filter((t): t is string => typeof t === 'string' && isPushTopic(t)))] : []
      if (!topics.length) throw new HttpError(400, 'Elegí al menos un tema')
      await ctx.env.DB.prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, topics_json, active, failure_count, created_at) VALUES (?,?,?,?,1,0,?)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, topics_json = excluded.topics_json, active = 1, failure_count = 0`,
      )
        .bind(endpoint, p256dh, auth, JSON.stringify(topics), ctx.now.toISOString())
        .run()
      return json({ ok: true, topics })
    })

    r.post('/api/public/push/unsubscribe', async (ctx) => {
      const b = await ctx.body()
      await ctx.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(str(b.endpoint, 'endpoint', { max: 1024 })).run()
      return json({ ok: true })
    })

    r.get('/api/public/notifications/latest', async (ctx) => {
      const row = await ctx.env.DB.prepare(
        `SELECT title, body, url, urgent FROM notification_log WHERE state IN ('sending','done') AND created_at > ? ORDER BY id DESC LIMIT 1`,
      )
        .bind(new Date(ctx.now.getTime() - 24 * 3_600_000).toISOString())
        .first<{ title: string; body: string; url: string; urgent: number }>()
      return json(row ? { title: row.title, body: row.body, url: row.url, urgent: !!row.urgent } : { title: 'Río Seco Conecta', body: 'Hay novedades en tu comunidad.', url: '/', urgent: false })
    })
  }
}
