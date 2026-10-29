// Conecta la Página de la Comuna con el Worker SIN mostrar ni guardar tokens en archivos ni en el chat.
//   1) Quien administra la Página genera un TOKEN DE USUARIO en el Explorador de la API (ver docs/META-AUTORIZACION.md).
//   2) En esta terminal (el token solo vive en esta sesión):  $env:META_USER_TOKEN = "<token>"   (PowerShell)
//   3) Listar las páginas a las que ese usuario tiene acceso (muestra id y nombre, nunca tokens):
//        node scripts/meta-connect.mjs
//   4) Cargar los secretos de Cloudflare de la página elegida (el token de página va por stdin a `wrangler secret put`):
//        node scripts/meta-connect.mjs --page-id <ID>
// No está probado contra la API real (requiere un token válido).
import { spawnSync } from 'node:child_process'

const VERSION = process.env.META_GRAPH_VERSION || 'v25.0'
const userToken = process.env.META_USER_TOKEN
if (!userToken) {
  console.error('Falta la variable de entorno META_USER_TOKEN (no la pegues en el chat ni en archivos).')
  process.exit(1)
}
const idx = process.argv.indexOf('--page-id')
const wanted = idx > -1 ? process.argv[idx + 1] : null

const res = await fetch(`https://graph.facebook.com/${VERSION}/me/accounts?fields=id,name,access_token&limit=100`, { headers: { authorization: `Bearer ${userToken}` } })
const body = await res.json()
if (!res.ok) {
  console.error(`Meta respondió ${res.status}: ${body?.error?.message ?? 'error'} (código ${body?.error?.code ?? '?'})`)
  process.exit(1)
}
const pages = body.data ?? []
if (!wanted) {
  if (!pages.length) console.log('Ese usuario no administra ninguna página (¿falta pages_show_list?).')
  for (const p of pages) console.log(`${p.id}\t${p.name}`)
  process.exit(0)
}
const page = pages.find((p) => p.id === wanted)
if (!page?.access_token) {
  console.error('Esa página no figura entre las del usuario o no entregó token de página.')
  process.exit(1)
}
const put = (name, value) => {
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name], { input: value, shell: true, stdio: ['pipe', 'inherit', 'inherit'] })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
put('META_FACEBOOK_PAGE_ID', page.id)
put('META_PAGE_ACCESS_TOKEN', page.access_token)
console.log(`Secretos cargados para «${page.name}». Falta habilitar la fuente «facebook-comuna» en Panel → Fuentes (modo API).`)
