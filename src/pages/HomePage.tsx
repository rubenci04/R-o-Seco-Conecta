import { ArrowDownUp, ArrowRight, Bell, BusFront, CalendarDays, Headphones, MapPin, Newspaper, Phone, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AlertCard, EventCard, NewsCard } from '@/components/content/ContentCards'
import { telHref } from '@/components/community/PlaceCard'
import { ExternalLink } from '@/components/shared/ExternalLink'
import { Section } from '@/components/shared/PageHeader'
import { Async, EmptyState } from '@/components/shared/States'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { APP } from '@/config/app'
import { LINKS } from '@/config/links'
import { NAV_ITEMS } from '@/config/nav'
import { useData } from '@/data/repository/DataContext'
import type { Holiday, TransportData } from '@/domain/types'
import { DEFAULT_QUERY, queryToParams, swapDirection, type BusQuery } from '@/features/transport/query'
import { findNext } from '@/features/transport/search'
import { formatClock, getLocalParts } from '@/features/transport/time'
import { formatLongDate, greetingFor } from '@/lib/format'
import { useFavorites } from '@/services/favorites'
import { useNow } from '@/services/useNow'

const QUICK = ['/colectivos', '/servicios', '/pueblo', '/radios', '/noticias', '/agenda']

function SeeAll({ to, label = 'Ver todo' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm font-semibold text-accent">
      {label}
      <ArrowRight className="size-4" aria-hidden />
    </Link>
  )
}

function Hero({ now }: { now: Date }) {
  const hour = Math.floor(getLocalParts(now).minutes / 60)
  return (
    <section aria-labelledby="bienvenida" className="animate-rise relative mb-7 overflow-hidden rounded-[2rem] bg-night text-white shadow-md">
      <img
        src="/brand/entrada.webp"
        alt="Cartel «Río Seco» iluminado, con letras celestes y blancas, en la plaza del pueblo"
        width={447}
        height={447}
        fetchPriority="high"
        className="absolute inset-0 size-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-night via-night/70 to-night/10" aria-hidden />
      <div className="relative flex min-h-[22rem] flex-col justify-end p-6 sm:min-h-[26rem] sm:p-8">
        <p className="text-sm font-semibold opacity-95 first-letter:uppercase">{formatLongDate(now)}</p>
        <h1 id="bienvenida" className="font-display mt-1 text-3xl font-extrabold leading-tight sm:text-4xl">
          {greetingFor(hour)}, bienvenidos a Río Seco
        </h1>
        <p className="mt-2 max-w-md text-sm opacity-95">
          Colectivos, servicios, radios, tradiciones y novedades de nuestra comunidad, en un solo lugar.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild className="bg-orange text-orange-foreground">
            <Link to="/colectivos">
              <BusFront className="size-4" aria-hidden />
              Horarios de colectivos
            </Link>
          </Button>
          <Button asChild variant="outline" className="border-white/60 bg-white/10 text-white hover:bg-white/20">
            <Link to="/pueblo">Nuestro pueblo</Link>
          </Button>
        </div>
        <p className="mt-4 inline-block self-start rounded-full bg-black/40 px-3 py-1 text-xs font-semibold">App independiente · no oficial</p>
      </div>
    </section>
  )
}

function QuickBus() {
  const now = useNow()
  const { favorites } = useFavorites()
  const [override, setOverride] = useState<BusQuery | null>(null)
  const query = override ?? favorites[0]?.query ?? DEFAULT_QUERY
  const state = useData((r) => Promise.all([r.getTransport(), r.getHolidays()]).then(([transport, holidays]) => ({ transport, holidays })))

  return (
    <Section title="Próximo colectivo" action={<SeeAll to={`/colectivos?${queryToParams({ ...query, mode: 'all' })}`} label="Ver todos los horarios" />}>
      <Async state={state} isEmpty={() => false} empty={null}>
        {(data) => <QuickBusBody data={data} query={query} now={now} onChange={setOverride} />}
      </Async>
    </Section>
  )
}

function QuickBusBody({ data, query, now, onChange }: { data: { transport: TransportData; holidays: Holiday[] }; query: BusQuery; now: Date; onChange: (q: BusQuery) => void }) {
  const { transport, holidays } = data
  const withData = transport.localities.filter((l) => l.status === 'verificado')
  const locality = transport.localities.find((l) => l.id === query.localityId)
  const nowMinutes = getLocalParts(now).minutes
  const result = useMemo(() => findNext(transport.services, { ...query, mode: 'next' }, now, holidays, 3), [transport.services, query, now, holidays])
  const from = query.direction === 'from-rio-seco'
  const stopName = (id: string) => transport.stops.find((s) => s.id === id)?.name ?? id

  return (
    <Card className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="grid flex-1 grid-cols-[1fr_auto_1fr] items-end gap-2">
          <div>
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">Desde</span>
            {from ? (
              <p className="min-h-11 rounded-xl bg-muted px-3 py-2.5 font-bold">Río Seco</p>
            ) : (
              <LocalitySelect label="Desde" value={query.localityId} onChange={(id) => onChange({ ...query, localityId: id })} options={withData} />
            )}
          </div>
          <Button type="button" variant="outline" size="icon" aria-label="Invertir origen y destino" onClick={() => onChange({ ...query, direction: swapDirection(query.direction) })}>
            <ArrowDownUp className="size-5 rotate-90" aria-hidden />
          </Button>
          <div>
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">Hacia</span>
            {from ? (
              <LocalitySelect label="Hacia" value={query.localityId} onChange={(id) => onChange({ ...query, localityId: id })} options={withData} />
            ) : (
              <p className="min-h-11 rounded-xl bg-muted px-3 py-2.5 font-bold">Río Seco</p>
            )}
          </div>
        </div>
      </div>

      {result.results.length === 0 ? (
        <p className="rounded-xl bg-muted p-3 text-sm">No hay próximos servicios para {locality?.name ?? 'esta ruta'}. Probá en la búsqueda completa.</p>
      ) : (
        <>
          {result.startsTomorrow && <p className="text-xs text-muted-foreground">No quedan más servicios hoy. Estos son los primeros de mañana.</p>}
          <ol className="divide-y divide-border">
            {result.results.map((o) => {
              const wait = o.departureAbs - nowMinutes
              return (
                <li key={`${o.service.id}-${o.serviceDate}`} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="font-display text-2xl font-extrabold tabular-nums leading-none">
                      {o.service.precision === 'approximate' && <span aria-hidden>~</span>}
                      {formatClock(o.departureAbs)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {stopName(o.service.originStopId)} → {stopName(o.service.destinationStopId)}
                      {o.arrivalAbs !== undefined && ` · llega ${formatClock(o.arrivalAbs)}`}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    {wait >= 0 && wait < 120 && <p className="font-bold text-accent">{wait === 0 ? 'Sale ahora' : `en ${wait} min`}</p>}
                    <Badge tone={o.service.precision === 'approximate' ? 'warning' : 'info'}>{o.service.precision === 'approximate' ? 'Aproximado' : o.service.serviceType}</Badge>
                  </div>
                </li>
              )
            })}
          </ol>
        </>
      )}
    </Card>
  )
}

function LocalitySelect({ label, value, onChange, options }: { label: string; value: string; onChange: (id: string) => void; options: { id: string; name: string }[] }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="min-h-11 w-full rounded-xl border border-border bg-background px-2 font-bold text-foreground">
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  )
}

function ImportantServices() {
  const places = useData((r) => r.getPlaces())
  return (
    <Section title="Servicios y teléfonos útiles" action={<SeeAll to="/servicios" />}>
      <Async state={places} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={MapPin} title="Sin fichas todavía" />}>
        {(items) => (
          <ul className="grid gap-3 sm:grid-cols-2">
            {items
              .filter((p) => p.category !== 'comuna')
              .map((p) => (
                <li key={p.id}>
                  <Card className="flex h-full flex-col justify-between gap-3">
                    <div>
                      <p className="font-display font-bold">{p.name}</p>
                      {p.address && <p className="text-sm text-muted-foreground">{p.address}</p>}
                      {p.pending.length > 0 && <p className="mt-1 text-xs text-warning">Datos pendientes de confirmación</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {p.phone ? (
                        <Button asChild size="sm">
                          <a href={telHref(p.phone)} aria-label={`Llamar a ${p.name}`}>
                            <Phone className="size-4" aria-hidden />
                            {p.phone}
                          </a>
                        </Button>
                      ) : (
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/servicios#${p.id}`}>Ver ficha</Link>
                        </Button>
                      )}
                    </div>
                  </Card>
                </li>
              ))}
          </ul>
        )}
      </Async>
    </Section>
  )
}

function Radios() {
  const radios = useData((r) => r.getRadios())
  return (
    <Section title="Radios locales" action={<SeeAll to="/radios" />}>
      <Async state={radios} isEmpty={(d) => d.length === 0} empty={null}>
        {(items) => (
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((r) => (
              <li key={r.id}>
                <Card className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-xl font-extrabold tabular-nums">{r.frequency}</p>
                    <p className="text-sm text-muted-foreground">{r.name}</p>
                  </div>
                  <Button asChild size="sm">
                    <a href={r.siteUrl} target="_blank" rel="noopener noreferrer" aria-label={`Escuchar ${r.name} ${r.frequency} (abre el sitio de la radio)`}>
                      <Headphones className="size-4" aria-hidden />
                      Escuchar
                    </a>
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </Section>
  )
}

export default function HomePage() {
  const now = useNow(60_000)
  const alerts = useData((r) => r.getAlerts())
  const news = useData((r) => r.getNews())
  const events = useData((r) => r.getEvents())
  const heritage = useData((r) => r.getHeritage())

  return (
    <>
      <Hero now={now} />

      <QuickBus />

      <Section title="Accesos rápidos">
        <ul className="grid grid-cols-3 gap-3">
          {QUICK.map((to) => {
            const item = NAV_ITEMS.find((n) => n.to === to)!
            const Icon = item.icon
            return (
              <li key={to}>
                <Link
                  to={to}
                  className="flex h-full flex-col items-center gap-2 rounded-[var(--radius-card)] border border-border bg-card px-2 py-4 text-center text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:bg-muted active:scale-95"
                >
                  <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent">
                    <Icon className="size-6" aria-hidden />
                  </span>
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title="Alertas" action={<SeeAll to="/alertas" />}>
        <Async state={alerts} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Bell} title="Sin alertas vigentes" />}>
          {(items) => <div className="space-y-3">{items.slice(0, 2).map((i) => <AlertCard key={i.id} item={i} />)}</div>}
        </Async>
      </Section>

      <Async state={heritage} isEmpty={(d) => !d.some((s) => s.featured)} empty={null}>
        {(items) => {
          const s = items.find((x) => x.featured)!
          return (
            <Link to={`/pueblo/${s.id}`} className="animate-rise mb-7 flex items-center gap-4 rounded-[var(--radius-card)] border border-orange bg-orange-soft p-4 shadow-sm transition hover:-translate-y-0.5">
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-orange text-orange-foreground">
                <Star className="size-7" aria-hidden />
              </span>
              <span className="min-w-0">
                <Badge tone="warning" className="mb-1">Nuestro pueblo</Badge>
                <span className="block font-display text-lg font-bold">{s.title}</span>
                <span className="block text-sm text-muted-foreground">{s.summary}</span>
              </span>
              <ArrowRight className="ml-auto size-5 shrink-0" aria-hidden />
            </Link>
          )
        }}
      </Async>

      <ImportantServices />
      <Radios />

      <Section title="Noticias de la comuna" action={<SeeAll to="/noticias" />}>
        <Async
          state={news}
          isEmpty={(d) => d.length === 0}
          empty={
            <EmptyState icon={Newspaper} title="Todavía no hay noticias publicadas">
              <p>Solo mostramos novedades con fuente verificable. Seguí a la Comuna en sus redes:</p>
              <p className="mt-2 flex flex-wrap justify-center gap-x-4">
                <ExternalLink href={LINKS.comuna.facebook} className="font-semibold text-accent underline underline-offset-2">Facebook</ExternalLink>
                <ExternalLink href={LINKS.comuna.instagram} className="font-semibold text-accent underline underline-offset-2">Instagram</ExternalLink>
              </p>
            </EmptyState>
          }
        >
          {(items) => <div className="space-y-3">{items.slice(0, 3).map((i) => <NewsCard key={i.id} item={i} />)}</div>}
        </Async>
      </Section>

      <Section title="Agenda cultural" action={<SeeAll to="/agenda" />}>
        <Async state={events} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={CalendarDays} title="No hay eventos cargados">Las fechas se publican cuando estén confirmadas. Mirá también «Nuestro pueblo» para conocer las tradiciones.</EmptyState>}>
          {(items) => <div className="space-y-3">{items.slice(0, 3).map((i) => <EventCard key={i.id} item={i} />)}</div>}
        </Async>
      </Section>

      <Card className="text-xs text-muted-foreground">{APP.disclaimer}</Card>
    </>
  )
}
