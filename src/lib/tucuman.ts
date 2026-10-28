/**
 * Fechas del panel en hora de Tucumán (America/Argentina/Tucuman, UTC-3 todo el año, sin horario de verano).
 * Los formularios usan <input type="datetime-local"> (hora local de Tucumán); la API recibe y guarda ISO en UTC.
 */
const TZ = 'America/Argentina/Tucuman'
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** ISO (UTC) → 'AAAA-MM-DDTHH:mm' en hora de Tucumán, para un datetime-local. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = Object.fromEntries(parts.formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/** 'AAAA-MM-DDTHH:mm' (hora de Tucumán) → ISO UTC. Devuelve '' si el valor es inválido. */
export function localInputToIso(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return ''
  const d = new Date(`${local}:00-03:00`)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

export const nowLocalInput = (now = new Date()) => isoToLocalInput(now.toISOString())

export function formatTucuman(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
}
