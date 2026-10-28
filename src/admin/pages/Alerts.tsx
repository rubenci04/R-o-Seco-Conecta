import { useState, type FormEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { formatTucuman, isoToLocalInput, localInputToIso, nowLocalInput } from '@/lib/tucuman'
import { api, type AlertRow } from '../api'
import { canEdit, useAuth } from '../auth'
import { Field, Notice, PageTitle, Select, StatusBadge, TextArea, TextInput, useAction, useAdminData } from '../ui'

const KINDS: Record<string, string> = { agua: 'Corte de agua', energia: 'Corte de energía', calles: 'Calle cortada', meteorologica: 'Alerta meteorológica', comunicado: 'Aviso importante' }
const FILTERS = [
  ['', 'Todas'],
  ['proposed', 'Sin confirmar'],
  ['confirmed', 'Confirmadas'],
  ['dismissed', 'Descartadas'],
] as const

const isExpired = (a: AlertRow) => !!a.expires_at && new Date(a.expires_at) <= new Date()

function AlertForm({ initial, onDone }: { initial?: AlertRow; onDone: () => void }) {
  const act = useAction()
  const [f, setF] = useState({
    kind: initial?.kind ?? 'agua',
    severity: initial?.severity ?? 'info',
    priority: String(initial?.priority ?? 1),
    title: initial?.title ?? '',
    body: initial?.body ?? '',
    sourceUrl: initial?.source_url ?? '',
    startsAt: isoToLocalInput(initial?.starts_at) || nowLocalInput(),
    expiresAt: isoToLocalInput(initial?.expires_at),
    confirm: false,
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await act.run(async () => {
      if (initial) {
        await api.patch(`/alerts/${initial.id}`, { title: f.title, body: f.body, priority: Number(f.priority), severity: f.severity, expires_at: localInputToIso(f.expiresAt) || null })
      } else {
        await api.post('/alerts', { kind: f.kind, severity: f.severity, priority: Number(f.priority), title: f.title, body: f.body, sourceUrl: f.sourceUrl || undefined, startsAt: localInputToIso(f.startsAt), expiresAt: localInputToIso(f.expiresAt) || undefined, confirm: f.confirm })
      }
      return true
    }, initial ? 'Alerta actualizada.' : f.confirm ? 'Alerta publicada.' : 'Alerta guardada, falta confirmarla.')
    if (ok) onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {act.message && <Notice tone={act.message.tone}>{act.message.text}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        {!initial && (
          <Field label="Tipo" htmlFor="kind">
            <Select id="kind" value={f.kind} onChange={(e) => set('kind', e.target.value)}>
              {Object.entries(KINDS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Gravedad" htmlFor="severity" hint="Las urgentes necesitan confirmación editorial.">
          <Select id="severity" value={f.severity} onChange={(e) => set('severity', e.target.value as 'info' | 'urgente')}>
            <option value="info">Informativa</option>
            <option value="urgente">Urgente</option>
          </Select>
        </Field>
        <Field label="Prioridad (0–3)" htmlFor="priority">
          <Select id="priority" value={f.priority} onChange={(e) => set('priority', e.target.value)}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Título" htmlFor="a-title">
        <TextInput id="a-title" required maxLength={200} value={f.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="Descripción" htmlFor="a-body">
        <TextArea id="a-body" required rows={4} maxLength={2000} value={f.body} onChange={(e) => set('body', e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {!initial && (
          <Field label="Inicio (hora de Tucumán)" htmlFor="startsAt">
            <TextInput id="startsAt" type="datetime-local" required value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
          </Field>
        )}
        <Field label="Vencimiento (hora de Tucumán)" htmlFor="expiresAt" hint="Al vencer deja de mostrarse sola.">
          <TextInput id="expiresAt" type="datetime-local" value={f.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
        </Field>
        {!initial && (
          <Field label="Enlace a la fuente (opcional)" htmlFor="a-src">
            <TextInput id="a-src" type="url" placeholder="https://…" value={f.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} />
          </Field>
        )}
      </div>
      {!initial && (
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-border bg-background p-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={f.confirm} onChange={(e) => set('confirm', e.target.checked)} />
          <span>
            <strong>Confirmar y publicar ahora.</strong> Confirmo que la información proviene de una fuente verificada.
            {f.severity === 'urgente' && ' Es una alerta urgente: solo una persona con permiso de confirmación urgente puede publicarla.'}
          </span>
        </label>
      )}
      <Button type="submit" disabled={act.busy}>
        {initial ? 'Guardar cambios' : f.confirm ? 'Crear y publicar' : 'Guardar sin publicar'}
      </Button>
    </form>
  )
}

export function AlertsAdmin() {
  const { admin } = useAuth()
  const editable = canEdit(admin)
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const { data, error, loading, reload } = useAdminData(() => api.get<AlertRow[]>(`/alerts${filter ? `?estado=${filter}` : ''}`), [filter])
  const act = useAction()

  const confirm = (a: AlertRow) => act.run(async () => { await api.post(`/alerts/${a.id}/confirm`); reload() }, 'Alerta confirmada: ya se ve en la aplicación.')
  const dismiss = (a: AlertRow) => act.run(async () => { await api.post(`/alerts/${a.id}/dismiss`); reload() }, 'Alerta descartada.')

  return (
    <>
      <PageTitle title="Alertas">
        {editable && <Button onClick={() => setCreating((c) => !c)}>{creating ? 'Cerrar formulario' : 'Nueva alerta'}</Button>}
      </PageTitle>
      <Notice>Una alerta solo se muestra al público cuando está <strong>confirmada</strong> y dentro de su vigencia. Las alertas detectadas en las noticias aparecen acá como «sin confirmar».</Notice>
      {creating && (
        <Card className="my-4">
          <CardTitle>Nueva alerta</CardTitle>
          <div className="mt-3">
            <AlertForm onDone={() => { setCreating(false); reload() }} />
          </div>
        </Card>
      )}
      <div role="group" aria-label="Filtrar alertas" className="my-4 flex flex-wrap gap-1.5">
        {FILTERS.map(([v, l]) => (
          <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)} className={`min-h-10 cursor-pointer rounded-full border px-3.5 text-sm font-semibold ${filter === v ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted'}`}>
            {l}
          </button>
        ))}
      </div>
      {act.message && <div className="mb-3"><Notice tone={act.message.tone}>{act.message.text}</Notice></div>}
      {loading && <p role="status">Cargando…</p>}
      {error && <Notice tone="error">{error.message}</Notice>}
      {data && data.length === 0 && <Notice>No hay alertas en esta vista.</Notice>}
      <ul className="space-y-3">
        {data?.map((a) => (
          <li key={a.id}>
            <Card className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={a.confirmation} />
                <Badge tone={a.severity === 'urgente' ? 'danger' : 'info'}>{a.severity === 'urgente' ? 'Urgente' : 'Informativa'}</Badge>
                <Badge>{KINDS[a.kind] ?? a.kind}</Badge>
                <Badge>Prioridad {a.priority}</Badge>
                {a.confirmation === 'confirmed' && isExpired(a) && <Badge tone="warning">Vencida</Badge>}
              </div>
              <CardTitle>{a.title}</CardTitle>
              <p className="whitespace-pre-line text-sm">{a.body}</p>
              <p className="text-xs text-muted-foreground">
                Desde {formatTucuman(a.starts_at)} · hasta {a.expires_at ? formatTucuman(a.expires_at) : 'sin vencimiento'}
                {a.proposed_reason ? ` · detectada: ${a.proposed_reason}` : ''}
              </p>
              {editable && (
                <div className="flex flex-wrap gap-2">
                  {a.confirmation !== 'confirmed' && (
                    <Button size="sm" disabled={act.busy} onClick={() => void confirm(a)}>
                      Confirmar y publicar
                    </Button>
                  )}
                  {a.confirmation !== 'dismissed' && (
                    <Button size="sm" variant="outline" disabled={act.busy} onClick={() => void dismiss(a)}>
                      {a.confirmation === 'confirmed' ? 'Desactivar' : 'Descartar'}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setEditing(editing === a.id ? null : a.id)}>
                    {editing === a.id ? 'Cerrar edición' : 'Editar'}
                  </Button>
                </div>
              )}
              {editing === a.id && (
                <div className="border-t border-border pt-3">
                  <AlertForm initial={a} onDone={() => { setEditing(null); reload() }} />
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </>
  )
}
