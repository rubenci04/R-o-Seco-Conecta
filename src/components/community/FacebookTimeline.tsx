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
 *  - Se muestra ABIERTA por defecto (la primera visita la ve expandida). «Ocultar publicaciones» lo recuerda en localStorage.
 *  - Carga diferida: el iframe se pide recién cuando la sección se acerca a la pantalla, sin exigir un clic.
 *  - Privacidad: se avisa que el contenido viene de Facebook y que el navegador se conecta a un tercero.
 *  - Es contenido de Facebook, no datos de esta aplicación: no alimenta el clasificador ni las alertas.
 *  - Si el navegador bloquea el widget (bloqueadores, cookies de terceros) o Facebook no responde, el enlace directo sigue disponible.
 */
const HIDDEN_KEY = 'rsc.facebook.hidden'
function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

export function FacebookTimeline({ height = 640, id = 'facebook' }: { height?: number; id?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(340)
  const [hidden, setHidden] = useState(readHidden)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  const requested = !hidden && near
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
    const el = box.current
    if (near || !el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  const toggle = () => {
    const next = !hidden
    setHidden(next)
    try {
      localStorage.setItem(HIDDEN_KEY, next ? '1' : '0')
    } catch {
      /* sin almacenamiento: la preferencia vale solo para esta visita */
    }
  }

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
        Contenido proporcionado por Facebook, tal como lo publica la página oficial de la Comuna. No es verificado ni clasificado por esta aplicación y es distinto de las noticias de Río Seco Conecta.
        Al mostrarlo, tu navegador se conecta a Facebook (<span translate="no">facebook.com</span>), un tercero que puede usar cookies y registrar la visita.
      </p>
      <Button type="button" size="sm" variant="outline" aria-expanded={!hidden} aria-controls={`${id}-frame`} onClick={toggle}>
        {hidden ? 'Mostrar publicaciones' : 'Ocultar publicaciones'}
      </Button>
      <div ref={box} id={`${id}-frame`} className="w-full">
        {hidden ? null : !requested ? (
          <div className="rounded-xl bg-muted p-4 text-sm" style={{ minHeight: 120 }} aria-hidden>Cargando publicaciones…</div>
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
