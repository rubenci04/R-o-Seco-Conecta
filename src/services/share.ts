export type ShareOutcome = 'shared' | 'copied' | 'failed'

/** Comparte con la hoja nativa si existe; si no, copia el enlace al portapapeles. */
export async function shareLink(opts: { title: string; text: string; url: string }): Promise<ShareOutcome> {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share(opts)
      return 'shared'
    }
    await navigator.clipboard.writeText(opts.url)
    return 'copied'
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'failed'
    try {
      await navigator.clipboard.writeText(opts.url)
      return 'copied'
    } catch {
      return 'failed'
    }
  }
}
