/**
 * Adaptador mínimo de la API de D1 sobre `node:sqlite`, solo para pruebas.
 * Ejecuta las migraciones SQL reales, así los tests de persistencia validan el esquema verdadero.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import path from 'node:path'

type Meta = { changes: number; last_row_id: number }

class Stmt {
  private params: SQLInputValue[] = []
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.params = values.map((v) => (v === undefined ? null : (v as SQLInputValue)))
    return this
  }
  async first<T = unknown>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null
  }
  async all<T = unknown>(): Promise<{ results: T[]; success: true; meta: Meta }> {
    const results = this.db.prepare(this.sql).all(...this.params) as T[]
    return { results, success: true, meta: { changes: 0, last_row_id: 0 } }
  }
  async run(): Promise<{ success: true; meta: Meta; results: [] }> {
    return this.runSync()
  }
  runSync() {
    const r = this.db.prepare(this.sql).run(...this.params)
    return { success: true as const, results: [] as [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
  }
}

export class TestD1 {
  readonly raw = new DatabaseSync(':memory:')
  constructor() {
    this.raw.exec('PRAGMA foreign_keys = ON')
  }
  prepare(sql: string) {
    return new Stmt(this.raw, sql)
  }
  /** Transaccional, como `D1Database.batch`: si una sentencia falla, ninguna se aplica. */
  async batch(stmts: Stmt[]) {
    this.raw.exec('BEGIN')
    try {
      const out = stmts.map((s) => s.runSync())
      this.raw.exec('COMMIT')
      return out
    } catch (e) {
      this.raw.exec('ROLLBACK')
      throw e
    }
  }
  exec(sql: string) {
    this.raw.exec(sql)
  }
  asD1(): D1Database {
    return this as unknown as D1Database
  }
}

export function migrate(db: TestD1, dir = path.resolve('migrations')): string[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) db.exec(readFileSync(path.join(dir, f), 'utf8'))
  return files
}

export function freshDb(): TestD1 {
  const db = new TestD1()
  migrate(db)
  return db
}
