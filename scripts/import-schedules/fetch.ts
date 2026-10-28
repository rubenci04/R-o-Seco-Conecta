/**
 * Paso 1 del importador: descarga las páginas públicas y guarda una instantánea JSON por ruta en
 * `data-sources/colectivostucuman/`. Uso:  node scripts/import-schedules/fetch.ts
 * Cortesía: 1 solicitud cada 1,5 s, User-Agent identificable, sin tocar rutas vedadas por robots.txt.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { routePagesFromSitemap, snapshotFromHtml } from './extract.ts'

const BASE = 'https://colectivostucuman.com.ar'
const OUT = path.resolve('data-sources/colectivostucuman')
const UA = 'RioSecoConecta-importer/0.1 (proyecto comunitario sin fines de lucro; datos de horarios cedidos por el autor del proyecto)'
const DELAY_MS = 1500
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xml' } })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res.text()
}

const robots = await get(`${BASE}/robots.txt`)
const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)/gim)].map((m) => m[1])
const pages = routePagesFromSitemap(await get(`${BASE}/sitemap.xml`))
mkdirSync(OUT, { recursive: true })

const fetchedAt = new Date().toISOString()
let ok = 0
for (const p of pages) {
  const pathname = new URL(p.url).pathname
  if (disallowed.some((d) => pathname.startsWith(d))) {
    console.warn(`OMITIDA por robots.txt: ${pathname}`)
    continue
  }
  try {
    const snap = snapshotFromHtml(await get(p.url), p.url, p.origin, p.destination, fetchedAt)
    writeFileSync(path.join(OUT, `${p.origin}__${p.destination}.json`), `${JSON.stringify(snap, null, 1)}\n`)
    ok++
    console.log(`✓ ${p.origin} → ${p.destination}: ${snap.props.routes.length} ruta(s), ${snap.summary.renderedCards} tarjetas`)
  } catch (e) {
    console.error(`✗ ${p.origin} → ${p.destination}: ${(e as Error).message}`)
  }
  await sleep(DELAY_MS)
}
console.log(`\n${ok}/${pages.length} páginas guardadas en ${OUT}`)
