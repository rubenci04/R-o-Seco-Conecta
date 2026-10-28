/** Colores dominantes del logo (sin el fondo claro): k-medias simples sobre los píxeles de la marca. */
import sharp from 'sharp'

export const LOGO_SOURCE = 'src/logo.png'

export async function dominantColors(k = 5) {
  const { data, info } = await sharp(LOGO_SOURCE).removeAlpha().resize(160).raw().toBuffer({ resolveWithObject: true })
  const px: number[][] = []
  for (let i = 0; i < data.length; i += info.channels) {
    const p = [data[i], data[i + 1], data[i + 2]]
    if (Math.min(...p) < 215) px.push(p) // descarta fondo claro; el blanco interior de la "R" se informa aparte
  }
  let centers = Array.from({ length: k }, (_, i) => px[Math.floor((i + 0.5) * (px.length / k))])
  const nearest = (p: number[]) => {
    let best = 0, bd = Infinity
    centers.forEach((c, i) => { const d = (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2; if (d < bd) { bd = d; best = i } })
    return best
  }
  for (let iter = 0; iter < 15; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0])
    for (const p of px) { const b = nearest(p); sums[b][0] += p[0]; sums[b][1] += p[1]; sums[b][2] += p[2]; sums[b][3]++ }
    centers = sums.map((s, i) => (s[3] ? [s[0]/s[3], s[1]/s[3], s[2]/s[3]] : centers[i]))
  }
  const counts = centers.map(() => 0)
  for (const p of px) counts[nearest(p)]++
  const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  return centers.map((c, i) => ({ hex: hex(c), share: Number((counts[i] / px.length).toFixed(3)) })).sort((a, b) => b.share - a.share)
}

if (process.argv[1]?.endsWith('palette.ts')) console.table(await dominantColors())
