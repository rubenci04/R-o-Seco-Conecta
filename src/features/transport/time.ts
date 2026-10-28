import { APP } from '@/config/app'

export const MINUTES_PER_DAY = 1440

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export interface LocalParts {
  /** Fecha local AAAA-MM-DD */
  date: string
  /** Minutos desde las 00:00 locales */
  minutes: number
}

/** Fecha y hora local de Tucumán para un instante dado, sin depender de la zona del dispositivo. */
export function getLocalParts(instant: Date): LocalParts {
  const p = Object.fromEntries(formatter.formatToParts(instant).map((x) => [x.type, x.value]))
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  }
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Formatea minutos como HH:mm de reloj (módulo 24 h). */
export function formatClock(minutes: number): string {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}
