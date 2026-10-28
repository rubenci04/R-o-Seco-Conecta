import { Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ExternalLink } from '@/components/shared/ExternalLink'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { LINKS } from '@/config/links'

/** Dirección del Page Plugin oficial de Facebook (documentado en developers.facebook.com/docs/plugins/page-plugin). */
export function pagePluginUrl(width: number, height: number, href: string = LINKS.comuna.facebook): string {
  const p = new URLSearchParams({ href, tabs: 'timeline', width: String(width), height: String(height), small_header: 'true', adapt_container_width: 'true', hide_cover: 'true', show_facepile: 'false', locale: 'es_LA' })
  return `https://www.facebook.com/plugins/page.php?${p}`
}

/**
 * Cronología pública de la página oficial de la Comuna, mostrada por el widget OFICIAL de Facebook.
 *  - Privacidad: no se carga nada de Facebook hasta que la persona lo pide (Facebook podría registrar su visita).
 *  - Es contenido de Facebook, no datos de esta aplicación: no alimenta el clasificador ni las alertas.
 *  - Si el navegador bloquea el widget (bloqueadores, cookies de terceros) o Facebook no responde, el enlace directo sigue disponible.
 */
export function FacebookTimeline({ height = 640, id = 'facebook' }: { height?: number; id?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(340)
  const [requested, setRequested] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.min(500, Math.floor(e.contentRect.width)))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!requested || loaded) return
    const t = setTimeout(() => setSlow(true), 8000)
    return () => clearTimeout(t)
  }, [requested, loaded])

  return (
    <Card className="space-y-3" aria-labelledby={`${id}-title`}>
      <div className="flex items-center gap-2">
        <Users className="size-5 text-accent" aria-hidden />
        <CardTitle id={`${id}-title`}>Publicaciones recientes de la Comuna en Facebook</CardTitle>
      </div>
      <p className="text-xs text-muted-foreground">
        Contenido proporcionado por Facebook, tal como lo publica la página oficial de la Comuna. No es verificado ni clasificado por esta aplicación.
      </p>
      <div ref={box} className="w-full">
        {!requested ? (
          <div className="space-y-2 rounded-xl bg-muted p-4 text-sm">
            <p>
              Para verlas, tu navegador se conecta a Facebook (<span translate="no">facebook.com</span>), que puede usar cookies y registrar la visita según su política. No cargamos nada de Facebook hasta que lo pidas.
            </p>
            <Button type="button" onClick={() => setRequested(true)}>Ver publicaciones de Facebook</Button>
          </div>
        ) : (
          <iframe
            title="Publicaciones de la Comuna de Río Seco en Facebook"
            src={pagePluginUrl(width, height)}
            width={width}
            height={height}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            referrerPolicy="origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            className="mx-auto block max-w-full rounded-xl border border-border bg-card"
          />
        )}
      </div>
      {requested && (slow || !loaded) && (
        <p className="text-xs text-muted-foreground" role="status">
          {slow && !loaded ? 'Facebook no respondió o tu navegador lo bloquea (bloqueador de contenido o cookies de terceros). ' : 'Si no se ve nada, tu navegador puede estar bloqueando el contenido de Facebook. '}
          Podés leer las publicaciones directamente en Facebook.
        </p>
      )}
      <p className="text-sm">
        <ExternalLink href={LINKS.comuna.facebook} className="font-semibold text-accent underline underline-offset-2">Abrir la página de la Comuna en Facebook</ExternalLink>
        {' · '}
        <ExternalLink href={LINKS.comuna.instagram} className="font-semibold text-accent underline underline-offset-2">Instagram</ExternalLink>
      </p>
    </Card>
  )
}
