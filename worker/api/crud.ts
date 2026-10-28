import { requirePermission } from '../auth'
import { historyStatement } from '../history'
import type { Features } from '../features'
import { actorOf, HttpError, httpUrl, json, Router, str } from '../http'

type ColType = 'text' | 'int' | 'bool' | 'url' | 'enum' | 'json' | 'datetime' | 'time' | 'date'
interface Col {
  name: string
  type: ColType
  required?: boolean
  values?: readonly string[]
}
interface Resource {
  table: string
  /** Segmento de URL. */
  path: string
  pk: string
  pkType: 'auto' | 'text'
  columns: Col[]
  order: string
  /** Validación adicional entre campos. */
  check?: (row: Record<string, unknown>) => void
}

const TIME = /^([0-3]\d|4[0-7]):[0-5]\d$/
const DAY_TYPES = ['weekday', 'saturday', 'sunday', 'holiday']

export const RESOURCES: Resource[] = [
  {
    table: 'events',
    path: 'events',
    pk: 'id',
    pkType: 'auto',
    order: 'starts_at DESC',
    columns: [
      { name: 'title', type: 'text', required: true },
      { name: 'description', type: 'text' },
      { name: 'starts_at', type: 'datetime', required: true },
      { name: 'ends_at', type: 'datetime' },
      { name: 'place_ref', type: 'text' },
      { name: 'place_text', type: 'text' },
      { name: 'category', type: 'enum', values: ['evento', 'festividad', 'actividad'], required: true },
      { name: 'source_label', type: 'text', required: true },
      { name: 'source_url', type: 'url', required: true },
      { name: 'published', type: 'bool' },
    ],
    check(row) {
      if (row.ends_at && String(row.ends_at) < String(row.starts_at)) throw new HttpError(400, 'El fin del evento no puede ser anterior al inicio')
    },
  },
  {
    table: 'places',
    path: 'places',
    pk: 'id',
    pkType: 'auto',
    order: 'kind, name',
    columns: [
      { name: 'kind', type: 'enum', values: ['lugar', 'institucion', 'servicio'], required: true },
      { name: 'name', type: 'text', required: true },
      { name: 'address', type: 'text' },
      { name: 'phone', type: 'text' },
      { name: 'hours', type: 'text' },
      { name: 'url', type: 'url' },
      { name: 'notes', type: 'text' },
      { name: 'active', type: 'bool' },
    ],
  },
  {
    table: 'radios',
    path: 'radios',
    pk: 'id',
    pkType: 'text',
    order: 'name',
    columns: [
      { name: 'name', type: 'text', required: true },
      { name: 'frequency', type: 'text', required: true },
      { name: 'site_url', type: 'url', required: true },
      { name: 'tagline', type: 'text' },
      { name: 'active', type: 'bool' },
    ],
  },
  { table: 'bus_companies', path: 'bus-companies', pk: 'id', pkType: 'text', order: 'name', columns: [{ name: 'name', type: 'text', required: true }] },
  {
    table: 'bus_localities',
    path: 'bus-localities',
    pk: 'id',
    pkType: 'text',
    order: 'name',
    columns: [
      { name: 'name', type: 'text', required: true },
      { name: 'status', type: 'enum', values: ['sin-datos', 'verificado'], required: true },
      { name: 'reference_url', type: 'url' },
    ],
  },
  {
    table: 'bus_stops',
    path: 'bus-stops',
    pk: 'id',
    pkType: 'text',
    order: 'name',
    columns: [
      { name: 'name', type: 'text', required: true },
      { name: 'locality_id', type: 'text', required: true },
    ],
  },
  {
    table: 'bus_services',
    path: 'bus-services',
    pk: 'id',
    pkType: 'text',
    order: 'locality_id, direction, departure',
    columns: [
      { name: 'company_id', type: 'text', required: true },
      { name: 'locality_id', type: 'text', required: true },
      { name: 'direction', type: 'enum', values: ['from-rio-seco', 'to-rio-seco'], required: true },
      { name: 'origin_stop_id', type: 'text', required: true },
      { name: 'destination_stop_id', type: 'text', required: true },
      { name: 'departure', type: 'time', required: true },
      { name: 'arrival', type: 'time' },
      { name: 'service_type', type: 'enum', values: ['común', 'semirrápido', 'rápido', 'diferencial'] },
      { name: 'day_types', type: 'json', required: true },
      { name: 'precision', type: 'enum', values: ['confirmed', 'approximate'], required: true },
      { name: 'source_label', type: 'text', required: true },
      { name: 'source_url', type: 'url', required: true },
      { name: 'reuse_authorized', type: 'bool', required: true },
      { name: 'last_verified', type: 'date', required: true },
      { name: 'valid_from', type: 'date' },
      { name: 'valid_to', type: 'date' },
      { name: 'exceptions_json', type: 'json' },
    ],
    check(row) {
      // Regla del proyecto: no se cargan horarios sin fuente y autorización de reutilización.
      if (row.reuse_authorized !== 1) throw new HttpError(400, 'No se pueden cargar horarios sin autorización de reutilización de la fuente')
      const days = JSON.parse(String(row.day_types))
      if (!Array.isArray(days) || !days.length || !days.every((d) => DAY_TYPES.includes(d))) throw new HttpError(400, '«day_types» debe ser una lista de weekday/saturday/sunday/holiday')
    },
  },
]

function coerce(col: Col, v: unknown): unknown {
  if (v === undefined || v === null || v === '') {
    if (col.required) throw new HttpError(400, `Falta el campo «${col.name}»`)
    return null
  }
  switch (col.type) {
    case 'text':
      return str(v, col.name, { max: 4000 })
    case 'url':
      return httpUrl(v, col.name)
    case 'int':
      if (!Number.isInteger(Number(v))) throw new HttpError(400, `«${col.name}» debe ser un número entero`)
      return Number(v)
    case 'bool':
      return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0
    case 'enum':
      if (!col.values!.includes(String(v))) throw new HttpError(400, `«${col.name}» debe ser uno de: ${col.values!.join(', ')}`)
      return String(v)
    case 'datetime':
      if (Number.isNaN(Date.parse(String(v)))) throw new HttpError(400, `«${col.name}» debe ser una fecha y hora válida`)
      return new Date(String(v)).toISOString()
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new HttpError(400, `«${col.name}» debe tener formato AAAA-MM-DD`)
      return String(v)
    case 'time':
      if (!TIME.test(String(v))) throw new HttpError(400, `«${col.name}» debe tener formato HH:mm (00–47)`)
      return String(v)
    case 'json':
      try {
        return typeof v === 'string' ? JSON.stringify(JSON.parse(v)) : JSON.stringify(v)
      } catch {
        throw new HttpError(400, `«${col.name}» debe ser JSON válido`)
      }
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Recursos con CRUD activo. En producción solo "events"; el resto (radios, lugares, transporte) está preparado pero inactivo. */
export const ACTIVE_RESOURCES = ['events']

export function crudRoutes(r: Router, features: Features = { push: true, staticModules: true, syncSources: true }): void {
  for (const res of RESOURCES) {
    if (!features.staticModules && !ACTIVE_RESOURCES.includes(res.table)) continue
    const base = `/api/admin/${res.path}`
    const parseRow = (input: Record<string, unknown>, partial: boolean, existing?: Record<string, unknown>) => {
      const row: Record<string, unknown> = {}
      for (const col of res.columns) {
        if (partial && !(col.name in input)) continue
        row[col.name] = coerce(col, input[col.name])
      }
      res.check?.({ ...existing, ...row })
      return row
    }

    r.get(base, async (ctx) => {
      requirePermission(ctx, 'content:read')
      return json((await ctx.env.DB.prepare(`SELECT * FROM ${res.table} ORDER BY ${res.order}`).all()).results)
    })

    r.post(base, async (ctx) => {
      const admin = requirePermission(ctx, 'content:write')
      const input = await ctx.body()
      const row = parseRow(input, false)
      // Las columnas vacías se omiten para que apliquen los valores por defecto de la base.
      const cols = Object.keys(row).filter((k) => row[k] !== null)
      let id: string | number
      const stmts: D1PreparedStatement[] = []
      if (res.pkType === 'text') {
        id = slug(str(input.id ?? input.name, 'id', { max: 80 }))
        if (!id) throw new HttpError(400, 'Identificador inválido')
        if (await ctx.env.DB.prepare(`SELECT 1 AS x FROM ${res.table} WHERE ${res.pk} = ?`).bind(id).first()) throw new HttpError(409, 'Ya existe un registro con ese identificador')
        stmts.push(ctx.env.DB.prepare(`INSERT INTO ${res.table} (${res.pk}, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`).bind(id, ...cols.map((c) => row[c])))
      } else {
        const ins = await ctx.env.DB.prepare(`INSERT INTO ${res.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...cols.map((c) => row[c])).run()
        id = Number(ins.meta.last_row_id)
      }
      stmts.push(historyStatement(ctx.env.DB, { entityType: res.table, entityId: id, action: 'created', actor: actorOf(admin), after: row }, ctx.now))
      await ctx.env.DB.batch(stmts)
      return json({ id }, { status: 201 })
    })

    r.patch(`${base}/:id`, async (ctx) => {
      const admin = requirePermission(ctx, 'content:write')
      const before = await ctx.env.DB.prepare(`SELECT * FROM ${res.table} WHERE ${res.pk} = ?`).bind(ctx.params.id).first<Record<string, unknown>>()
      if (!before) throw new HttpError(404, 'No encontrado')
      const row = parseRow(await ctx.body(), true, before)
      const cols = Object.keys(row)
      if (!cols.length) throw new HttpError(400, 'Nada para actualizar')
      await ctx.env.DB.batch([
        ctx.env.DB.prepare(`UPDATE ${res.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${res.pk} = ?`).bind(...cols.map((c) => row[c]), ctx.params.id),
        historyStatement(ctx.env.DB, { entityType: res.table, entityId: ctx.params.id, action: 'updated', actor: actorOf(admin), before, after: row }, ctx.now),
      ])
      return json({ ok: true })
    })

    r.delete(`${base}/:id`, async (ctx) => {
      const admin = requirePermission(ctx, 'content:delete')
      const before = await ctx.env.DB.prepare(`SELECT * FROM ${res.table} WHERE ${res.pk} = ?`).bind(ctx.params.id).first()
      if (!before) throw new HttpError(404, 'No encontrado')
      await ctx.env.DB.batch([
        ctx.env.DB.prepare(`DELETE FROM ${res.table} WHERE ${res.pk} = ?`).bind(ctx.params.id),
        historyStatement(ctx.env.DB, { entityType: res.table, entityId: ctx.params.id, action: 'deleted', actor: actorOf(admin), before }, ctx.now),
      ])
      return json({ ok: true })
    })
  }
}
