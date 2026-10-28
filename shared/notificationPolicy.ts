import type { CategoryId, PushTopic } from './categories'
import { isPushTopic } from './categories'

/** Una publicación solo genera aviso si es reciente: evita inundar de avisos al importar un historial. */
export const MAX_NOTIFY_AGE_HOURS = 6
/** Si un mismo ciclo importa más publicaciones que esto, se tratan como carga histórica y no se notifican. */
export const MAX_NOTIFY_PER_SYNC = 3

export interface NotifiablePost {
  status: 'pending' | 'published' | 'rejected' | 'deleted'
  publishedAt: string
  categories: CategoryId[]
  /** Posible obituario aún sin aprobar. */
  obituaryPending: boolean
}

export type Decision = { send: true; topics: PushTopic[] } | { send: false; reason: string }

export function decidePostNotification(post: NotifiablePost, now: Date, importedThisRun = 1): Decision {
  if (post.status !== 'published') return { send: false, reason: 'no publicada' }
  if (post.obituaryPending) return { send: false, reason: 'obituario pendiente de revisión' }
  if (importedThisRun > MAX_NOTIFY_PER_SYNC) return { send: false, reason: 'carga masiva: no se notifica el historial' }
  const ageHours = (now.getTime() - new Date(post.publishedAt).getTime()) / 3_600_000
  if (ageHours > MAX_NOTIFY_AGE_HOURS) return { send: false, reason: 'publicación antigua' }
  // Las noticias comunes NUNCA usan el tema "urgente": solo sus categorías.
  const topics: PushTopic[] = post.categories.filter((c) => isPushTopic(c))
  return topics.length ? { send: true, topics } : { send: false, reason: 'sin categorías' }
}

export interface NotifiableAlert {
  severity: 'info' | 'urgente'
  confirmation: 'proposed' | 'confirmed' | 'dismissed'
  expiresAt: string | null
}

export function decideAlertNotification(alert: NotifiableAlert, now: Date): Decision {
  if (alert.confirmation !== 'confirmed') return { send: false, reason: 'alerta sin confirmación editorial' }
  if (alert.expiresAt && new Date(alert.expiresAt) <= now) return { send: false, reason: 'alerta vencida' }
  return alert.severity === 'urgente' ? { send: true, topics: ['urgente'] } : { send: false, reason: 'aviso informativo: no genera notificación masiva' }
}

/** ¿Debe recibir esta suscripción el aviso? Por intersección de temas elegidos. */
export function subscriptionMatches(subscriptionTopics: string[], topics: PushTopic[]): boolean {
  return topics.some((t) => subscriptionTopics.includes(t))
}

export const dedupeKey = (type: 'post' | 'alert' | 'obituary', id: number) => `${type}:${id}`
