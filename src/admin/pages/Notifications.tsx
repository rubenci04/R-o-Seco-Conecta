import { TOPIC_INFO } from '@shared/pushTopics'
import type { PushTopic } from '@shared/categories'
import { useState, type FormEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { formatTucuman } from '@/lib/tucuman'
import { b64urlToBytes } from '@shared/pushEndpoints'
import { api } from '../api'
import { isAdmin, useAuth } from '../auth'
import { Field, Notice, PageTitle, TextInput, useAction, useAdminData } from '../ui'

interface Overview {
  configured: boolean
  subscriptions: { total: number; active: number; inactive: number; test: number }
  topics: Array<{ topic: string; n: number }>
  notificationStates: Record<string, number>
  deliveryStates: Record<string, number>
  log: LogRow[]
}
interface LogRow {
  id: number
  entity_type: 'post' | 'alert' | 'obituary'
  entity_id: number
  topics_json: string
  urgent: number
  title: string
  url: string
  state: 'pending' | 'sending' | 'done' | 'suppressed'
  suppressed_reason: string | null
  attempted: number
  succeeded: number
  failed: number
  last_error: string | null
  created_at: string
  test_subscription_id: number | null
}
interface Delivery {
  id: number
  subscription_id: number
  service: string
  is_test: number
  state: 'pending' | 'sent' | 'failed' | 'gone'
  attempts: number
  last_status: number | null
  last_error: string | null
  next_attempt_at: string
  sent_at: string | null
}
interface TestDevice {
  id: number
  label: string
  service: string
  active: number
  last_success_at: string | null
  last_error: string | null
}

const LOG_STATE: Record<LogRow['state'], { label: string; tone: 'neutral' | 'info' | 'warning' | 'danger' }> = {
  pending: { label: 'Pendiente', tone: 'warning' },
  sending: { label: 'Enviando', tone: 'warning' },
  done: { label: 'Enviado', tone: 'info' },
  suppressed: { label: 'Suprimido', tone: 'neutral' },
}
const DELIVERY_STATE: Record<Delivery['state'], string> = { pending: 'Pendiente / reintento', sent: 'Entregado al servicio push', failed: 'Falló', gone: 'Suscripción vencida' }
const TYPE: Record<LogRow['entity_type'], string> = { post: 'Noticia', alert: 'Alerta', obituary: 'Obituario' }
const topicLabel = (t: string) => TOPIC_INFO[t as PushTopic]?.label ?? t

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <dd className="font-display text-2xl font-extrabold">{value}</dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
    </div>
  )
}

function Attempts({ id }: { id: number }) {
  const { data, error, loading } = useAdminData(() => api.get<Delivery[]>(`/notifications/${id}/deliveries`), [id])
  return (
    <div className="mt-2 rounded-xl bg-muted p-3 text-sm">
      {loading && <p role="status">Cargando…</p>}
      {error && <Notice tone="error">{error.message}</Notice>}
      {data && data.length === 0 && <p>Sin envíos individuales registrados.</p>}
      <ul className="space-y-1">
        {data?.map((d) => (
          <li key={d.id}>
            Dispositivo #{d.subscription_id}{d.is_test ? ' (prueba)' : ''} · {d.service} · {DELIVERY_STATE[d.state]} · intentos: {d.attempts}
            {d.last_status ? ` · HTTP ${d.last_status}` : ''}
            {d.last_error ? ` · ${d.last_error}` : ''}
            {d.sent_at ? ` · ${formatTucuman(d.sent_at)}` : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Registra ESTE navegador como dispositivo de prueba (solo administradores). Nunca recibe avisos masivos. */
function TestDevices() {
  const { data, reload } = useAdminData(() => api.get<TestDevice[]>('/notifications/test-devices'))
  const act = useAction()
  const [label, setLabel] = useState('')

  const register = async (e: FormEvent) => {
    e.preventDefault()
    await act.run(async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Este navegador no admite notificaciones push.')
      const cfg = await fetch('/api/public/push/config').then((r) => r.json() as Promise<{ enabled: boolean; publicKey: string | null }>)
      if (!cfg.enabled || !cfg.publicKey) throw new Error('Las claves VAPID todavía no están configuradas.')
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Permiso de notificaciones denegado en este navegador.')
      const reg = await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(cfg.publicKey) }))
      const keys = sub.toJSON().keys
      await api.post('/notifications/test-devices', { endpoint: sub.endpoint, keys: { p256dh: keys?.p256dh, auth: keys?.auth }, label })
      setLabel('')
      reload()
    }, 'Este navegador quedó registrado como dispositivo de prueba.')
  }

  return (
    <Card className="mt-4 space-y-3">
      <CardTitle>Dispositivos de prueba</CardTitle>
      <p className="text-sm text-muted-foreground">
        Sirven para comprobar que una notificación llega a un celular propio. Un dispositivo de prueba <strong>no recibe los avisos reales</strong> y la prueba se envía únicamente a él. No existe un envío masivo manual:
        los avisos salen solo al publicar una noticia o confirmar una alerta.
      </p>
      {act.message && <Notice tone={act.message.tone}>{act.message.text}</Notice>}
      <ul className="divide-y divide-border text-sm">
        {data?.length === 0 && <li className="py-2 text-muted-foreground">No hay dispositivos de prueba registrados.</li>}
        {data?.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
            <strong>{d.label}</strong>
            <Badge tone={d.active ? 'info' : 'neutral'}>{d.active ? 'Activo' : 'Dado de baja'}</Badge>
            <span className="text-xs text-muted-foreground">{d.last_success_at ? `Última entrega: ${formatTucuman(d.last_success_at)}` : 'Sin entregas'}{d.last_error ? ` · ${d.last_error}` : ''}</span>
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" disabled={act.busy || !d.active} onClick={() => void act.run(async () => { await api.post(`/notifications/test-devices/${d.id}/send`); reload() }, 'Prueba enviada. Revisá el dispositivo.')}>Enviar prueba</Button>
              <Button size="sm" variant="ghost" disabled={act.busy} onClick={() => void act.run(async () => { await api.del(`/notifications/test-devices/${d.id}`); reload() }, 'Dispositivo eliminado.')}>Quitar</Button>
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => void register(e)} className="flex flex-wrap items-end gap-2">
        <Field label="Nombre de este dispositivo" htmlFor="td-label">
          <TextInput id="td-label" required maxLength={60} placeholder="Ej.: Celular de Rubén" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Button type="submit" disabled={act.busy}>Registrar este navegador</Button>
      </form>
    </Card>
  )
}

export function NotificationsAdmin() {
  const { admin } = useAuth()
  const { data, error, loading, reload } = useAdminData(() => api.get<Overview>('/notifications'))
  const [open, setOpen] = useState<number | null>(null)
  const act = useAction()

  return (
    <>
      <PageTitle title="Notificaciones">
        <Button size="sm" variant="outline" onClick={reload}>Actualizar</Button>
      </PageTitle>
      {loading && <p role="status">Cargando…</p>}
      {error && <Notice tone="error">{error.message}</Notice>}
      {data && (
        <>
          {!data.configured && (
            <Notice tone="error">
              Las notificaciones <strong>no están configuradas</strong>: faltan las claves VAPID (secretos de Cloudflare). Hasta entonces no se envía nada y los avisos nuevos no se encolan.
            </Notice>
          )}
          <Card className="mt-3 space-y-3">
            <CardTitle>Resumen</CardTitle>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Dispositivos activos" value={data.subscriptions.active} />
              <Stat label="Dados de baja / vencidos" value={data.subscriptions.inactive} />
              <Stat label="Dispositivos de prueba" value={data.subscriptions.test} />
              <Stat label="Avisos pendientes o en envío" value={(data.notificationStates.pending ?? 0) + (data.notificationStates.sending ?? 0)} />
              <Stat label="Entregas correctas" value={data.deliveryStates.sent ?? 0} />
              <Stat label="Entregas fallidas" value={(data.deliveryStates.failed ?? 0) + (data.deliveryStates.gone ?? 0)} />
              <Stat label="Entregas pendientes / reintento" value={data.deliveryStates.pending ?? 0} />
              <Stat label="Suprimidos por reglas editoriales" value={data.notificationStates.suppressed ?? 0} />
            </dl>
            {data.topics.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Suscriptos por tema: {data.topics.map((t) => `${topicLabel(t.topic)} (${t.n})`).join(' · ')}
              </p>
            )}
          </Card>

          <Card className="mt-4 space-y-2">
            <CardTitle>Avisos recientes</CardTitle>
            {data.log.length === 0 && <p className="text-sm text-muted-foreground">Todavía no se generó ningún aviso.</p>}
            <ul className="divide-y divide-border">
              {data.log.map((l) => (
                <li key={l.id} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={LOG_STATE[l.state].tone}>{LOG_STATE[l.state].label}</Badge>
                    <Badge>{l.test_subscription_id ? 'Prueba' : TYPE[l.entity_type]}</Badge>
                    {l.urgent ? <Badge tone="danger">Urgente</Badge> : null}
                    <strong>{l.title}</strong>
                    <span className="text-xs text-muted-foreground">{formatTucuman(l.created_at)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Temas: {(JSON.parse(l.topics_json) as string[]).map(topicLabel).join(', ') || '—'}
                    {l.state === 'suppressed' ? ` · Motivo: ${l.suppressed_reason}` : ` · Intentos: ${l.attempted} · Correctos: ${l.succeeded} · Fallidos: ${l.failed}`}
                    {l.last_error ? ` · Último error: ${l.last_error}` : ''}
                  </p>
                  {l.state !== 'suppressed' && (
                    <button type="button" className="mt-1 text-xs font-semibold text-accent underline" aria-expanded={open === l.id} onClick={() => setOpen(open === l.id ? null : l.id)}>
                      {open === l.id ? 'Ocultar historial de intentos' : 'Ver historial de intentos'}
                    </button>
                  )}
                  {open === l.id && <Attempts id={l.id} />}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
      {isAdmin(admin) && (
        <>
          <TestDevices />
          <Card className="mt-4 space-y-2">
            <CardTitle>Procesar pendientes</CardTitle>
            <p className="text-sm text-muted-foreground">Un cron cada minuto continúa los envíos y los reintentos. Este botón solo adelanta esa tarea; no crea avisos nuevos.</p>
            {act.message && <Notice tone={act.message.tone}>{act.message.text}</Notice>}
            <Button size="sm" variant="outline" disabled={act.busy} onClick={() => void act.run(async () => { await api.post('/notifications/process'); reload() }, 'Se procesó una tanda de envíos.')}>Procesar ahora</Button>
          </Card>
        </>
      )}
    </>
  )
}
