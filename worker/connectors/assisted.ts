import { parsePostLink } from '../../shared/dedupe'
import { sha256Hex } from '../../shared/text'
import { HttpError } from '../http'
import type { RawPost } from '../ingest'

export interface AssistedInput {
  url: string
  /** Texto/leyenda copiado por la persona editora desde la publicación. El sistema NO descarga la página. */
  text: string
  /** Fecha original de publicación (ISO). Si falta, se usa el momento de la carga. */
  publishedAt?: string
}

/**
 * Importación asistida por enlace. Técnicamente viable SIN credenciales porque no se lee la plataforma:
 * se valida y normaliza el enlace (anti-duplicados) y la persona aporta el texto. Nada de scraping, cookies ni sesiones.
 */
export async function buildAssistedPost(input: AssistedInput, now: Date): Promise<{ sourceId: string; raw: RawPost }> {
  const link = parsePostLink(input.url)
  if (!link) throw new HttpError(400, 'El enlace debe ser una publicación de Facebook o Instagram')
  const text = input.text?.trim()
  if (!text) throw new HttpError(400, 'Pegá el texto de la publicación: no se descarga automáticamente')
  const published = input.publishedAt ? new Date(input.publishedAt) : now
  if (Number.isNaN(published.getTime())) throw new HttpError(400, 'Fecha de publicación inválida')
  const externalId = link.externalId ?? `url:${(await sha256Hex(link.canonicalUrl)).slice(0, 20)}`
  return {
    sourceId: link.platform === 'instagram' ? 'instagram-comuna' : 'facebook-comuna',
    // Sin fecha confirmada por la persona se guarda el momento de la carga y se marca como fecha NO verificada.
    raw: { externalId, url: link.canonicalUrl, body: text, publishedAt: published.toISOString(), dateVerified: !!input.publishedAt },
  }
}
