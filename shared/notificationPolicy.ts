import type { AlertKind, CategoryId, PushTopic } from './categories'
import { isPushTopic } from './categories'

/** Una publicación solo genera aviso si es reciente: evita inundar de avisos al importar un historial. */
export const MAX_NOTIFY_AGE_HOURS = 6
/** Si un mismo ciclo importa más publicaciones que esto, se tratan como carga histórica y no se notifican. */
export const MAX_NOTIFY_PER_SYNC = 3

/** Categorías cuyo aviso lo da la ALERTA (confirmada por una persona), no la noticia: evita avisar dos veces lo mismo. */
export const ALERT_CAPABLE: CategoryId[] = ['agua', 'energia', 'calles', 'meteorologica']

export interface NotifiablePost {
  status: 'draft' | 'pending' | 'published' | 'rejected' | 'deleted'
  publishedAt: string
  categories: CategoryId[]
  /** Posible obituario aún sin aprobar. */
  obituaryPending: boolean
  /** Existe una alerta (propuesta o confirmada, no descartada) generada por esta publicación. */
  coveredByAlert?: boolean
}

export type Decision = { send: true; topics: PushTopic[] } | { send: false; reason: string }

export function decidePostNotification(post: NotifiablePost, now: Date, importedThisRun = 1): Decision {
  if (post.status !== 'published') return { send: false, reason: 'no publicada' }
  if (post.obituaryPending) return { send: false, reason: 'obituario pendiente de revisión' }
  if (importedThisRun > MAX_NOTIFY_PER_SYNC) return { send: false, reason: 'carga masiva: no se notifica el historial' }
  const ageHours = (now.getTime() - new Date(post.publishedAt).getTime()) / 3_600_000
  if (ageHours > MAX_NOTIFY_AGE_HOURS) return { send: false, reason: 'publicación antigua' }
  // Un obituario aprobado solo se avisa a quien eligió expresamente ese tema; nunca se mezcla con otras categorías.
  if (post.categories.includes('obituarios')) return { send: true, topics: ['obituarios'] }
  // Las noticias comunes NUNCA usan el tema «urgente»: solo sus categorías.
  let topics: PushTopic[] = post.categories.filter((c) => isPushTopic(c))
  if (post.coveredByAlert) topics = topics.filter((t) => !ALERT_CAPABLE.includes(t as CategoryId))
  if (topics.length) return { send: true, topics }
  return { send: false, reason: post.coveredByAlert ? 'cubierta por una alerta' : 'sin categorías' }
}

export interface NotifiableAlert {
  kind: AlertKind
  severity: 'info' | 'urgente'
  confirmation: 'proposed' | 'confirmed' | 'dismissed'
  startsAt?: string
  expiresAt: string | null
}

const KIND_TOPIC: Record<AlertKind, PushTopic> = { agua: 'agua', energia: 'energia', calles: 'calles', meteorologica: 'meteorologica', comunicado: 'institucional' }
export const alertKindTopic = (kind: AlertKind): PushTopic => KIND_TOPIC[kind]

/**
 * Audiencia de una alerta CONFIRMADA y vigente:
 *  - urgente → quienes eligieron «alertas urgentes» o el tema de su tipo (agua, energía…); prioridad alta.
 *  - informativa → solo quienes eligieron el tema de su tipo; prioridad normal.
 * Nunca se envía sin confirmación editorial ni fuera de su vigencia.
 */
export function decideAlertNotification(alert: NotifiableAlert, now: Date): Decision {
  if (alert.confirmation !== 'confirmed') return { send: false, reason: 'alerta sin confirmación editorial' }
  if (alert.startsAt && new Date(alert.startsAt) > now) return { send: false, reason: 'alerta aún no vigente' }
  if (alert.expiresAt && new Date(alert.expiresAt) <= now) return { send: false, reason: 'alerta vencida' }
  const kind = alertKindTopic(alert.kind)
  return { send: true, topics: alert.severity === 'urgente' ? ['urgente', kind] : [kind] }
}

/** ¿Debe recibir esta suscripción el aviso? Por intersección de temas elegidos. */
export function subscriptionMatches(subscriptionTopics: string[], topics: PushTopic[]): boolean {
  return topics.some((t) => subscriptionTopics.includes(t))
}

export const dedupeKey = (type: 'post' | 'alert' | 'obituary', id: number) => `${type}:${id}`
