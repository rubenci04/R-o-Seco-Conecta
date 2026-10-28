import { CATEGORY_IDS, CATEGORY_LABEL } from '@shared/categories'
import { CONTENT_TYPES, CONTENT_TYPE_LABEL, type ContentType } from '@shared/postLinks'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { PostEmbed } from '@/components/content/PostEmbed'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { localInputToIso } from '@/lib/tucuman'
import { api } from '../api'
import { Field, Notice, TextInput, useAction } from '../ui'

interface LinkPreview {
  platform: 'facebook' | 'instagram'
  url: string
  contentType: ContentType
  embedUrl: string | null
  duplicate: { ofPostId: number; status: string; linkOnly: boolean; reason: string } | null
}

/** Categorías que una persona puede asignar a mano a una tarjeta sin texto (los obituarios tienen su propia cola verificada). */
export const MANUAL_CATEGORIES = CATEGORY_IDS.filter((c) => c !== 'obituarios')

/**
 * «Registrar publicación de Facebook»: crea UNA tarjeta individual solo con el enlace. No se descarga ni analiza nada:
 * título, tipo y categorías los pone una persona que vio la publicación; la fecha solo se guarda si la comprobó.
 */
export function RegisterLink({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState('')
  const [pv, setPv] = useState<LinkPreview | null>(null)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<ContentType>('publicacion')
  const [date, setDate] = useState('')
  const [cats, setCats] = useState<string[]>([])
  const [reviewed, setReviewed] = useState(false)
  const [saved, setSaved] = useState<number | null>(null)
  const act = useAction()

  const check = async (e: FormEvent) => {
    e.preventDefault()
    setSaved(null)
    setPv(null)
    const r = await act.run(() => api.post<LinkPreview>('/posts/link-preview', { url: url.trim() }), 'Enlace válido. Revisá la publicación y completá los datos.')
    if (r) {
      setPv(r)
      setType(r.contentType)
    }
  }

  const save = async (publish: boolean) => {
    const r = await act.run(
      () => api.post<{ postId: number }>('/posts/register-link', { url: pv?.url, title, contentType: type, publishedAt: localInputToIso(date) || undefined, categories: cats, reviewed, publish }),
      publish ? 'Tarjeta publicada en el feed.' : 'Tarjeta guardada como borrador.',
    )
    if (r) {
      setSaved(r.postId)
      setPv(null)
      setUrl('')
      setTitle('')
      setDate('')
      setCats([])
      setReviewed(false)
      onDone()
    }
  }

  return (
    <Card className="space-y-3">
      <CardTitle>Registrar publicación de Facebook</CardTitle>
      <p className="text-sm text-muted-foreground">
        Para una publicación de la que solo tenés el enlace. Se crea <strong>una tarjeta individual</strong> con el enlace y, si Facebook lo permite, la publicación incrustada. <strong>No se inventa resumen,
        fecha ni categoría</strong> y no se analiza automáticamente: no genera alertas ni obituarios. Si después conseguís el texto, completás esta misma tarjeta.
      </p>
      {act.message && <Notice tone={act.message.tone}>{act.message.text}</Notice>}
      {saved && (
        <p className="text-sm">
          <Link className="font-semibold text-accent underline" to={`/admin/noticias/${saved}`}>Ver la tarjeta #{saved}</Link>
        </p>
      )}
      <form onSubmit={(e) => void check(e)} className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <Field label="Enlace de la publicación" htmlFor="reg-url">
            <TextInput id="reg-url" type="url" required placeholder="https://www.facebook.com/reel/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" disabled={act.busy}>Validar enlace</Button>
      </form>

      {pv && (
        <div className="space-y-3 rounded-xl border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{pv.platform === 'instagram' ? 'Instagram' : 'Facebook'}</Badge>
            <span className="break-all text-xs text-muted-foreground">{pv.url}</span>
          </div>
          {pv.duplicate ? (
            <Notice tone="error">
              Ya existe como la tarjeta <Link className="font-semibold underline" to={`/admin/noticias/${pv.duplicate.ofPostId}`}>#{pv.duplicate.ofPostId}</Link>
              {pv.duplicate.linkOnly ? ': podés completarla con el texto desde ahí.' : '.'} No se crea otra.
            </Notice>
          ) : (
            <>
              <PostEmbed url={pv.url} label="Ver cómo se muestra incrustada" />
              <Field label="Título descriptivo (lo escribís vos)" htmlFor="reg-title" hint="Describí solo lo que viste en la publicación. Es el título de la tarjeta.">
                <TextInput id="reg-title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tipo de contenido" htmlFor="reg-type">
                  <select id="reg-type" className="min-h-11 w-full rounded-xl border border-border bg-card px-3" value={type} onChange={(e) => setType(e.target.value as ContentType)}>
                    {CONTENT_TYPES.map((t) => <option key={t} value={t}>{CONTENT_TYPE_LABEL[t]}</option>)}
                  </select>
                </Field>
                <Field label="Fecha original (Tucumán) — solo si la comprobaste" htmlFor="reg-date" hint="Si la dejás vacía, la tarjeta dice «Registrada el…» y no se muestra como fecha de la publicación.">
                  <TextInput id="reg-date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
              </div>
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="mb-1 text-sm font-semibold">Categorías (opcional; solo las que comprobaste al ver la publicación)</legend>
                {MANUAL_CATEGORIES.map((c) => (
                  <label key={c} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-semibold">
                    <input type="checkbox" className="size-4" checked={cats.includes(c)} onChange={() => setCats(cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c])} />
                    {CATEGORY_LABEL[c]}
                  </label>
                ))}
              </fieldset>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 size-4" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                <span>Vi la publicación completa y confirmo el título y las categorías (se muestra como «Revisada por la redacción»).</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={act.busy || !title.trim()} onClick={() => void save(false)}>Guardar borrador</Button>
                <Button type="button" disabled={act.busy || !title.trim()} onClick={() => void save(true)}>Publicar en el feed</Button>
              </div>
              <p className="text-xs text-muted-foreground">Las tarjetas por enlace nunca envían notificaciones.</p>
            </>
          )}
        </div>
      )}
    </Card>
  )
}
