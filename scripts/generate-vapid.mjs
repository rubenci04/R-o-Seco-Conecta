// Genera un par de claves VAPID (P-256) para Web Push. NO se guardan en el repositorio.
//   npm run vapid:generate
// Luego cargar cada valor como secreto:  npx wrangler secret put VAPID_PUBLIC_KEY  /  VAPID_PRIVATE_KEY_JWK
import { generateKeyPairSync } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pub = publicKey.export({ format: 'jwk' })
const priv = privateKey.export({ format: 'jwk' })
const b64url = (b) => Buffer.from(b).toString('base64url')
const rawPublic = b64url(Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]))

console.log('VAPID_PUBLIC_KEY (se entrega a los navegadores):')
console.log(rawPublic)
console.log('\nVAPID_PRIVATE_KEY_JWK (SECRETO: no lo compartas ni lo subas al repositorio):')
console.log(JSON.stringify(priv))
console.log('\nGuardalos ahora con `wrangler secret put`; este script no los escribe en disco.')
