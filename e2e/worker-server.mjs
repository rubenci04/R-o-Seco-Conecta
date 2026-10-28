// Servidor de pruebas E2E del Worker dinámico: base D1 LOCAL y aislada (.wrangler/e2e-state), migraciones reales
// y un administrador de prueba con contraseña aleatoria (se guarda solo en .wrangler/e2e-admin.json, fuera de Git).
// Requiere `dist/` construido con el modo por defecto (datos híbridos). Uso: node e2e/worker-server.mjs
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const STATE = '.wrangler/e2e-state'
const PORT = process.env.E2E_WORKER_PORT ?? '8787'
const run = (args, env = {}) => execFileSync('npx', args, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } })

rmSync(STATE, { recursive: true, force: true })
mkdirSync('.wrangler', { recursive: true })
run(['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', STATE])

const password = randomBytes(18).toString('base64url')
const email = 'e2e-admin@example.test'
run(['node', 'scripts/create-admin.mjs', '--email', email, '--name', '"Admin E2E"', '--role', 'admin', '--persist-to', STATE], { ADMIN_PASSWORD: password })
writeFileSync('.wrangler/e2e-admin.json', JSON.stringify({ email, password }))

const server = spawn('npx', ['wrangler', 'dev', '--port', PORT, '--ip', '127.0.0.1', '--persist-to', STATE], { stdio: 'inherit', shell: true })
const stop = () => server.kill()
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
server.on('exit', (code) => process.exit(code ?? 0))
