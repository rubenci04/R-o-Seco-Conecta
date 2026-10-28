import { normalize, sha256Hex, tokens } from './text'

/** Huella del contenido: mismo texto (ignorando mayúsculas, tildes, enlaces y signos) = misma huella. */
export async function contentHash(text: string): Promise<string> {
  return sha256Hex(normalize(text))
}

export const stableKey = (sourceId: string, externalId: string) => `${sourceId}:${externalId}`

/** Similitud de Jaccard sobre palabras (0..1). Detecta la misma novedad publicada en Facebook e Instagram. */
export function similarity(a: string, b: string): number {
  const A = new Set(tokens(a))
  const B = new Set(tokens(b))
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

export const NEAR_DUPLICATE_THRESHOLD = 0.85
/** Textos muy cortos coinciden por azar: no se comparan por similitud. */
export const MIN_TOKENS_FOR_SIMILARITY = 8

export function isNearDuplicate(a: string, b: string): boolean {
  if (tokens(a).length < MIN_TOKENS_FOR_SIMILARITY || tokens(b).length < MIN_TOKENS_FOR_SIMILARITY) return false
  return similarity(a, b) >= NEAR_DUPLICATE_THRESHOLD
}

// ---- Enlaces de publicaciones (importación asistida). No se descarga nada: solo se interpreta la URL. ----

export interface ParsedPostLink {
  platform: 'facebook' | 'instagram'
  /** Identificador estable extraído del enlace, si existe. */
  externalId: string | null
  canonicalUrl: string
}

const FB_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.com', 'www.fb.com', 'fb.watch'])
const IG_HOSTS = new Set(['instagram.com', 'www.instagram.com'])

export function parsePostLink(raw: string): ParsedPostLink | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  if (IG_HOSTS.has(host)) {
    const m = u.pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)
    if (!m) return null
    return { platform: 'instagram', externalId: m[2], canonicalUrl: `https://www.instagram.com/p/${m[2]}/` }
  }
  if (FB_HOSTS.has(host)) {
    const p = u.pathname
    const id =
      u.searchParams.get('story_fbid') ??
      u.searchParams.get('fbid') ??
      p.match(/\/(?:posts|videos|reel|photos)\/(?:[^/]+\/)?(pfbid[A-Za-z0-9]+|\d{6,})/)?.[1] ??
      p.match(/\/(pfbid[A-Za-z0-9]+)/)?.[1] ??
      null
    return { platform: 'facebook', externalId: id, canonicalUrl: `${u.origin}${u.pathname}${id && u.searchParams.get('story_fbid') ? `?story_fbid=${id}&id=${u.searchParams.get('id') ?? ''}` : ''}` }
  }
  return null
}
