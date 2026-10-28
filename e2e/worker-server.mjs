// Servidor de pruebas E2E del Worker dinámico: base D1 LOCAL y aislada (.wrangler/e2e-state), migraciones reales
// y un administrador de prueba con contraseña aleatoria (se guarda solo en .wrangler/e2e-admin.json, fuera de Git).
// Requiere `dist/` construido con el modo por defecto (datos híbridos). Uso: node e2e/worker-server.mjs
import { execFileSync, spawn } from 'node:child_process'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'

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

// Claves VAPID EFÍMERAS (solo de esta ejecución, en .dev.vars ignorado por Git) y un servidor push simulado que registra
// cada solicitud; las pruebas descifran el contenido con la clave del dispositivo de prueba.
const MOCK_PORT = Number(process.env.E2E_PUSH_PORT ?? 8799)
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pub = publicKey.export({ format: 'jwk' })
const rawPublic = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url')
writeFileSync(
  '.dev.vars',
  [`VAPID_PUBLIC_KEY=${rawPublic}`, `VAPID_PRIVATE_KEY_JWK=${JSON.stringify(privateKey.export({ format: 'jwk' }))}`, 'VAPID_SUBJECT=https://e2e.example.test', `PUSH_TEST_HOSTS=127.0.0.1:${MOCK_PORT}`].join(String.fromCharCode(10)) + String.fromCharCode(10),
)
const received = []
const failures = new Map() // ruta -> código a devolver (para probar reintentos)
const mock = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/__received') {
    res.setHeader('content-type', 'application/json')
    return res.end(JSON.stringify(received))
  }
  if (url.pathname === '/__reset') {
    received.length = 0
    failures.clear()
    return res.end('ok')
  }
  if (url.pathname === '/__fail') {
    failures.set(url.searchParams.get('path'), Number(url.searchParams.get('status')))
    return res.end('ok')
  }
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const forced = failures.get(url.pathname)
    received.push({ path: url.pathname, status: forced ?? 201, headers: req.headers, body: Buffer.concat(chunks).toString('base64url') })
    res.statusCode = forced ?? 201
    res.end()
  })
})
mock.listen(MOCK_PORT, '127.0.0.1')

const server = spawn('npx', ['wrangler', 'dev', '--port', PORT, '--ip', '127.0.0.1', '--persist-to', STATE], { stdio: 'inherit', shell: true })
const stop = () => {
  mock.close()
  rmSync('.dev.vars', { force: true })
  server.kill()
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
server.on('exit', (code) => {
  rmSync('.dev.vars', { force: true })
  process.exit(code ?? 0)
})
