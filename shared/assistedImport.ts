export interface AssistedEntry {
  url: string
  text: string
  /** ISO con la hora de Tucumán (UTC-3, sin horario de verano), si la persona indicó la fecha. */
  publishedAt?: string
}

const URL_RE = /https?:\/\/[^\s<>"]+/i
const DATE_LINE = /^\s*fecha(?:\s+de\s+publicaci[oó]n)?\s*:\s*(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?\s*$/i

/**
 * Interpreta lo que una persona pega para importar VARIAS publicaciones: bloques separados por una línea «---».
 * En cada bloque: una línea con el enlace, opcionalmente «Fecha: AAAA-MM-DD HH:mm» (hora de Tucumán) y el texto original.
 * No descarga nada: es solo análisis de texto.
 */
export function parseAssistedBlocks(raw: string): { entries: AssistedEntry[]; errors: string[] } {
  const entries: AssistedEntry[] = []
  const errors: string[] = []
  const blocks = raw
    .split(/^\s*-{3,}\s*$/m)
    .map((b) => b.trim())
    .filter(Boolean)
  blocks.forEach((block, i) => {
    const lines = block.split(/\r?\n/)
    const urlIdx = lines.findIndex((l) => URL_RE.test(l))
    if (urlIdx < 0) {
      errors.push(`Bloque ${i + 1}: falta el enlace de la publicación.`)
      return
    }
    const url = lines[urlIdx].match(URL_RE)![0].replace(/[).,;]+$/, '')
    let publishedAt: string | undefined
    const textLines: string[] = []
    lines.forEach((l, idx) => {
      if (idx === urlIdx) {
        const rest = l.replace(URL_RE, '').trim()
        if (rest) textLines.push(rest)
        return
      }
      const m = l.match(DATE_LINE)
      if (m) {
        const [, y, mo, d, h = '00', mi = '00'] = m
        publishedAt = new Date(`${y}-${mo}-${d}T${h}:${mi}:00-03:00`).toISOString()
        return
      }
      textLines.push(l)
    })
    const text = textLines.join('\n').trim()
    if (!text) errors.push(`Bloque ${i + 1}: falta el texto de la publicación (no se descarga automáticamente).`)
    else entries.push({ url, text, publishedAt })
  })
  return { entries, errors }
}
