import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { formatTucuman, localInputToIso, nowLocalInput } from '@/lib/tucuman'
import { api, type SourceInfo } from '../api'
import { canEdit, isAdmin, useAuth } from '../auth'
import { Field, Notice, PageTitle, TextArea, TextInput, useAction, useAdminData } from '../ui'

const STATUS: Record<string, string> = {
  'not-configured': 'Sin credenciales',
  ok: 'Funcionando',
  'rate-limited': 'Límite de la API',
  'auth-error': 'Credencial inválida o vencida',
  'permission-missing': 'Falta un permiso de Meta',
  error: 'Con errores',
  disabled: 'Deshabilitada',
}
interface SyncRun {
  id: number
  source_id: string
  started_at: string
  outcome: string
  fetched: number
  inserted: number
  duplicates: number
  error: string | null
  retry_after: string | null
}

function ImportByLink({ onDone }: { onDone: () => void }) {
  const act = useAction()
  const [f, setF] = useState({ url: '', text: '', publishedAt: nowLocalInput() })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const r = await act.run(
      () => api.post<{ postId: number; status: string }>('/posts/import-link', { url: f.url, text: f.text, publishedAt: localInputToIso(f.publishedAt) || undefined }),
      'Publicación importada. Revisala en «Noticias».',
    )
    if (r) {
      setF({ url: '', text: '', publishedAt: nowLocalInput() })
      onDone()
    }
  }
  return (
    <Card className="space-y-3">
      <CardTitle>Importar una publicación por enlace</CardTitle>
      <p className="text-sm text-muted-foreground">
        Pegá el enlace de la publicación de Facebook o Instagram de la Comuna y el texto tal como figura en ella. <strong>No se descarga nada de la red social</strong>: el sistema solo registra el enlace como
        procedencia y evita duplicados. Pasa por la misma revisión y clasificación que cualquier noticia.
      </p>
      <form onSubmit={submit} className="space-y-3">
        {act.message && <Notice tone={act.message.tone}>{act.message.text}</Notice>}
        <Field label="Enlace de la publicación" htmlFor="imp-url">
          <TextInput id="imp-url" type="url" required placeholder="https://www.facebook.com/…  o  https://www.instagram.com/p/…" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
        </Field>
        <Field label="Texto de la publicación" htmlFor="imp-text">
          <TextArea id="imp-text" required rows={6} maxLength={20000} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
        </Field>
        <Field label="Fecha original de la publicación (Tucumán)" htmlFor="imp-date">
          <TextInput id="imp-date" type="datetime-local" required value={f.publishedAt} onChange={(e) => setF({ ...f, publishedAt: e.target.value })} />
        </Field>
        <Button type="submit" disabled={act.busy}>
          Importar
        </Button>
      </form>
    </Card>
  )
}

export function SourcesAdmin() {
  const { admin } = useAuth()
  const { data, error, loading, reload } = useAdminData(() => api.get<(SourceInfo & { automatic: boolean })[]>('/sources'))
  const runs = useAdminData(() => api.get<SyncRun[]>('/sync-runs?errores=1'))
  const act = useAction()

  const sync = (id: string) => act.run(async () => { const r = await api.post<{ outcome: string; detail?: string }>(`/sources/${id}/sync-now`); reload(); runs.reload(); if (r.outcome !== 'success') throw new Error(r.detail ?? `Resultado: ${r.outcome}`) }, 'Sincronización completada.')

  return (
    <>
      <PageTitle title="Fuentes de contenido" />
      <Notice>
        Facebook e Instagram todavía <strong>no están conectados</strong>: faltan credenciales y permisos de Meta. Mientras tanto el contenido se carga desde el panel (manualmente o por enlace). La sincronización
        automática no está activa y no se afirma que funcione hasta comprobarla con permisos válidos.
      </Notice>
      {act.message && <div className="mt-3"><Notice tone={act.message.tone}>{act.message.text}</Notice></div>}
      {loading && <p role="status" className="mt-4">Cargando…</p>}
      {error && <div className="mt-4"><Notice tone="error">{error.message}</Notice></div>}
      <ul className="my-4 space-y-3">
        {data?.map((s) => (
          <li key={s.id}>
            <Card className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{s.name}</CardTitle>
                <Badge tone={s.status === 'ok' ? 'info' : s.status === 'not-configured' ? 'neutral' : 'warning'}>{STATUS[s.status] ?? s.status}</Badge>
                <Badge>{s.mode === 'api' ? 'API' : s.mode === 'assisted' ? 'Asistida' : 'Manual'}</Badge>
                <Badge tone={s.automatic ? 'info' : 'neutral'}>{s.automatic ? 'Sincronización automática activa' : 'Sin sincronización automática'}</Badge>
              </div>
              {s.kind !== 'manual' && !s.readiness.ready && (
                <p className="text-sm text-muted-foreground">
                  Faltan para activarla: {s.readiness.missing.join(', ')}. Se configuran como secretos del Worker (nunca en el panel ni en el código).
                </p>
              )}
              <dl className="grid gap-x-4 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-muted-foreground">Última sincronización exitosa</dt><dd>{s.lastSuccessAt ? formatTucuman(s.lastSuccessAt) : 'Nunca'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Última comprobación</dt><dd>{s.lastCheckedAt ? formatTucuman(s.lastCheckedAt) : '—'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Próxima comprobación</dt><dd>{s.automatic ? (s.nextAttemptAt ? formatTucuman(s.nextAttemptAt) : 'En el próximo ciclo') : 'No programada'}</dd></div>
              </dl>
              {s.lastError && <p className="text-sm text-danger">Último error: {s.lastError}</p>}
              {isAdmin(admin) && s.kind !== 'manual' && (
                <Button size="sm" variant="outline" disabled={act.busy || !s.readiness.ready} onClick={() => void sync(s.id)}>
                  Sincronizar ahora
                </Button>
              )}
            </Card>
          </li>
        ))}
      </ul>

      {canEdit(admin) && <ImportByLink onDone={() => { reload(); runs.reload() }} />}

      <Card className="mt-4 space-y-2">
        <CardTitle>Errores de sincronización recientes</CardTitle>
        {runs.data && runs.data.length === 0 && <p className="text-sm text-muted-foreground">Sin errores registrados.</p>}
        <ul className="divide-y divide-border text-sm">
          {runs.data?.map((r) => (
            <li key={r.id} className="py-1.5">
              <strong>{r.source_id}</strong> · {STATUS[r.outcome] ?? r.outcome} · {formatTucuman(r.started_at)}
              {r.error ? ` — ${r.error}` : ''}
            </li>
          ))}
        </ul>
      </Card>
      <p className="mt-3 text-sm">
        <Link to="/admin/noticias?estado=pending" className="font-semibold text-accent underline">
          Ver noticias en revisión
        </Link>
      </p>
    </>
  )
}
