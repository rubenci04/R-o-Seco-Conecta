/**
 * Genera los recursos de identidad a partir de las fotografías aportadas (sin imágenes nuevas ni rediseño):
 *   public/brand/logo-sign.webp   cartel «RIO SECO» recortado de src/logo.jpg (sin las bandas oscuras)
 *   public/brand/entrada.webp     portada de Inicio a partir de src/rio seco.jpeg
 *   public/icons/*.png, favicon-*.png, favicon.ico   favicon e íconos PWA
 * Uso: npm run brand:build
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { LOGO_CROP, LOGO_SOURCE } from './palette.ts'

const HERO_SOURCE = 'src/rio seco.jpeg'
const NAVY = '#0e1b2a' // tono nocturno del cartel; fondo de los íconos
/** Recorte cuadrado de las letras «R» e «I» (blanca y celeste) para el favicon, donde el cartel completo no se lee. */
const FAVICON_CROP = { left: 14, top: 190, width: 136, height: 136 }

mkdirSync('public/brand', { recursive: true })
mkdirSync('public/icons', { recursive: true })

const sign = () => sharp(LOGO_SOURCE).extract(LOGO_CROP)

await sign().webp({ quality: 90 }).toFile('public/brand/logo-sign.webp')
await sharp(HERO_SOURCE).webp({ quality: 84 }).toFile('public/brand/entrada.webp')

/** Ícono: cartel centrado sobre fondo oscuro. `scale` = ancho del cartel / lado del ícono. */
async function icon(size: number, scale: number, rounded: boolean) {
  const w = Math.round(size * scale)
  const logo = await sign().resize({ width: w }).png().toBuffer()
  const meta = await sharp(logo).metadata()
  let img = sharp({ create: { width: size, height: size, channels: 4, background: NAVY } }).composite([
    { input: logo, left: Math.round((size - w) / 2), top: Math.round((size - (meta.height ?? 0)) / 2) },
  ])
  if (rounded) {
    const r = Math.round(size * 0.22)
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#fff"/></svg>`)
    img = sharp(await img.png().toBuffer()).composite([{ input: mask, blend: 'dest-in' }])
  }
  return img.png().toBuffer()
}

writeFileSync('public/icons/icon-192.png', await icon(192, 0.88, true))
writeFileSync('public/icons/icon-512.png', await icon(512, 0.88, true))
writeFileSync('public/icons/icon-maskable-512.png', await icon(512, 0.64, false)) // contenido dentro de la zona segura
writeFileSync('public/icons/apple-touch-icon.png', await icon(180, 0.8, false))

const fav = (s: number) => sharp(LOGO_SOURCE).extract(FAVICON_CROP).resize(s, s).png().toBuffer()
const f32 = await fav(32)
const f48 = await fav(48)
writeFileSync('public/favicon-32.png', f32)
writeFileSync('public/favicon-48.png', f48)

// favicon.ico con una imagen PNG de 48×48 incrustada (formato ICO válido en navegadores modernos)
const header = Buffer.alloc(22)
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4)
header[6] = 48; header[7] = 48; header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12)
header.writeUInt32LE(f48.length, 14); header.writeUInt32LE(22, 18)
writeFileSync('public/favicon.ico', Buffer.concat([header, f48]))

console.log('Recursos de identidad generados desde src/logo.jpg y src/rio seco.jpeg')
