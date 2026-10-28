import { useState, type FormEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import placesJson from '@/data/json/places.json'
import { formatTucuman, isoToLocalInput, localInputToIso } from '@/lib/tucuman'
import { api, type EventRow } from '../api'
import { canEdit, useAuth } from '../auth'
import { Field, Notice, PageTitle, Select, TextArea, TextInput, useAction, useAdminData } from '../ui'

/** Catálogo de lugares (JSON validado). El evento guarda el id textual y el nombre mostrado. */
const PLACES = (placesJson as { id: string; name: string }[]).map((p) => ({ id: p.id, name: p.name }))

function EventForm({ initial, onDone }: { initial?: EventRow; onDone: () => void }) {
  const act = useAction()
  const [f, setF] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    category: initial?.category ?? 'evento',
    startsAt: isoToLocalInput(initial?.starts_at),
    endsAt: isoToLocalInput(initial?.ends_at),
    placeRef: initial?.place_ref ?? '',
    placeText: initial?.place_text ?? '',
    sourceLabel: initial?.source_label ?? 'Comuna de Río Seco',
    sourceUrl: initial?.source_url ?? '',
    published: initial ? !!initial.published : true,
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const body = {
      title: f.title,
      description: f.description || null,
      category: f.category,
      starts_at: localInputToIso(f.startsAt),
      ends_at: localInputToIso(f.endsAt) || null,
      place_ref: f.placeRef || null,
      place_text: f.placeText || null,
      source_label: f.sourceLabel,
      source_url: f.sourceUrl,
      published: f.published,
    }
    const ok = await act.run(async () => {
      if (initial) await api.patch(`/events/${initial.id}`, body)
      else await api.post('/events', body)
      return true
    }, initial ? 'Evento actualizado.' : 'Evento guardado.')
    if (ok) onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {act.message && <Notice tone={act.message.tone}>{act.message.text}</Notice>}
      <Field label="Título" htmlFor="e-title">
        <TextInput id="e-title" required maxLength={200} value={f.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="Descripción" htmlFor="e-desc">
        <TextArea id="e-desc" rows={3} maxLength={2000} value={f.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Tipo" htmlFor="e-cat">
          <Select id="e-cat" value={f.category} onChange={(e) => set('category', e.target.value as EventRow['category'])}>
            <option value="evento">Evento</option>
            <option value="festividad">Festividad</option>
            <option value="actividad">Actividad</option>
          </Select>
        </Field>
        <Field label="Inicio (hora de Tucumán)" htmlFor="e-start">
          <TextInput id="e-start" type="datetime-local" required value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
        </Field>
        <Field label="Fin (opcional)" htmlFor="e-end">
          <TextInput id="e-end" type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Lugar del catálogo" htmlFor="e-place" hint="Si no está en la lista, escribilo abajo.">
          <Select
            id="e-place"
            value={f.placeRef}
            onChange={(e) => {
              const p = PLACES.find((x) => x.id === e.target.value)
              setF((s) => ({ ...s, placeRef: e.target.value, placeText: p ? p.name : s.placeText }))
            }}
          >
            <option value="">— Otro lugar —</option>
            {PLACES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Lugar (como se muestra)" htmlFor="e-placeText">
          <TextInput id="e-placeText" maxLength={200} value={f.placeText} onChange={(e) => set('placeText', e.target.value)} />
        </Field>
        <Field label="Fuente (cómo se cita)" htmlFor="e-srcl">
          <TextInput id="e-srcl" required maxLength={120} value={f.sourceLabel} onChange={(e) => set('sourceLabel', e.target.value)} />
        </Field>
        <Field label="Enlace a la fuente" htmlFor="e-srcu">
          <TextInput id="e-srcu" type="url" required placeholder="https://…" value={f.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} />
        </Field>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="size-4" checked={f.published} onChange={(e) => set('published', e.target.checked)} />
        Publicado (visible en la Agenda)
      </label>
      <Button type="submit" disabled={act.busy}>
        {initial ? 'Guardar cambios' : 'Guardar evento'}
      </Button>
    </form>
  )
}

export function EventsAdmin() {
  const { admin } = useAuth()
  const editable = canEdit(admin)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const { data, error, loading, reload } = useAdminData(() => api.get<EventRow[]>('/events'))
  const act = useAction()

  const toggle = (e: EventRow) => act.run(async () => { await api.patch(`/events/${e.id}`, { published: !e.published }); reload() }, e.published ? 'Evento despublicado.' : 'Evento publicado.')
  const remove = (e: EventRow) =>
    act.run(async () => {
      if (!window.confirm(`¿Eliminar «${e.title}»? Esta acción no se puede deshacer (queda el historial).`)) throw new Error('Cancelado.')
      await api.del(`/events/${e.id}`)
      reload()
    }, 'Evento eliminado.')

  return (
    <>
      <PageTitle title="Agenda">{editable && <Button onClick={() => setCreating((c) => !c)}>{creating ? 'Cerrar formulario' : 'Nuevo evento'}</Button>}</PageTitle>
      <Notice>Las fechas se cargan en hora de Tucumán (UTC-3). Podés preparar las festividades de diciembre y los eventos del pesebre con anticipación y publicarlos cuando estén confirmados.</Notice>
      {creating && (
        <Card className="my-4">
          <CardTitle>Nuevo evento</CardTitle>
          <div className="mt-3">
            <EventForm onDone={() => { setCreating(false); reload() }} />
          </div>
        </Card>
      )}
      {act.message && <div className="my-3"><Notice tone={act.message.tone}>{act.message.text}</Notice></div>}
      {loading && <p role="status" className="mt-4">Cargando…</p>}
      {error && <Notice tone="error">{error.message}</Notice>}
      {data && data.length === 0 && <div className="mt-4"><Notice>Todavía no hay eventos cargados.</Notice></div>}
      <ul className="mt-4 space-y-3">
        {data?.map((e) => (
          <li key={e.id}>
            <Card className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={e.published ? 'info' : 'neutral'}>{e.published ? 'Publicado' : 'Sin publicar'}</Badge>
                <Badge>{e.category}</Badge>
                <span className="text-xs text-muted-foreground">{formatTucuman(e.starts_at)}</span>
              </div>
              <CardTitle>{e.title}</CardTitle>
              {e.place_text && <p className="text-sm text-muted-foreground">{e.place_text}</p>}
              {editable && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(editing === e.id ? null : e.id)}>
                    {editing === e.id ? 'Cerrar edición' : 'Editar'}
                  </Button>
                  <Button size="sm" variant="outline" disabled={act.busy} onClick={() => void toggle(e)}>
                    {e.published ? 'Despublicar' : 'Publicar'}
                  </Button>
                  <Button size="sm" variant="outline" disabled={act.busy} onClick={() => void remove(e)}>
                    Eliminar
                  </Button>
                </div>
              )}
              {editing === e.id && (
                <div className="border-t border-border pt-3">
                  <EventForm initial={e} onDone={() => { setEditing(null); reload() }} />
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </>
  )
}
