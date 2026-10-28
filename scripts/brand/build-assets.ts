/**
 * Genera los recursos de identidad a partir de los archivos aportados (sin rediseñar ni usar IA):
 *   src/logo.png       → logo con fondo transparente, marca «RS», favicon e íconos PWA
 *   src/rio seco.jpeg  → portada de Inicio (fotografía, NO es el logo)
 * El PNG original es opaco (fondo gris muy claro): el fondo se elimina por relleno desde los bordes,
 * de modo que el blanco interior de la «R» (cerrado por el contorno azul oscuro) se conserva.
 * Los nombres de archivo incluyen el sufijo de versión para que ninguna caché conserve íconos anteriores.
 * Uso: npm run brand:build
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { LOGO_SOURCE } from './palette.ts'

const HERO_SOURCE = 'src/rio seco.jpeg'
const V = 'v2'
const NAVY: [number, number, number] = [7, 48, 73] // contorno del logo
/** Marca «RS» (sin el rótulo), en coordenadas del PNG original. */
const MARK = { left: 52, top: 48, width: 430, height: 352 }

mkdirSync('public/brand', { recursive: true })
mkdirSync('public/icons', { recursive: true })
for (const old of ['public/brand/logo-sign.webp', 'public/favicon-32.png', 'public/favicon-48.png', 'public/icons/icon-192.png', 'public/icons/icon-512.png', 'public/icons/icon-maskable-512.png', 'public/icons/apple-touch-icon.png']) {
  rmSync(old, { force: true })
}

/** Quita el fondo claro conectado a los bordes y suaviza el contorno (sin halo claro). */
async function transparentLogo(): Promise<Buffer> {
  const { data, info } = await sharp(LOGO_SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const idx = (x: number, y: number) => (y * w + x) * 3
  const minC = (x: number, y: number) => Math.min(data[idx(x, y)], data[idx(x, y) + 1], data[idx(x, y) + 2])
  const bg = new Uint8Array(w * h)
  const stack: number[] = []
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h || bg[y * w + x] || minC(x, y) < 200) return
    bg[y * w + x] = 1
    stack.push(x, y)
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1) }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y) }
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
  }
  const out = Buffer.alloc(w * h * 4)
  const nearBg = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && bg[ny * w + nx]) return true
    }
    return false
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4
    const i = idx(x, y)
    if (bg[y * w + x]) { out[o + 3] = 0; continue }
    let [r, g, b, a] = [data[i], data[i + 1], data[i + 2], 255]
    if (nearBg(x, y, 2)) {
      // Borde antialiasado: color del contorno, opacidad según cuán oscuro es el píxel.
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      a = Math.round(Math.max(0, Math.min(1, (236 - lum) / (236 - 70))) * 255)
      ;[r, g, b] = lum < 160 ? NAVY : [r, g, b]
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}

const logo = await transparentLogo()
const trim = (buf: Buffer) => sharp(buf).trim({ threshold: 5 }).png().toBuffer()

// Logo completo y marca «RS», con transparencia, optimizados.
await sharp(await trim(logo)).png({ compressionLevel: 9 }).toFile(`public/brand/logo-${V}.png`)
const mark = await trim(await sharp(logo).extract(MARK).png().toBuffer())
await sharp(mark).resize({ height: 160 }).png({ compressionLevel: 9 }).toFile(`public/brand/logo-mark-${V}.png`)

await sharp(HERO_SOURCE).webp({ quality: 84 }).toFile('public/brand/entrada.webp')

/** Ícono: logo centrado sobre blanco. `scale` = alto del logo / lado del ícono. */
async function icon(size: number, scale: number, opts: { rounded?: boolean; source?: Buffer } = {}) {
  const src = opts.source ?? (await trim(logo))
  const meta = await sharp(src).metadata()
  const ratio = (meta.width ?? 1) / (meta.height ?? 1)
  let h = Math.round(size * scale)
  let w = Math.round(h * ratio)
  if (w > size * scale) { w = Math.round(size * scale); h = Math.round(w / ratio) } // nunca recortar
  const fitted = await sharp(src).resize(w, h).png().toBuffer()
  let img = sharp({ create: { width: size, height: size, channels: 4, background: '#ffffff' } }).composite([
    { input: fitted, left: Math.round((size - w) / 2), top: Math.round((size - h) / 2) },
  ])
  if (opts.rounded) {
    const r = Math.round(size * 0.2)
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#fff"/></svg>`)
    img = sharp(await img.png().toBuffer()).composite([{ input: mask, blend: 'dest-in' }])
  }
  return img.png().toBuffer()
}

writeFileSync(`public/icons/icon-192-${V}.png`, await icon(192, 0.82, { rounded: true }))
writeFileSync(`public/icons/icon-512-${V}.png`, await icon(512, 0.82, { rounded: true }))
// Maskable: el contenido queda dentro de la zona segura (círculo central del 80 %).
writeFileSync(`public/icons/icon-maskable-512-${V}.png`, await icon(512, 0.56))
writeFileSync(`public/icons/apple-touch-icon-${V}.png`, await icon(180, 0.78))

// Favicon: solo la marca «RS» (el rótulo no se lee a 16–32 px), sobre blanco para verse bien en pestañas oscuras.
const fav = (s: number) => icon(s, 0.9, { rounded: true, source: mark })
const f32 = await fav(32)
const f48 = await fav(48)
writeFileSync(`public/favicon-32-${V}.png`, f32)
writeFileSync(`public/favicon-48-${V}.png`, f48)
const header = Buffer.alloc(22)
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4)
header[6] = 48; header[7] = 48; header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12)
header.writeUInt32LE(f48.length, 14); header.writeUInt32LE(22, 18)
writeFileSync('public/favicon.ico', Buffer.concat([header, f48]))

console.log(`Recursos de identidad (${V}) generados desde src/logo.png y src/rio seco.jpeg`)
