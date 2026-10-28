import { embedUrlFor, contentTypeFromUrl } from '@shared/postLinks'
import { useEffect, useRef, useState } from 'react'
import { ExternalLink } from '@/components/shared/ExternalLink'
import { Button } from '@/components/ui/button'

const SLOW_MS = 8000

/**
 * Publicación original de Facebook o Instagram incrustada con el método OFICIAL de Meta (iframe de plugins/post, plugins/video o /embed).
 * Es opcional y diferida: nada se pide a Meta hasta que la persona toca el botón (Meta puede usar cookies y registrar la visita).
 * No se lee el contenido del iframe ni se usa para clasificar. Si Meta no permite incrustarla o el navegador la bloquea, queda el enlace.
 */
export function PostEmbed({ url, label = 'Ver la publicación original' }: { url?: string; label?: string }) {
  const [open, setOpen] = useState(false)
  const [slow, setSlow] = useState(false)
  const [width, setWidth] = useState(500)
  const box = useRef<HTMLDivElement>(null)
  const kind = url ? contentTypeFromUrl(url) : 'publicacion'
  const src = open ? embedUrlFor(url, width) : null

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => setSlow(true), SLOW_MS)
    return () => window.clearTimeout(t)
  }, [open])

  if (!url || !embedUrlFor(url)) return null
  const instagram = /instagram\.com/.test(url)
  const height = instagram ? 640 : kind === 'reel' ? 600 : kind === 'video' ? 420 : 520

  return (
    <div ref={box} className="space-y-2">
      {!open ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setWidth(Math.min(500, Math.max(280, Math.floor(box.current?.clientWidth ?? 500))))
            setSlow(false)
            setOpen(true)
          }}
        >
          {label}
        </Button>
      ) : (
        <>
          <iframe
            title={`Publicación original en ${instagram ? 'Instagram' : 'Facebook'}`}
            src={src ?? undefined}
            width={width}
            height={height}
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="origin"
            className="max-w-full rounded-xl border border-border bg-muted"
          />
          <p className="text-xs text-muted-foreground">Contenido proporcionado por {instagram ? 'Instagram' : 'Facebook'} (Meta), que puede usar cookies. La redacción no controla ni analiza este contenido.</p>
          {slow && <p className="text-xs text-muted-foreground">Si no ves la publicación, tu navegador o una extensión puede estar bloqueando el contenido de {instagram ? 'Instagram' : 'Facebook'}, o la publicación no permite incrustarse. Usá el enlace de abajo.</p>}
        </>
      )}
      <p className="text-sm">
        <ExternalLink href={url} className="font-semibold text-accent underline underline-offset-2">
          Abrir la publicación en {instagram ? 'Instagram' : 'Facebook'}
        </ExternalLink>
      </p>
    </div>
  )
}
