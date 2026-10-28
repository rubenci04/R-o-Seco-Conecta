import type { DayType, Holiday } from '@/domain/types'

export function isHoliday(isoDate: string, holidays: Holiday[]): boolean {
  const mmdd = isoDate.slice(5)
  return holidays.some((h) => h.date === isoDate || h.date === mmdd)
}

/** Clasifica una fecha local (AAAA-MM-DD). Los feriados prevalecen sobre el día de la semana. */
export function classifyDay(isoDate: string, holidays: Holiday[]): DayType {
  if (isHoliday(isoDate, holidays)) return 'holiday'
  const [y, m, d] = isoDate.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  if (dow === 0) return 'sunday'
  if (dow === 6) return 'saturday'
  return 'weekday'
}

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  weekday: 'Días hábiles',
  saturday: 'Sábados',
  sunday: 'Domingos',
  holiday: 'Feriados',
}
