import type { Actor } from './env'

export interface HistoryEntry {
  entityType: string
  entityId: string | number
  action: string
  actor: Actor
  before?: unknown
  after?: unknown
  note?: string
}

/** Sentencia lista para incluir en un `db.batch([...])`. */
export function historyStatement(db: D1Database, h: HistoryEntry, at: Date): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO editorial_history (entity_type, entity_id, action, admin_id, actor_label, before_json, after_json, note, at) VALUES (?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      h.entityType,
      String(h.entityId),
      h.action,
      h.actor.id,
      h.actor.label,
      h.before === undefined ? null : JSON.stringify(h.before),
      h.after === undefined ? null : JSON.stringify(h.after),
      h.note ?? null,
      at.toISOString(),
    )
}
