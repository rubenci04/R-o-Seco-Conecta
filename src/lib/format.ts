import { APP } from '@/config/app'

const base = { locale: APP.locale, timeZone: APP.timeZone }

export const formatLongDate = (d: Date) =>
  new Intl.DateTimeFormat(base.locale, { timeZone: base.timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(d)

export const formatShortDate = (iso: string) =>
  new Intl.DateTimeFormat(base.locale, { timeZone: base.timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))

export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat(base.locale, {
    timeZone: base.timeZone,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

/** AAAA-MM-DD (fecha civil, sin zona) → "28 oct 2026" */
export const formatCivilDate = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat(base.locale, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  )
}

export const greetingFor = (hour: number) => (hour < 6 ? 'Buenas noches' : hour < 13 ? 'Buen día' : hour < 20 ? 'Buenas tardes' : 'Buenas noches')
