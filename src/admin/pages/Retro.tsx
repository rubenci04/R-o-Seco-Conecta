import { CATEGORY_LABEL, type CategoryId } from '@shared/categories'
import { CONTENT_TYPES, CONTENT_TYPE_LABEL, type ContentType } from '@shared/postLinks'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { localInputToIso } from '@/lib/tucuman'
import { api } from '../api'
import { canEdit, useAuth } from '../auth'
import { Field, Notice, PageTitle, TextArea, TextInput, useAction } from '../ui'
import { MANUAL_CATEGORIES } from './RegisterLink'

interface Row {
  url: string
  title: string
  text: string
  date: string
  contentType: '' | ContentType
  categories: string[]
  reviewed: boolean
}
interface ResultItem {
  ok: boolean
  error?: string
  url?: string
  platform?: string
  title?: string
  textSource?: 'texto' | 'enlace'
  dateVerified?: boolean
  safe?: boolean
  outcome?: 'publicada' | 'revision' | 'revision-obituario' | 'duplicado' | 'completada'
  postId?: number
  duplicate?: { ofPostId: number; linkOnly: boolean; reason: string } | null
  categories?: Array<{ id: string; confidence: number }>
  alert?: { severity: string; reason: string } | null
  obituary?: { nameSuggestion: string | null } | null
}

const OUTCOME = {
  publicada: { label: 'Se publica (categoría segura)', tone: 'info' as const },
  revision: { label: 'Queda en revisión', tone: 'warning' as const },
  'revision-obituario': { label: 'Posible obituario: revisión obligatoria', tone: 'danger' as const },
  duplicado: { label: 'Duplicada: se omite', tone: 'neutral' as const },
  completada: { label: 'Tarjeta existente completada con el texto', tone: 'info' as const },
}
const emptyRow = (url: string): Row => ({ url, title: '', text: '', date: '', contentType: '', categories: [], reviewed: false })
const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

/**
 * «Recuperar publicaciones anteriores»: carga retroactiva por enlaces, revisada una por una.
 * Todo lo que entra queda marcado como histórico (nunca notifica ni propone avisos). Solo se publican solas las categorías seguras;
 * obituarios y servicios (agua, energía, calles, residuos, meteorología) quedan en revisión.
 */
export function RetroImport() {
  const { admin } = useAuth()
  const [from, setFrom] = useState(daysAgo(7))
  const [to, setTo] = useState(today())
  const [links, setLinks] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [publishSafe, setPublishSafe] = useState(false)
  const [result, setResult] = useState<{ items: ResultItem[]; committed: boolean } | null>(null)
  const act = useAction()

  const load = (e: FormEvent) => {
    e.preventDefault()
    const urls = [...new Set(links.split(/\s+/).filter((u) => /^https?:\/\//.test(u)))].slice(0, 25)
    setRows(urls.map(emptyRow))
    setResult(null)
  }
  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const body = () => ({
    periodFrom: from || undefined,
    periodTo: to || undefined,
    publishSafe,
    items: rows.map((r) => ({
      url: r.url,
      title: r.title.trim() || undefined,
      text: r.text.trim() || undefined,
      publishedAt: localInputToIso(r.date) || undefined,
      contentType: r.contentType || undefined,
      categories: r.categories,
      reviewed: r.reviewed,
    })),
  })

  const run = async (commit: boolean) => {
    if (commit && !window.confirm('¿Importar estas publicaciones? Quedan marcadas como históricas y no envían notificaciones.')) return
    const r = await act.run(() => api.post<{ items: ResultItem[] }>(commit ? '/posts/retro-import' : '/posts/retro-preview', body()), commit ? 'Importación terminada.' : 'Revisión lista. Controlá cada publicación.')
    if (r) setResult({ items: r.items, committed: commit })
  }

  if (!canEdit(admin)) return <Notice>Necesitás permisos de edición para recuperar publicaciones.</Notice>

  return (
    <>
      <PageTitle title="Recuperar publicaciones anteriores" />
      <Notice>
        Herramienta de carga retroactiva. <strong>No se descarga nada de Facebook</strong>: vos aportás los enlaces (y el texto, si lo tenés). Lo importado queda marcado como <strong>histórico</strong>: no envía
        notificaciones ni propone avisos urgentes, y las fechas solo se guardan si las comprobaste.
      </Notice>
      {act.message && <div className="mt-3"><Notice tone={act.message.tone}>{act.message.text}</Notice></div>}

      <Card className="mt-4 space-y-3">
        <CardTitle>1. Período e enlaces</CardTitle>
        <form onSubmit={load} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Desde" htmlFor="retro-from"><TextInput id="retro-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Hasta" htmlFor="retro-to"><TextInput id="retro-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <Field label="Enlaces de las publicaciones (uno por línea, hasta 25)" htmlFor="retro-links">
            <TextArea id="retro-links" required rows={5} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://www.facebook.com/reel/…" />
          </Field>
          <Button type="submit">Armar la lista</Button>
        </form>
      </Card>

      {rows.length > 0 && (
        <Card className="mt-4 space-y-3">
          <CardTitle>2. Revisión una por una ({rows.length})</CardTitle>
          <p className="text-sm text-muted-foreground">
            Con texto, el clasificador existente propone las categorías. Sin texto, escribí un título descriptivo y marcá solo las categorías que comprobaste al ver la publicación.
          </p>
          <ol className="space-y-3">
            {rows.map((r, i) => (
              <li key={r.url} className="space-y-2 rounded-xl border border-border p-3 text-sm">
                <p className="break-all font-semibold">{i + 1}. {r.url}</p>
                <Field label="Título (obligatorio si no hay texto)" htmlFor={`rt-${i}`}><TextInput id={`rt-${i}`} maxLength={200} value={r.title} onChange={(e) => patch(i, { title: e.target.value })} /></Field>
                <Field label="Texto original (si lo conseguiste de forma legítima)" htmlFor={`rx-${i}`}><TextArea id={`rx-${i}`} rows={3} value={r.text} onChange={(e) => patch(i, { text: e.target.value })} /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Fecha original comprobada (Tucumán)" htmlFor={`rd-${i}`}><TextInput id={`rd-${i}`} type="datetime-local" value={r.date} onChange={(e) => patch(i, { date: e.target.value })} /></Field>
                  <Field label="Tipo" htmlFor={`rk-${i}`}>
                    <select id={`rk-${i}`} className="min-h-11 w-full rounded-xl border border-border bg-card px-3" value={r.contentType} onChange={(e) => patch(i, { contentType: e.target.value as Row['contentType'] })}>
                      <option value="">Según el enlace</option>
                      {CONTENT_TYPES.map((t) => <option key={t} value={t}>{CONTENT_TYPE_LABEL[t]}</option>)}
                    </select>
                  </Field>
                </div>
                {!r.text.trim() && (
                  <fieldset className="flex flex-wrap gap-2">
                    <legend className="mb-1 font-semibold">Categorías comprobadas</legend>
                    {MANUAL_CATEGORIES.map((c) => (
                      <label key={c} className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-semibold">
                        <input type="checkbox" checked={r.categories.includes(c)} onChange={() => patch(i, { categories: r.categories.includes(c) ? r.categories.filter((x) => x !== c) : [...r.categories, c] })} />
                        {CATEGORY_LABEL[c]}
                      </label>
                    ))}
                  </fieldset>
                )}
                <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={r.reviewed} onChange={(e) => patch(i, { reviewed: e.target.checked })} /> Vi la publicación y confirmo título y categorías</label>
                <Button type="button" size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Quitar de la lista</Button>
              </li>
            ))}
          </ol>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 size-4" checked={publishSafe} onChange={(e) => setPublishSafe(e.target.checked)} />
            <span>Publicar en bloque solo las de <strong>categorías seguras</strong> (nunca obituarios, avisos de agua, energía, calles, residuos o clima: esas siempre quedan en revisión).</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={act.busy} onClick={() => void run(false)}>Revisar sin guardar</Button>
            <Button type="button" disabled={act.busy} onClick={() => void run(true)}>Importar</Button>
          </div>
        </Card>
      )}

      {result && (
        <Card className="mt-4 space-y-2">
          <CardTitle>{result.committed ? 'Resultado de la importación' : 'Vista previa (no se guardó nada)'}</CardTitle>
          <ul className="space-y-2">
            {result.items.map((it, i) => (
              <li key={i} className="rounded-xl border border-border p-3 text-sm">
                {!it.ok ? (
                  <p className="text-danger">{it.url ? `${it.url}: ` : ''}{it.error}</p>
                ) : (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={OUTCOME[it.outcome!].tone}>{OUTCOME[it.outcome!].label}</Badge>
                      <Badge>{it.textSource === 'texto' ? 'Con texto' : 'Solo enlace'}</Badge>
                      <Badge>{it.dateVerified ? 'Fecha verificada' : 'Fecha sin verificar'}</Badge>
                      <strong>{it.title}</strong>
                    </div>
                    {it.duplicate && <p className="text-muted-foreground">Ya existe como #{it.duplicate.ofPostId}.</p>}
                    <p>Categorías: {it.categories?.map((c) => `${CATEGORY_LABEL[c.id as CategoryId] ?? c.id}`).join(', ') || 'ninguna'}</p>
                    {it.alert && <p>Contiene un posible aviso: no se crea por ser material histórico.</p>}
                    {it.obituary && <p>Posible obituario{it.obituary.nameSuggestion ? ` (${it.obituary.nameSuggestion})` : ''}: queda oculto hasta que una persona lo apruebe en «Obituarios».</p>}
                    {it.postId && <Link className="font-semibold text-accent underline" to={`/admin/noticias/${it.postId}`}>Abrir #{it.postId}</Link>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
