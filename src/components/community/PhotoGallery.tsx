import { ExternalLink } from '@/components/shared/ExternalLink'
import { PHOTOS, PHOTO_SOURCE } from '@/config/photos'

/** Fotografías de la Comuna con su fuente siempre visible. Carga diferida; sin recortes que alteren la imagen. */
export function PhotoGallery({ ids, columns = 'sm:grid-cols-3' }: { ids: string[]; columns?: string }) {
  const photos = ids.map((id) => PHOTOS[id]).filter(Boolean)
  if (!photos.length) return null
  return (
    <figure className="space-y-2">
      <ul className={`grid grid-cols-2 gap-2 ${columns}`}>
        {photos.map((p) => (
          <li key={p.id} className="overflow-hidden rounded-xl bg-muted">
            <img src={p.src} alt={p.alt} width={p.width} height={p.height} loading="lazy" decoding="async" className="aspect-[4/3] h-full w-full object-cover" />
          </li>
        ))}
      </ul>
      <figcaption className="text-xs text-muted-foreground">
        Fotografías de la página pública de la Comuna. Fuente:{' '}
        <ExternalLink href={PHOTO_SOURCE.url} className="text-accent underline">
          {PHOTO_SOURCE.label}
        </ExternalLink>
        .
      </figcaption>
    </figure>
  )
}
