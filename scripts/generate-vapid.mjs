// Genera un par de claves VAPID (P-256) para Web Push y las carga como SECRETOS de Cloudflare.
//   npm run vapid:generate            → genera y carga ambos secretos (no imprime la clave privada)
// La clave privada nunca se escribe en disco ni en el repositorio ni se muestra en pantalla.
// IMPORTANTE: si ya existen suscripciones, NO volver a generar: las claves son la identidad del servidor y, si cambian,
// los navegadores rechazan los envíos (403) y cada persona debería reactivar las notificaciones. Ver docs/NOTIFICACIONES.md.
import { generateKeyPairSync } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pub = publicKey.export({ format: 'jwk' })
const priv = privateKey.export({ format: 'jwk' })
const rawPublic = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url')

const put = (name, value) => {
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name], { input: value, encoding: 'utf8', shell: true })
  if (r.status !== 0) {
    console.error(`No se pudo guardar ${name}:`, (r.stderr || r.stdout || '').split('\n').slice(-6).join('\n'))
    process.exit(1)
  }
  console.log(`Secreto ${name} guardado en Cloudflare.`)
}

put('VAPID_PUBLIC_KEY', rawPublic)
put('VAPID_PRIVATE_KEY_JWK', JSON.stringify(priv))
console.log('\nClave pública (la que reciben los navegadores):')
console.log(rawPublic)
