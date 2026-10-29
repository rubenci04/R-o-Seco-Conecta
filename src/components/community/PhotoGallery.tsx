import { ExternalLink } from '@/components/shared/ExternalLink'
import { PHOTOS, PHOTO_SOURCE } from '@/config/photos'

/** Fotografías de la Comuna con su fuente siempre visible. Carga diferida; sin recortes que alteren la imagen. */
export function PhotoGallery({ ids, columns = 'sm:grid-cols-3' }: { ids: string[]; columns?: string }) {
  const photos = ids.map((id) => PHOTOS[id]).filter(Boolean)
  if (!photos.length) return null
  const hasPhotos = photos.some((p) => p.kind !== 'ilustracion')
  const hasAi = photos.some((p) => p.kind === 'ilustracion')
  return (
    <figure className="space-y-2">
      <ul className={`grid grid-cols-2 gap-2 ${columns}`}>
        {photos.map((p) => (
          <li key={p.id} className="overflow-hidden rounded-xl bg-muted">
            {p.kind === 'ilustracion' && <p className="px-2 pt-1.5 text-xs font-semibold text-muted-foreground">Ilustración generada con IA</p>}
            <img src={p.src} alt={p.alt} width={p.width} height={p.height} loading="lazy" decoding="async" className="aspect-[4/3] h-full w-full object-cover" />
          </li>
        ))}
      </ul>
      <figcaption className="text-xs text-muted-foreground">
        {!hasPhotos ? (
          'Ilustración generada con IA aportada por el equipo, con su marca original. No es una fotografía documental ni se le atribuye un autor.'
        ) : (
          <>
            {photos.length > 1 ? 'Fotografías' : 'Fotografía'}
            {hasAi ? ' (la ilustración generada con IA no es una fotografía documental)' : ''} aportada{photos.length > 1 ? 's' : ''} por el equipo, de la página pública de la Comuna. Fuente:{' '}
            <ExternalLink href={PHOTO_SOURCE.url} className="text-accent underline">
              {PHOTO_SOURCE.label}
            </ExternalLink>
            .
          </>
        )}
      </figcaption>
    </figure>
  )
}
