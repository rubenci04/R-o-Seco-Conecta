import { Link } from 'react-router'
import { Card, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatTucuman } from '@/lib/tucuman'
import { api, type Dashboard as DashboardData } from '../api'
import { Notice, PageTitle, useAdminData } from '../ui'

const SOURCE_STATUS: Record<string, string> = {
  'not-configured': 'Sin credenciales',
  ok: 'Funcionando',
  'rate-limited': 'Límite de la API',
  'auth-error': 'Credencial inválida',
  'permission-missing': 'Falta un permiso',
  error: 'Con errores',
  disabled: 'Deshabilitada',
}

const ACTION: Record<string, string> = {
  ingested: 'ingresó',
  published: 'publicó',
  created: 'creó',
  edited: 'editó',
  updated: 'actualizó',
  deleted: 'retiró',
  rejected: 'rechazó',
  rectified: 'rectificó',
  approved: 'aprobó',
  confirmed: 'confirmó',
  dismissed: 'descartó',
  proposed: 'propuso',
  retracted: 'retiró',
  'categories-set': 'cambió las categorías de',
  configured: 'configuró',
  'password-changed': 'cambió la contraseña de',
}
const ENTITY: Record<string, string> = { post: 'noticia', alert: 'alerta', obituary: 'obituario', events: 'evento', source: 'fuente', admin: 'usuario' }

function Stat({ label, value, to, tone }: { label: string; value: number; to?: string; tone?: 'warning' }) {
  const body = (
    <Card className={tone === 'warning' && value > 0 ? 'border-orange bg-orange-soft' : ''}>
      <p className="font-display text-3xl font-extrabold tabular-nums">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </Card>
  )
  return to ? (
    <Link to={to} className="block transition hover:-translate-y-0.5">
      {body}
    </Link>
  ) : (
    body
  )
}

export function Dashboard() {
  const { data, error, loading } = useAdminData(() => api.get<DashboardData>('/dashboard'))
  if (loading) return <p role="status">Cargando panel…</p>
  if (error || !data) return <Notice tone="error">{error?.message ?? 'No se pudo cargar el panel.'}</Notice>

  return (
    <>
      <PageTitle title="Panel" />
      <section aria-label="Resumen" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Noticias publicadas" value={data.posts.published} to="/admin/noticias" />
        <Stat label="Borradores" value={data.posts.draft} to="/admin/noticias" />
        <Stat label="Noticias por revisar" value={data.posts.needsReview + data.posts.pending} to="/admin/noticias" tone="warning" />
        <Stat label="Alertas vigentes" value={data.alerts.active} to="/admin/alertas" />
        <Stat label="Alertas sin confirmar" value={data.alerts.proposed} to="/admin/alertas" tone="warning" />
        <Stat label="Eventos próximos" value={data.events.upcoming} to="/admin/agenda" />
        <Stat label="Obituarios pendientes de revisión" value={data.obituaries.pending} to="/admin/obituarios" tone="warning" />
        <Stat label="Noticias retiradas" value={data.posts.withdrawn} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2">
          <CardTitle>Próximos eventos</CardTitle>
          {data.events.next.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay eventos próximos publicados.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.events.next.map((e) => (
                <li key={e.id} className="flex justify-between gap-3">
                  <span>{e.title}</span>
                  <span className="shrink-0 text-muted-foreground">{formatTucuman(e.starts_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-2">
          <CardTitle>Estado de las fuentes</CardTitle>
          <ul className="space-y-2 text-sm">
            {data.sources.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3">
                <span>
                  {s.name}
                  {s.kind !== 'manual' && !s.readiness.ready && <span className="block text-xs text-muted-foreground">Sin credenciales: se carga manualmente desde el panel.</span>}
                </span>
                <Badge tone={s.status === 'ok' ? 'info' : s.status === 'not-configured' ? 'neutral' : 'warning'}>{SOURCE_STATUS[s.status] ?? s.status}</Badge>
              </li>
            ))}
          </ul>
          <Link to="/admin/fuentes" className="text-sm font-semibold text-accent underline">
            Ver detalle
          </Link>
        </Card>

        <Card className="space-y-2 lg:col-span-2">
          <CardTitle>Últimas modificaciones</CardTitle>
          {data.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay actividad registrada.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.history.map((h, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                  <span>
                    <strong>{h.actor_label}</strong> {ACTION[h.action] ?? h.action} {ENTITY[h.entity_type] ?? h.entity_type} #{h.entity_id}
                  </span>
                  <span className="text-muted-foreground">{formatTucuman(h.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Actualizado: {formatTucuman(data.generatedAt)} (hora de Tucumán)</p>
    </>
  )
}
