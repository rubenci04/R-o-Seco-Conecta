import { CATEGORY_IDS, CATEGORY_LABEL, isCategoryId } from '@shared/categories'
import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { formatTucuman, isoToLocalInput, localInputToIso, nowLocalInput } from '@/lib/tucuman'
import { api, type PostDetail, type PostSummary } from '../api'
import { canEdit, useAuth } from '../auth'
import { Field, Notice, PageTitle, StatusBadge, TextArea, TextInput, useAction, useAdminData } from '../ui'

const STATUS_FILTERS = [
  ['', 'Todas'],
  ['draft', 'Borradores'],
  ['pending', 'En revisión'],
  ['published', 'Publicadas'],
  ['rejected', 'Rechazadas'],
  ['deleted', 'Retiradas'],
] as const

export function PostsList() {
  const { admin } = useAuth()
  const [params, setParams] = useSearchParams()
  const estado = params.get('estado') ?? ''
  const q = params.get('q') ?? ''
  const { data, error, loading } = useAdminData(() => api.get<PostSummary[]>(`/posts?${new URLSearchParams({ ...(estado ? { estado } : {}), ...(q ? { q } : {}) })}`), [estado, q])

  return (
    <>
      <PageTitle title="Noticias">
        {canEdit(admin) && (
          <Button asChild>
            <Link to="/admin/noticias/nueva">
              <Plus className="size-4" aria-hidden />
              Nueva noticia
            </Link>
          </Button>
        )}
      </PageTitle>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={estado === value}
              onClick={() => setParams(value ? { estado: value } : {}, { replace: true })}
              className={`min-h-10 cursor-pointer rounded-full border px-3.5 text-sm font-semibold ${estado === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-w-48 flex-1 sm:max-w-xs">
          <TextInput type="search" aria-label="Buscar noticias" placeholder="Buscar…" defaultValue={q} onKeyDown={(e) => e.key === 'Enter' && setParams({ ...(estado ? { estado } : {}), q: e.currentTarget.value }, { replace: true })} />
        </div>
      </div>
      {loading && <p role="status">Cargando…</p>}
      {error && <Notice tone="error">{error.message}</Notice>}
      {data && data.length === 0 && <Notice>No hay noticias en esta vista.</Notice>}
      <ul className="space-y-2">
        {data?.map((p) => (
          <li key={p.id}>
            <Link to={`/admin/noticias/${p.id}`} className="block rounded-[var(--radius-card)] border border-border bg-card p-3.5 shadow-sm transition hover:bg-muted">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={p.status} />
                {p.review_state === 'needs_review' && <Badge tone="warning">Revisar clasificación</Badge>}
                <Badge>{p.origin === 'manual' ? 'Redacción' : p.origin === 'assisted' ? 'Importada por enlace' : 'Fuente conectada'}</Badge>
                <span className="text-xs text-muted-foreground">{formatTucuman(p.published_at)}</span>
              </div>
              <p className="mt-1 font-display font-bold">{p.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{p.categories.map((c) => CATEGORY_LABEL[c.id as keyof typeof CATEGORY_LABEL] ?? c.id).join(' · ') || 'Sin categoría'}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

interface FormState {
  title: string
  body: string
  sourceLabel: string
  url: string
  publishedAt: string
  categories: string[]
}
const EMPTY: FormState = { title: '', body: '', sourceLabel: '', url: '', publishedAt: '', categories: [] }

/** Carga la noticia y monta el formulario con los valores del servidor (se reinicia tras cada recarga). */
export function PostEditor() {
  const { id } = useParams()
  const { data, error, loading, reload } = useAdminData(() => (id ? api.get<PostDetail>(`/posts/${id}`) : Promise.resolve(null)), [id])
  // La confirmación vive acá: el formulario se vuelve a montar tras cada recarga y el aviso no debe perderse.
  const act = useAction()
  if (loading) return <p role="status">Cargando…</p>
  if (error) return <Notice tone="error">{error.message}</Notice>
  return <PostForm key={`${id ?? 'nueva'}-${data?.history.length ?? 0}-${data?.post.status ?? ''}`} id={id} data={data} reload={reload} act={act} />
}

function formFrom(data: PostDetail | null): FormState {
  if (!data) return { ...EMPTY, publishedAt: nowLocalInput() }
  return {
    title: data.post.title,
    body: data.post.body,
    sourceLabel: data.post.source_label ?? '',
    url: data.post.url ?? '',
    publishedAt: isoToLocalInput(data.post.published_at),
    categories: data.categories.map((c) => c.category_id),
  }
}

function PostForm({ id, data, reload, act }: { id?: string; data: PostDetail | null; reload: () => void; act: ReturnType<typeof useAction> }) {
  const isNew = !id
  const { admin } = useAuth()
  const editable = canEdit(admin)
  const navigate = useNavigate()
  const location = useLocation()
  const created = (location.state as { notice?: string[] } | null)?.notice
  const [form, setForm] = useState<FormState>(() => formFrom(data))
  const [rectNote, setRectNote] = useState('')

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))
  const toggleCat = (c: string) => set('categories', form.categories.includes(c) ? form.categories.filter((x) => x !== c) : [...form.categories, c])

  const payload = () => ({
    title: form.title.trim() || undefined,
    body: form.body,
    sourceLabel: form.sourceLabel.trim() || undefined,
    url: form.url.trim() || undefined,
    publishedAt: localInputToIso(form.publishedAt) || undefined,
    ...(form.categories.length ? { categories: form.categories } : {}),
  })

  const create = async (status: 'draft' | 'published') => {
    const r = await act.run(() => api.post<{ postId: number; status: string; categories: string[]; alertId: number | null; obituaryId: number | null }>('/posts', { ...payload(), status }), status === 'draft' ? 'Borrador guardado.' : 'Noticia publicada.')
    if (!r) return
    const notice: string[] = []
    if (r.obituaryId) notice.push('Detectamos un posible obituario: no se publica solo. Quedó en la cola de «Obituarios» para que una persona lo revise y apruebe.')
    if (r.alertId) notice.push('Se propuso una alerta a partir del texto. Revisala y confirmala en «Alertas» para que se vea en la aplicación.')
    if (!form.categories.length) notice.push(`Categorías propuestas por el sistema: ${r.categories.map((c) => CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c).join(', ')}. Podés cambiarlas.`)
    navigate(`/admin/noticias/${r.postId}`, { state: { notice } })
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!id) return
    await act.run(async () => {
      await api.patch(`/posts/${id}`, { title: form.title, body: form.body, sourceLabel: form.sourceLabel, url: form.url, publishedAt: localInputToIso(form.publishedAt) || undefined, ...(form.categories.length ? { categories: form.categories } : {}) })
      reload()
    }, 'Cambios guardados.')
  }
  const publish = () =>
    act.run(async () => {
      await api.post(`/posts/${id}/publish`)
      reload()
    }, 'Noticia publicada: ya aparece en la aplicación.')
  const withdraw = () =>
    act.run(async () => {
      if (!window.confirm('¿Retirar esta noticia? Dejará de verse en la aplicación (queda el historial).')) throw new Error('Cancelado.')
      await api.del(`/posts/${id}`)
      reload()
    }, 'Noticia retirada.')
  const rectify = () =>
    act.run(async () => {
      await api.post(`/posts/${id}/rectify`, { note: rectNote })
      setRectNote('')
      reload()
    }, 'Rectificación publicada.')

  const post = data?.post
  const classifier = data?.categories ?? []

  return (
    <>
      <PageTitle title={isNew ? 'Nueva noticia' : 'Editar noticia'}>
        {post && <StatusBadge status={post.status} />}
      </PageTitle>
      <p className="mb-3 text-sm">
        <Link to="/admin/noticias" className="font-semibold text-accent underline">
          ← Volver a Noticias
        </Link>
      </p>
      {created?.map((n) => (
        <div key={n} className="mb-2">
          <Notice>{n}</Notice>
        </div>
      ))}
      {act.message && <div className="mb-3"><Notice tone={act.message.tone}>{act.message.text}</Notice></div>}

      <form onSubmit={save} className="space-y-4">
        <Card className="space-y-4">
          <Field label="Título" htmlFor="title" hint="Si lo dejás vacío se usa la primera línea del texto.">
            <TextInput id="title" maxLength={200} value={form.title} disabled={!editable} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Texto de la noticia" htmlFor="body">
            <TextArea id="body" required rows={10} maxLength={20000} value={form.body} disabled={!editable} onChange={(e) => set('body', e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fuente (cómo se cita)" htmlFor="sourceLabel" hint="Ej.: Comuna de Río Seco, Radio Activa. Si queda vacío: Redacción Río Seco Conecta.">
              <TextInput id="sourceLabel" maxLength={120} value={form.sourceLabel} disabled={!editable} onChange={(e) => set('sourceLabel', e.target.value)} />
            </Field>
            <Field label="Enlace a la fuente (opcional)" htmlFor="url">
              <TextInput id="url" type="url" placeholder="https://…" value={form.url} disabled={!editable} onChange={(e) => set('url', e.target.value)} />
            </Field>
            <Field label="Fecha y hora de publicación (Tucumán)" htmlFor="publishedAt">
              <TextInput id="publishedAt" type="datetime-local" required value={form.publishedAt} disabled={!editable} onChange={(e) => set('publishedAt', e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card className="space-y-3">
          <CardTitle>Categorías</CardTitle>
          <p className="text-sm text-muted-foreground">Elegí una o varias. Si no elegís ninguna, el sistema propone categorías según el texto y vos las podés corregir después.</p>
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Categorías de la noticia</legend>
            {CATEGORY_IDS.map((c) => (
              <label key={c} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-semibold">
                <input type="checkbox" className="size-4" checked={form.categories.includes(c)} disabled={!editable} onChange={() => toggleCat(c)} />
                {CATEGORY_LABEL[c]}
              </label>
            ))}
          </fieldset>
          {classifier.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-accent">Cómo clasificó el sistema</summary>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {classifier.map((c) => (
                  <li key={c.category_id}>
                    {isCategoryId(c.category_id) ? CATEGORY_LABEL[c.category_id] : c.category_id}: {c.proposed_by === 'editor' ? 'confirmada por una persona' : `propuesta (${Math.round(c.confidence * 100)} % de confianza)`}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>

        {editable && (
          <div className="flex flex-wrap gap-2">
            {isNew ? (
              <>
                <Button type="button" variant="outline" disabled={act.busy || !form.body.trim()} onClick={() => void create('draft')}>
                  Guardar borrador
                </Button>
                <Button type="button" disabled={act.busy || !form.body.trim()} onClick={() => void create('published')}>
                  Publicar ahora
                </Button>
              </>
            ) : (
              <>
                <Button type="submit" disabled={act.busy}>
                  Guardar cambios
                </Button>
                {post && post.status !== 'published' && (
                  <Button type="button" variant="outline" disabled={act.busy} onClick={() => void publish()}>
                    Publicar
                  </Button>
                )}
                {post?.status === 'published' && (
                  <Button type="button" variant="outline" disabled={act.busy} onClick={() => void withdraw()}>
                    Retirar de la aplicación
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </form>

      {post && editable && post.status === 'published' && (
        <Card className="mt-5 space-y-3">
          <CardTitle>Rectificación</CardTitle>
          {post.rectification && <p className="rounded-xl bg-warning-soft p-2.5 text-sm text-warning">Rectificación actual: {post.rectification}</p>}
          <Field label="Texto de la rectificación (se muestra públicamente en la nota)" htmlFor="rect">
            <TextArea id="rect" rows={3} maxLength={1000} value={rectNote} onChange={(e) => setRectNote(e.target.value)} />
          </Field>
          <Button type="button" variant="outline" disabled={act.busy || !rectNote.trim()} onClick={() => void rectify()}>
            Publicar rectificación
          </Button>
        </Card>
      )}

      {data && (
        <Card className="mt-5 space-y-2">
          <CardTitle>Historial de modificaciones</CardTitle>
          {data.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.history.map((h, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                  <span>
                    <strong>{h.actor_label}</strong> · {h.action}
                    {h.note ? ` — ${h.note}` : ''}
                  </span>
                  <span className="text-muted-foreground">{formatTucuman(h.at)}</span>
                </li>
              ))}
            </ul>
          )}
          {post && (
            <p className="text-xs text-muted-foreground">
              Ingresó el {formatTucuman(post.imported_at)} · origen: {post.origin === 'manual' ? 'redacción' : post.origin === 'assisted' ? 'importación por enlace' : 'fuente conectada'}
            </p>
          )}
        </Card>
      )}
    </>
  )
}
