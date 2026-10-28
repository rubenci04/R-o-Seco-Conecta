import { CATEGORY_LABEL, type CategoryId } from '@shared/categories'
import { parseAssistedBlocks, type AssistedEntry } from '@shared/assistedImport'
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { localInputToIso, nowLocalInput } from '@/lib/tucuman'
import { api } from '../api'
import { Field, Notice, TextArea, TextInput, useAction } from '../ui'

interface PreviewItem {
  ok: boolean
  error?: string
  platform?: 'facebook' | 'instagram'
  url?: string
  title?: string
  publishedAt?: string
  duplicate?: { reason: string; ofPostId: number } | null
  categories?: Array<{ id: string; confidence: number; reasons: string[] }>
  alert?: { kind: string; severity: string; reason: string } | null
  obituary?: { nameSuggestion: string | null } | null
  needsReview?: boolean
  outcome?: 'publicada' | 'revision-obituario' | 'duplicado'
}

const DUP: Record<string, string> = { 'external-id': 'misma publicación', url: 'mismo enlace', 'content-hash': 'mismo texto', 'near-duplicate': 'texto casi idéntico (p. ej. Facebook e Instagram)' }
const OUTCOME = {
  publicada: { label: 'Se publicará', tone: 'info' as const },
  'revision-obituario': { label: 'Quedará en revisión (posible obituario)', tone: 'warning' as const },
  duplicado: { label: 'Duplicada: se omite', tone: 'neutral' as const },
}
const BULK_PLACEHOLDER = 'https://www.facebook.com/…/posts/123\nFecha: 2026-10-28 09:30\nTexto de la primera publicación…\n---\nhttps://www.facebook.com/…/posts/124\nTexto de la segunda…'

/**
 * Importación asistida. La aplicación NO obtiene el texto desde el enlace (no hay una API autorizada que lo entregue):
 * la persona aporta enlace y texto —pegados o compartidos desde el teléfono— y el sistema clasifica, detecta duplicados
 * y muestra una vista previa antes de guardar nada.
 */
export function ImportPosts({ onDone }: { onDone: () => void }) {
  const [params] = useSearchParams()
  // Web Share Target: «Compartir» desde Facebook/Instagram hacia la app instalada trae el enlace y, a veces, algo de texto.
  const sharedUrl = params.get('url') ?? params.get('text')?.match(/https?:\/\/\S+/)?.[0] ?? ''
  const sharedText = (params.get('text') ?? '').replace(/https?:\/\/\S+/g, '').trim()
  const [mode, setMode] = useState<'una' | 'varias'>('una')
  const [f, setF] = useState({ url: sharedUrl, text: sharedText || params.get('title') || '', publishedAt: nowLocalInput() })
  const [bulk, setBulk] = useState('')
  const [entries, setEntries] = useState<AssistedEntry[]>([])
  const [preview, setPreview] = useState<PreviewItem[] | null>(null)
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const act = useAction()

  const collect = (): { list: AssistedEntry[]; errors: string[] } => {
    if (mode === 'una') return { list: [{ url: f.url.trim(), text: f.text.trim(), publishedAt: localInputToIso(f.publishedAt) || undefined }], errors: [] }
    const r = parseAssistedBlocks(bulk)
    return { list: r.entries, errors: r.errors }
  }

  const analyze = async (e: FormEvent) => {
    e.preventDefault()
    const { list, errors } = collect()
    setParseErrors(errors)
    setPreview(null)
    if (!list.length) return
    const r = await act.run(() => api.post<{ items: PreviewItem[] }>('/posts/import-preview', { items: list }), 'Vista previa lista. Revisala antes de importar.')
    if (r) {
      setEntries(list)
      setPreview(r.items)
    }
  }

  const confirm = async () => {
    if (!preview) return
    const done = await act.run(async () => {
      for (const [i, p] of preview.entries()) {
        if (!p.ok || p.outcome === 'duplicado') continue
        await api.post('/posts/import-link', { url: entries[i].url, text: entries[i].text, publishedAt: entries[i].publishedAt })
      }
      return true
    }, 'Importación terminada.')
    if (done) {
      setPreview(null)
      setBulk('')
      setF({ url: '', text: '', publishedAt: nowLocalInput() })
      onDone()
    }
  }

  const importable = preview?.filter((p) => p.ok && p.outcome !== 'duplicado').length ?? 0

  return (
    <Card className="space-y-3">
      <CardTitle>Importar publicaciones de Facebook o Instagram</CardTitle>
      <p className="text-sm text-muted-foreground">
        Pegá el enlace y el texto de la publicación (o compartila desde el teléfono con la app instalada). <strong>No se descarga nada de la red social ni se lee el enlace</strong>: el texto lo aportás vos.
        Antes de guardar se muestra cómo se clasificaría y si ya existe. Pasa por la misma revisión que cualquier noticia; los posibles obituarios siempre esperan a una persona.
      </p>
      <div className="flex gap-2" role="group" aria-label="Modo de importación">
        <Button type="button" size="sm" variant={mode === 'una' ? 'default' : 'outline'} aria-pressed={mode === 'una'} onClick={() => { setMode('una'); setPreview(null) }}>Una publicación</Button>
        <Button type="button" size="sm" variant={mode === 'varias' ? 'default' : 'outline'} aria-pressed={mode === 'varias'} onClick={() => { setMode('varias'); setPreview(null) }}>Varias a la vez</Button>
      </div>
      <form onSubmit={(e) => void analyze(e)} className="space-y-3">
        {act.message && <Notice tone={act.message.tone}>{act.message.text}</Notice>}
        {mode === 'una' ? (
          <>
            <Field label="Enlace de la publicación" htmlFor="imp-url">
              <TextInput id="imp-url" type="url" required placeholder="https://www.facebook.com/…  o  https://www.instagram.com/p/…" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
            </Field>
            <Field label="Texto de la publicación" htmlFor="imp-text">
              <TextArea id="imp-text" required rows={6} maxLength={20000} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
            </Field>
            <Field label="Fecha original de la publicación (Tucumán)" htmlFor="imp-date">
              <TextInput id="imp-date" type="datetime-local" required value={f.publishedAt} onChange={(e) => setF({ ...f, publishedAt: e.target.value })} />
            </Field>
          </>
        ) : (
          <Field label="Publicaciones" htmlFor="imp-bulk" hint="Separá cada publicación con una línea «---». En cada una: el enlace, opcionalmente «Fecha: 2026-10-28 14:30» (hora de Tucumán) y el texto. Hasta 20.">
            <TextArea id="imp-bulk" required rows={12} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={BULK_PLACEHOLDER} />
          </Field>
        )}
        <Button type="submit" disabled={act.busy}>Analizar y ver vista previa</Button>
      </form>

      {parseErrors.length > 0 && <Notice tone="error">{parseErrors.join(' ')}</Notice>}

      {preview && (
        <section aria-label="Vista previa de la importación" className="space-y-2">
          <h3 className="font-display font-bold">Vista previa</h3>
          <ul className="space-y-2">
            {preview.map((p, i) => (
              <li key={i} className="rounded-xl border border-border p-3 text-sm">
                {!p.ok ? (
                  <p className="text-danger">{p.error}</p>
                ) : (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={OUTCOME[p.outcome!].tone}>{OUTCOME[p.outcome!].label}</Badge>
                      <Badge>{p.platform === 'instagram' ? 'Instagram' : 'Facebook'}</Badge>
                      <strong>{p.title}</strong>
                    </div>
                    {p.duplicate && <p className="text-muted-foreground">Ya existe como la publicación #{p.duplicate.ofPostId}: {DUP[p.duplicate.reason] ?? p.duplicate.reason}.</p>}
                    <p>
                      Categorías:{' '}
                      {p.categories?.map((c) => `${CATEGORY_LABEL[c.id as CategoryId] ?? c.id} (${Math.round(c.confidence * 100)} %)`).join(', ') || '—'}
                    </p>
                    {p.alert && <p>Se propondrá un aviso ({p.alert.severity === 'urgente' ? 'urgente' : 'informativo'}): {p.alert.reason}. <strong>Una persona deberá confirmarlo antes de notificar.</strong></p>}
                    {p.obituary && <p>Posible obituario{p.obituary.nameSuggestion ? ` (nombre sugerido: ${p.obituary.nameSuggestion})` : ''}: quedará oculto hasta que lo valides en «Obituarios».</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Button type="button" disabled={act.busy || importable === 0} onClick={() => void confirm()}>
            Confirmar e importar {importable} {importable === 1 ? 'publicación' : 'publicaciones'}
          </Button>
        </section>
      )}
    </Card>
  )
}
