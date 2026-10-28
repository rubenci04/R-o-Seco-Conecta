/** Minúsculas, sin tildes ni signos, espacios colapsados. Base de clasificación y deduplicación. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9ñ\s./:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Divide en oraciones para exigir que las señales de contexto aparezcan juntas. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?\n])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function tokens(text: string): string[] {
  return normalize(text)
    .replace(/[./:-]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 2)
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function truncate(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

/** Primer renglón no vacío como título; si es muy largo, se recorta. */
export function deriveTitle(body: string): string {
  const first = body.split('\n').map((l) => l.trim()).find(Boolean) ?? 'Publicación'
  return truncate(first, 110)
}
