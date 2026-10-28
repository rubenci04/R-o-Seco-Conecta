// Crea (o reemplaza la contraseña de) un administrador en D1. No hay usuarios ni contraseñas por defecto.
// Uso:  npm run admin:create -- --email persona@ejemplo.com --name "Nombre" [--role admin|editor|viewer] [--remote]
// La contraseña se pide por consola (no queda en el historial ni en archivos) o se toma de ADMIN_PASSWORD.
import { execFileSync } from 'node:child_process'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const remote = args.includes('--remote')
const email = (opt('email') ?? '').trim().toLowerCase()
const name = opt('name', email)
const role = opt('role', 'admin')

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Indicá un correo válido con --email')
if (!['admin', 'editor', 'viewer'].includes(role)) throw new Error('Rol inválido')

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (s) => (s.includes(question) ? process.stdout.write(s) : process.stdout.write(''))
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

const password = process.env.ADMIN_PASSWORD ?? (await askHidden('Contraseña (mín. 12 caracteres): '))
if (password.length < 12) throw new Error('La contraseña debe tener al menos 12 caracteres')

const ITER = 100_000 // máximo admitido por WebCrypto en Cloudflare Workers
const salt = randomBytes(16)
const hash = pbkdf2Sync(password, salt, ITER, 32, 'sha256')
const stored = ['pbkdf2', ITER, salt.toString('base64'), hash.toString('base64')].join('$')
const q = (s) => `'${String(s).replace(/'/g, "''")}'`

const sql =
  `INSERT INTO admins (email, display_name, role, password_hash, created_at) VALUES (${q(email)}, ${q(name)}, ${q(role)}, ${q(stored)}, ${q(new Date().toISOString())}) ` +
  `ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role, display_name = excluded.display_name, active = 1, failed_attempts = 0, locked_until = NULL;`

const dir = mkdtempSync(path.join(tmpdir(), 'rsc-admin-'))
const file = path.join(dir, 'create-admin.sql')
try {
  writeFileSync(file, sql, { mode: 0o600 })
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'rio-seco-conecta', remote ? '--remote' : '--local', '--file', file], { stdio: 'inherit', shell: true })
  console.log(`Administrador ${email} (${role}) listo en la base ${remote ? 'REMOTA' : 'local'}.`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
