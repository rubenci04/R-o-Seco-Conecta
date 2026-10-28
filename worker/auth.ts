import { can, type Permission, type Role } from '../shared/permissions'
import { sha256Hex } from '../shared/text'
import type { Env } from './env'
import { HttpError, type AdminSession, type Ctx } from './http'

/** Límite de iteraciones PBKDF2 de WebCrypto en Cloudflare Workers. */
export const PBKDF2_ITERATIONS = 100_000
export const MIN_PASSWORD_LENGTH = 12
export const SESSION_HOURS = 8
export const MAX_FAILED_ATTEMPTS = 5
export const LOCK_MINUTES = 15
export const SESSION_COOKIE = 'rsc_session'
export const CSRF_HEADER = 'x-rsc-csrf'

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const b64url = (buf: Uint8Array) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256)
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(await pbkdf2(password, salt, iterations))}`
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$')
  if (scheme !== 'pbkdf2' || !iter || !salt || !hash) return false
  const derived = new Uint8Array(await pbkdf2(password, unb64(salt), Number(iter)))
  return timingSafeEqual(derived, unb64(hash))
}

// Hash ficticio para igualar el tiempo de respuesta cuando el correo no existe.
const DUMMY_HASH = ['pbkdf2', PBKDF2_ITERATIONS, b64(new Uint8Array(16)), b64(new Uint8Array(32))].join('$')

interface AdminRow {
  id: number
  email: string
  display_name: string
  role: Role
  password_hash: string
  active: number
  failed_attempts: number
  locked_until: string | null
}

export type LoginResult = { ok: true; token: string; admin: AdminSession; expiresAt: string } | { ok: false; reason: 'invalid' | 'locked' }

export async function login(db: D1Database, email: string, password: string, now: Date): Promise<LoginResult> {
  const row = await db.prepare('SELECT * FROM admins WHERE email = ?').bind(email.trim()).first<AdminRow>()
  if (!row || !row.active) {
    await verifyPassword(password, DUMMY_HASH)
    return { ok: false, reason: 'invalid' }
  }
  if (row.locked_until && new Date(row.locked_until) > now) return { ok: false, reason: 'locked' }

  if (!(await verifyPassword(password, row.password_hash))) {
    const attempts = row.failed_attempts + 1
    const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : null
    await db
      .prepare('UPDATE admins SET failed_attempts = ?, locked_until = ? WHERE id = ?')
      .bind(lockedUntil ? 0 : attempts, lockedUntil, row.id)
      .run()
    return { ok: false, reason: lockedUntil ? 'locked' : 'invalid' }
  }

  const token = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3_600_000).toISOString()
  await db.batch([
    db.prepare('UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').bind(now.toISOString(), row.id),
    db.prepare('INSERT INTO admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?,?,?,?)').bind(await sha256Hex(token), row.id, now.toISOString(), expiresAt),
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(now.toISOString()),
  ])
  return { ok: true, token, expiresAt, admin: { id: row.id, email: row.email, displayName: row.display_name, role: row.role } }
}

export async function logout(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run()
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

export const sessionCookie = (token: string, maxAgeSeconds: number) =>
  `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${maxAgeSeconds}`
export const clearCookie = () => `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0`

export async function authenticate(env: Env, req: Request, now: Date): Promise<AdminSession | null> {
  const token = readCookie(req, SESSION_COOKIE)
  if (!token) return null
  const row = await env.DB.prepare(
    `SELECT a.id, a.email, a.display_name, a.role FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND a.active = 1`,
  )
    .bind(await sha256Hex(token), now.toISOString())
    .first<{ id: number; email: string; display_name: string; role: Role }>()
  return row ? { id: row.id, email: row.email, displayName: row.display_name, role: row.role } : null
}

/** Protección CSRF para métodos que modifican: cabecera personalizada + Origin coherente. */
export function assertCsrf(req: Request): void {
  if (req.method === 'GET' || req.method === 'HEAD') return
  if (req.headers.get(CSRF_HEADER) !== '1') throw new HttpError(403, 'Falta la cabecera de protección CSRF')
  const origin = req.headers.get('origin')
  if (origin && new URL(origin).host !== new URL(req.url).host) throw new HttpError(403, 'Origen no permitido')
}

/** Verificación de permisos EN EL SERVIDOR. Lanza 401 sin sesión o 403 sin permiso. */
export function requirePermission(ctx: Ctx, permission: Permission): AdminSession {
  if (!ctx.admin) throw new HttpError(401, 'Iniciá sesión para continuar')
  if (!can(ctx.admin.role, permission)) throw new HttpError(403, 'No tenés permiso para esta acción')
  return ctx.admin
}
