/** Colores dominantes del cartel del logo (recorte de letras): agrupa píxeles por k-medias simples. */
import sharp from 'sharp'

export const LOGO_SOURCE = 'src/logo.jpg'
/** Región del cartel dentro de la foto (sin las bandas oscuras de la captura). */
export const LOGO_CROP = { left: 12, top: 192, width: 362, height: 125 }

export async function dominantColors(k = 6) {
  const { data, info } = await sharp(LOGO_SOURCE).extract(LOGO_CROP).resize(120).raw().toBuffer({ resolveWithObject: true })
  const px: number[][] = []
  for (let i = 0; i < data.length; i += info.channels) px.push([data[i], data[i + 1], data[i + 2]])
  let centers = Array.from({ length: k }, (_, i) => px[Math.floor((i + 0.5) * (px.length / k))])
  for (let iter = 0; iter < 12; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0])
    for (const p of px) {
      let best = 0, bd = Infinity
      centers.forEach((c, i) => { const d = (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2; if (d < bd) { bd = d; best = i } })
      sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2] += p[2]; sums[best][3]++
    }
    centers = sums.map((s, i) => (s[3] ? [s[0]/s[3], s[1]/s[3], s[2]/s[3]] : centers[i]))
  }
  const counts = centers.map(() => 0)
  for (const p of px) {
    let best = 0, bd = Infinity
    centers.forEach((c, i) => { const d = (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2; if (d < bd) { bd = d; best = i } })
    counts[best]++
  }
  const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  return centers.map((c, i) => ({ hex: hex(c), share: counts[i] / px.length })).sort((a, b) => b.share - a.share)
}

if (process.argv[1]?.endsWith('palette.ts')) console.table(await dominantColors())
