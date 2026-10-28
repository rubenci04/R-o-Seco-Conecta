import { hashPassword } from '../auth'
import type { Env } from '../env'
import { createApp, type AppDeps } from '../index'
import { freshDb, type TestD1 } from './d1shim'

export const NOW = new Date('2026-10-28T15:00:00.000Z')

export interface Harness {
  db: TestD1
  env: Env
  app: ReturnType<typeof createApp>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: (method: string, path: string, opts?: { body?: unknown; cookie?: string; csrf?: boolean }) => Promise<{ status: number; json: any; headers: Headers }>
  loginAs: (role: 'admin' | 'editor' | 'viewer') => Promise<string>
}

/** Los usuarios de prueba existen SOLO en la base en memoria de cada test. */
export async function harness(envExtra: Partial<Env> = {}, deps: AppDeps = {}): Promise<Harness> {
  const db = freshDb()
  const env = { DB: db.asD1(), ASSETS: {} as Fetcher, ...envExtra } as Env
  const app = createApp({ now: () => NOW, ...deps })
  const hash = await hashPassword('contraseña-de-prueba-1', 1000)
  for (const role of ['admin', 'editor', 'viewer']) {
    db.prepare('INSERT INTO admins (email, display_name, role, password_hash, created_at) VALUES (?,?,?,?,?)')
      .bind(`${role}@test.local`, role, role, hash, NOW.toISOString())
      .runSync()
  }
  const call: Harness['call'] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (opts.cookie) headers.cookie = opts.cookie
    if (opts.csrf !== false && path.startsWith('/api/admin')) headers['x-rsc-csrf'] = '1'
    const res = await app.handleApi(new Request(`https://app.test${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env)
    if (!res) throw new Error('ruta fuera de /api')
    const text = await res.text()
    return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers }
  }
  const loginAs: Harness['loginAs'] = async (role) => {
    const r = await call('POST', '/api/admin/login', { body: { email: `${role}@test.local`, password: 'contraseña-de-prueba-1' } })
    if (r.status !== 200) throw new Error(`login falló: ${r.status}`)
    return r.headers.get('set-cookie')!.split(';')[0]
  }
  return { db, env, app, call, loginAs }
}

/** Texto de prueba redactado para ejercitar reglas; NO es una publicación real. */
export const TEXT = {
  agua: 'Mañana habrá interrupción del suministro de agua en barrio Norte por trabajos de reparación en la red.',
  agua2: 'Cortes de agua en distintos barrios del pueblo por trabajos de reparación de cañerías, se normaliza durante la tarde.',
  obit: 'Con profundo pesar comunicamos el fallecimiento de Juan Carlos Pérez. Velatorio en su domicilio, sepelio a las 16 hs.',
  alertaUrgente: 'ALERTA NARANJA por tormentas fuertes y granizo. Máxima precaución, evitar circular por rutas.',
  torneo: 'Torneo de fútbol infantil en el club, inscripciones abiertas para los equipos de la zona este fin de semana.',
  saludo: 'Buen día a todos.',
}
