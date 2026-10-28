import { parsePostLink } from './dedupe'

export type ContentType = 'publicacion' | 'video' | 'reel' | 'foto'
export const CONTENT_TYPES: readonly ContentType[] = ['publicacion', 'video', 'reel', 'foto']
export const CONTENT_TYPE_LABEL: Record<ContentType, string> = { publicacion: 'Publicación', video: 'Video', reel: 'Reel', foto: 'Foto' }
export const isContentType = (v: string): v is ContentType => (CONTENT_TYPES as readonly string[]).includes(v)

/** Tipo de contenido sugerido por la forma del enlace (la persona puede corregirlo). No dice nada sobre el tema. */
export function contentTypeFromUrl(url: string): ContentType {
  const p = (() => {
    try {
      return new URL(url).pathname
    } catch {
      return ''
    }
  })()
  if (/\/reels?\//.test(p)) return 'reel'
  if (/\/videos?\//.test(p) || /fb\.watch/.test(url)) return 'video'
  if (/\/photos?\b/.test(p) || /\/photo\//.test(p)) return 'foto'
  return 'publicacion'
}

/**
 * Dirección del contenido embebido OFICIAL de Meta para un enlace de publicación (sin tokens ni SDK).
 * Facebook: plugins/video.php para videos y reels, plugins/post.php para el resto. Instagram: /embed.
 * Devuelve null si el enlace no es una publicación de Facebook o Instagram.
 */
export function embedUrlFor(url: string | undefined | null, width = 500): string | null {
  if (!url) return null
  const link = parsePostLink(url)
  // Sin un identificador de publicación (p. ej. la URL de la página) no hay nada que incrustar.
  if (!link || (link.platform === 'facebook' && !link.externalId)) return null
  const w = Math.min(Math.max(Math.round(width), 220), 750)
  if (link.platform === 'instagram') return `${link.canonicalUrl}embed/`
  const kind = contentTypeFromUrl(link.canonicalUrl)
  const page = kind === 'video' || kind === 'reel' ? 'video' : 'post'
  return `https://www.facebook.com/plugins/${page}.php?${new URLSearchParams({ href: link.canonicalUrl, show_text: 'true', width: String(w) }).toString()}`
}

/** Categorías que una carga en bloque NO publica sola: requieren revisión individual (servicios, emergencias y obituarios). */
export const SENSITIVE_CATEGORIES = ['obituarios', 'agua', 'energia', 'calles', 'residuos', 'meteorologica'] as const
export const isSensitiveCategory = (c: string) => (SENSITIVE_CATEGORIES as readonly string[]).includes(c)
