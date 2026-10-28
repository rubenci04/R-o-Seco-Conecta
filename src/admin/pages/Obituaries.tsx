import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { formatTucuman } from '@/lib/tucuman'
import { api, type ObituaryRow } from '../api'
import { canEdit, useAuth } from '../auth'
import { Field, Notice, PageTitle, StatusBadge, TextArea, TextInput, useAction, useAdminData } from '../ui'

const FILTERS = [
  ['pending', 'En revisión'],
  ['approved', 'Aprobados'],
  ['rejected', 'Rechazados'],
  ['retracted', 'Retirados'],
] as const

function ObituaryCardAdmin({ o, onChange, act }: { o: ObituaryRow; onChange: () => void; act: ReturnType<typeof useAction> }) {
  const { admin } = useAuth()
  const editable = canEdit(admin)
  const [f, setF] = useState({ name: o.name, deathDate: o.death_date ?? '', message: o.message ?? '', serviceInfo: o.service_info ?? '' })
  const [note, setNote] = useState('')
  const set = <K extends keyof typeof f>(k: K, v: string) => setF((s) => ({ ...s, [k]: v }))
  const done = (text: string, fn: () => Promise<unknown>) => act.run(async () => { await fn(); onChange() }, text)

  const save = () => done('Datos guardados.', () => api.patch(`/obituaries/${o.id}`, { name: f.name, deathDate: f.deathDate, message: f.message, serviceInfo: f.serviceInfo }))
  const approve = () =>
    done('Obituario aprobado: ya se ve en la aplicación.', async () => {
      await api.patch(`/obituaries/${o.id}`, { name: f.name, deathDate: f.deathDate, message: f.message, serviceInfo: f.serviceInfo })
      await api.post(`/obituaries/${o.id}/approve`)
    })
  const reject = () => done('Marcado como no válido.', () => api.post(`/obituaries/${o.id}/reject`))
  const retract = () => {
    if (!window.confirm('¿Retirar este obituario? Dejará de verse en la aplicación.')) return Promise.resolve()
    return done('Obituario retirado.', () => api.post(`/obituaries/${o.id}/retract`))
  }
  const rectify = () => done('Rectificación publicada.', () => api.post(`/obituaries/${o.id}/rectify`, { note }))
  const pending = o.state === 'pending'

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={o.state} />
        <span className="text-xs text-muted-foreground">Detectado el {formatTucuman(o.created_at)}</span>
        {o.post_id && (
          <Link to={`/admin/noticias/${o.post_id}`} className="text-xs font-semibold text-accent underline">
            Ver publicación de origen
          </Link>
        )}
      </div>
      {pending && <Notice>Detectado automáticamente por palabras clave. <strong>No se publica solo</strong>: verificá el nombre, la fecha y la fuente antes de aprobar.</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre (corregir si hace falta)" htmlFor={`n-${o.id}`}>
          <TextInput id={`n-${o.id}`} value={f.name} disabled={!editable || o.state === 'retracted'} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Fecha de fallecimiento" htmlFor={`d-${o.id}`}>
          <TextInput id={`d-${o.id}`} type="date" value={f.deathDate} disabled={!editable || o.state === 'retracted'} onChange={(e) => set('deathDate', e.target.value)} />
        </Field>
      </div>
      <Field label="Texto del comunicado" htmlFor={`m-${o.id}`}>
        <TextArea id={`m-${o.id}`} rows={4} value={f.message} disabled={!editable || o.state === 'retracted'} onChange={(e) => set('message', e.target.value)} />
      </Field>
      <Field label="Velatorio y sepelio (opcional)" htmlFor={`s-${o.id}`}>
        <TextInput id={`s-${o.id}`} value={f.serviceInfo} disabled={!editable || o.state === 'retracted'} onChange={(e) => set('serviceInfo', e.target.value)} />
      </Field>
      {o.source_url && (
        <p className="text-sm">
          Fuente:{' '}
          <a href={o.source_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline">
            {o.source_url}
          </a>
        </p>
      )}
      {editable && (
        <div className="flex flex-wrap gap-2">
          {pending && (
            <>
              <Button size="sm" disabled={act.busy || !f.name.trim() || !f.deathDate} onClick={() => void approve()}>
                Aprobar y publicar
              </Button>
              <Button size="sm" variant="outline" disabled={act.busy} onClick={() => void save()}>
                Guardar sin publicar
              </Button>
              <Button size="sm" variant="outline" disabled={act.busy} onClick={() => void reject()}>
                No es un obituario
              </Button>
            </>
          )}
          {o.state === 'approved' && (
            <Button size="sm" variant="outline" disabled={act.busy} onClick={() => void retract()}>
              Retirar
            </Button>
          )}
        </div>
      )}
      {pending && !f.deathDate && <p className="text-xs text-muted-foreground">Para aprobar hace falta confirmar el nombre y la fecha de fallecimiento.</p>}
      {editable && o.state === 'approved' && (
        <div className="space-y-2 border-t border-border pt-3">
          {o.rectification && <p className="rounded-xl bg-warning-soft p-2.5 text-sm text-warning">Rectificación actual: {o.rectification}</p>}
          <Field label="Rectificación pública" htmlFor={`r-${o.id}`}>
            <TextArea id={`r-${o.id}`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button size="sm" variant="outline" disabled={act.busy || !note.trim()} onClick={() => void rectify()}>
            Publicar rectificación
          </Button>
        </div>
      )}
    </Card>
  )
}

export function ObituariesAdmin() {
  // La confirmación vive en la lista: la tarjeta puede desaparecer de la vista tras aprobarla.
  const act = useAction()
  const [state, setState] = useState<(typeof FILTERS)[number][0]>('pending')
  const { data, error, loading, reload } = useAdminData(() => api.get<ObituaryRow[]>(`/obituaries?estado=${state}`), [state])
  return (
    <>
      <PageTitle title="Obituarios" />
      <Notice>Ningún obituario se publica de forma automática: una persona autorizada debe validarlo. Una vez aprobado aparece en «Obituarios» y en el feed de noticias, con enlace a la fuente.</Notice>
      <div role="group" aria-label="Estado" className="my-4 flex flex-wrap gap-1.5">
        {FILTERS.map(([v, l]) => (
          <button key={v} type="button" aria-pressed={state === v} onClick={() => setState(v)} className={`min-h-10 cursor-pointer rounded-full border px-3.5 text-sm font-semibold ${state === v ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted'}`}>
            {l}
          </button>
        ))}
      </div>
      {act.message && <div className="mb-3"><Notice tone={act.message.tone}>{act.message.text}</Notice></div>}
      {loading && <p role="status">Cargando…</p>}
      {error && <Notice tone="error">{error.message}</Notice>}
      {data && data.length === 0 && <Notice>No hay obituarios en esta vista.</Notice>}
      <ul className="space-y-4">
        {data?.map((o) => (
          <li key={o.id}>
            <CardTitleHidden />
            <ObituaryCardAdmin o={o} onChange={reload} act={act} />
          </li>
        ))}
      </ul>
    </>
  )
}

const CardTitleHidden = () => <CardTitle className="sr-only">Obituario</CardTitle>
