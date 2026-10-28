import type { PushTopic } from '@shared/categories'
import { DEFAULT_TOPICS, PRESETS, TOPIC_INFO, TOPIC_ORDER } from '@shared/pushTopics'
import { Bell, BellOff, ChevronRight, Settings, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { disablePush, enablePush, getPushStatus, PushError, updatePushTopics, type PushStatus } from '@/services/push'

export function SettingsPage() {
  return (
    <>
      <PageHeader icon={Settings} title="Configuración" subtitle="Preferencias de este dispositivo." />
      <ul className="space-y-3">
        <li>
          <Link to="/configuracion/notificaciones" className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-sm transition hover:bg-muted active:scale-[0.99]">
            <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent"><Bell className="size-5" aria-hidden /></span>
            <span className="flex-1">
              <span className="block font-display font-bold">Mis notificaciones</span>
              <span className="block text-sm text-muted-foreground">Elegí qué avisos querés recibir en este celular o computadora.</span>
            </span>
            <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      </ul>
      <p className="mt-5 text-xs text-muted-foreground">No hace falta crear una cuenta. Tus preferencias se guardan solo para este dispositivo.</p>
    </>
  )
}

const STATUS_COPY: Record<'unsupported' | 'ios-install' | 'unavailable' | 'denied' | 'expired', { title: string; body: string }> = {
  unsupported: { title: 'Este navegador no admite notificaciones', body: 'Probá con una versión actualizada de Chrome, Edge o Firefox. También podés seguir las novedades desde la sección Noticias.' },
  'ios-install': {
    title: 'En iPhone y iPad, primero instalá la aplicación',
    body: 'Las notificaciones funcionan solo con la app instalada. Tocá el botón Compartir de Safari, elegí «Agregar a pantalla de inicio», abrí Río Seco Conecta desde el ícono nuevo y volvé a esta pantalla.',
  },
  unavailable: { title: 'Las notificaciones todavía no están disponibles', body: 'Estamos terminando de prepararlas. Mientras tanto podés ver las novedades en Noticias y Alertas.' },
  denied: {
    title: 'Las notificaciones están bloqueadas',
    body: 'Bloqueaste las notificaciones para este sitio. Para activarlas, tocá el candado junto a la dirección del sitio (o los ajustes del navegador), permití las notificaciones y volvé a esta pantalla.',
  },
  expired: { title: 'Tu suscripción venció', body: 'Este dispositivo ya no está registrado para recibir avisos. Elegí tus temas y activá las notificaciones de nuevo.' },
}

function TopicList({ selected, onToggle, disabled }: { selected: PushTopic[]; onToggle: (t: PushTopic) => void; disabled: boolean }) {
  const groups: Array<{ id: 'importantes' | 'novedades' | 'sensibles'; title: string; note?: string }> = [
    { id: 'importantes', title: 'Avisos importantes' },
    { id: 'novedades', title: 'Novedades de la comunidad' },
    { id: 'sensibles', title: 'Comunicados sensibles', note: 'Solo los recibís si los elegís vos. Se envían únicamente luego de que una persona de la redacción los aprueba.' },
  ]
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <fieldset key={g.id} className="space-y-1">
          <legend className="font-display font-bold">{g.title}</legend>
          {g.note && <p className="text-xs text-muted-foreground">{g.note}</p>}
          <ul>
            {TOPIC_ORDER.filter((t) => TOPIC_INFO[t].group === g.id).map((t) => (
              <li key={t}>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-1 py-2 hover:bg-muted">
                  <input type="checkbox" className="mt-1 size-5 accent-[var(--color-primary)]" checked={selected.includes(t)} disabled={disabled} onChange={() => onToggle(t)} />
                  <span>
                    <span className="block text-sm font-semibold">{TOPIC_INFO[t].label}</span>
                    <span className="block text-xs text-muted-foreground">{TOPIC_INFO[t].description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
    </div>
  )
}

const sameSet = (a: PushTopic[], b: PushTopic[]) => a.length === b.length && a.every((x) => b.includes(x))

export function NotificationSettingsPage() {
  const [status, setStatus] = useState<PushStatus>({ kind: 'loading' })
  const [selected, setSelected] = useState<PushTopic[]>(DEFAULT_TOPICS)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    const s = await getPushStatus()
    if (!alive.current) return
    setStatus(s)
    if (s.kind === 'on') setSelected(s.topics)
  }, [])

  useEffect(() => {
    alive.current = true
    const t = setTimeout(() => void refresh(), 0)
    return () => {
      alive.current = false
      clearTimeout(t)
    }
  }, [refresh])

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true)
    setNotice(null)
    try {
      const ok = await work()
      if (ok) setNotice({ tone: 'ok', text: ok })
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof PushError || e instanceof Error ? e.message : 'Ocurrió un error inesperado.' })
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const toggle = (t: PushTopic) => setSelected((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))
  const blocked = ['unsupported', 'ios-install', 'unavailable', 'denied'].includes(status.kind)
  const on = status.kind === 'on'

  return (
    <>
      <PageHeader icon={Bell} title="Mis notificaciones" subtitle="Recibí avisos en este dispositivo, sin crear una cuenta." />

      <div aria-live="polite" className="mb-4 space-y-3">
        {status.kind === 'loading' && <p className="text-sm text-muted-foreground">Revisando el estado de las notificaciones…</p>}
        {(status.kind === 'unsupported' || status.kind === 'ios-install' || status.kind === 'unavailable' || status.kind === 'denied' || status.kind === 'expired') && (
          <Card className={status.kind === 'expired' ? 'space-y-1 border-warning' : 'space-y-1'}>
            <CardTitle className="flex items-center gap-2">
              {status.kind === 'ios-install' ? <Smartphone className="size-5 text-accent" aria-hidden /> : <BellOff className="size-5 text-muted-foreground" aria-hidden />}
              {STATUS_COPY[status.kind].title}
            </CardTitle>
            <p className="text-sm">{STATUS_COPY[status.kind].body}</p>
          </Card>
        )}
        {status.kind === 'error' && (
          <Card className="space-y-2 border-danger">
            <CardTitle>No pudimos revisar las notificaciones</CardTitle>
            <p className="text-sm">{status.message}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>Reintentar</Button>
          </Card>
        )}
        {status.kind === 'off' && status.permissionGranted && <p className="text-sm text-muted-foreground">Ya diste permiso a este sitio. Elegí tus temas y activá las notificaciones.</p>}
        {status.kind === 'on' && (
          <Card className="space-y-1 border-primary">
            <CardTitle className="flex items-center gap-2"><Bell className="size-5 text-primary" aria-hidden />Notificaciones activadas</CardTitle>
            <p className="text-sm">Este dispositivo recibe los avisos de los temas marcados abajo.{!status.verified && ' No pudimos verificarlo ahora (sin conexión).'}</p>
          </Card>
        )}
        {notice && (
          <p role={notice.tone === 'error' ? 'alert' : 'status'} className={notice.tone === 'error' ? 'rounded-xl bg-danger-soft p-3 text-sm font-semibold text-danger' : 'rounded-xl bg-accent-soft p-3 text-sm font-semibold'}>
            {notice.text}
          </p>
        )}
      </div>

      {!blocked && status.kind !== 'loading' && (
        <Card className="space-y-4">
          {!on && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Configuraciones rápidas">
              {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((id) => (
                <Button key={id} type="button" size="sm" variant={sameSet(selected, PRESETS[id].topics) ? 'default' : 'outline'} aria-pressed={sameSet(selected, PRESETS[id].topics)} onClick={() => setSelected(PRESETS[id].topics)}>
                  {PRESETS[id].label}
                </Button>
              ))}
            </div>
          )}
          <TopicList selected={selected} onToggle={toggle} disabled={busy} />
          {selected.length === 0 && <p className="text-sm text-muted-foreground">Elegí al menos un tema.</p>}
          <div className="flex flex-wrap gap-2">
            {!on ? (
              <Button type="button" disabled={busy || selected.length === 0} onClick={() => run(async () => { await enablePush(selected); return 'Listo: las notificaciones quedaron activadas en este dispositivo.' })}>
                <Bell className="size-4" aria-hidden />Activar notificaciones
              </Button>
            ) : (
              <>
                <Button type="button" disabled={busy || selected.length === 0 || sameSet(selected, status.topics)} onClick={() => run(async () => { await updatePushTopics(selected); return 'Guardamos tus preferencias.' })}>
                  Guardar preferencias
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => run(async () => { const r = await disablePush(); return r.serverNotified ? 'Desactivamos las notificaciones en este dispositivo.' : 'Desactivamos las notificaciones en este dispositivo. No pudimos avisar al servidor; dejarás de recibir avisos igualmente.' })}>
                  <BellOff className="size-4" aria-hidden />Desactivar notificaciones
                </Button>
              </>
            )}
          </div>
          {!on && <p className="text-xs text-muted-foreground">Al tocar «Activar notificaciones» tu navegador te va a pedir permiso. Podés cambiar los temas o desactivarlas cuando quieras.</p>}
        </Card>
      )}

      <Card className="mt-4 space-y-2 text-sm">
        <CardTitle>Qué guardamos</CardTitle>
        <p>Solo una dirección técnica de tu navegador y los temas que elegiste. No guardamos tu nombre, tu ubicación ni ningún dato personal. Si desactivás las notificaciones, se borra todo.</p>
      </Card>
    </>
  )
}
