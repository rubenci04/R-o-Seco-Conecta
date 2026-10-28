import { useEffect, useState } from 'react'

/** Reloj que se actualiza cada `intervalMs` (por defecto 30 s) para mantener "próximo colectivo" al día. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
