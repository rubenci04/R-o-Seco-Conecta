export const CATEGORY_IDS = [
  'institucional',
  'agua',
  'energia',
  'calles',
  'residuos',
  'meteorologica',
  'eventos',
  'deportes',
  'cultura',
  'educacion',
  'salud',
  'obituarios',
  'otros',
] as const

export type CategoryId = (typeof CATEGORY_IDS)[number]

export const CATEGORY_LABEL: Record<CategoryId, string> = {
  institucional: 'Noticias institucionales',
  agua: 'Cortes de agua',
  energia: 'Cortes de energía',
  calles: 'Calles cortadas',
  residuos: 'Recolección de residuos y limpieza urbana',
  meteorologica: 'Alertas meteorológicas',
  eventos: 'Eventos y festividades',
  deportes: 'Actividades deportivas',
  cultura: 'Cultura',
  educacion: 'Educación',
  salud: 'Salud',
  obituarios: 'Obituarios',
  otros: 'Otros avisos comunitarios',
}

export type AlertKind = 'agua' | 'energia' | 'calles' | 'meteorologica' | 'comunicado'

/** Temas de suscripción push: cada categoría más las alertas urgentes confirmadas. */
export const PUSH_TOPICS = [...CATEGORY_IDS, 'urgente'] as const
export type PushTopic = (typeof PUSH_TOPICS)[number]

export const isCategoryId = (v: string): v is CategoryId => (CATEGORY_IDS as readonly string[]).includes(v)
export const isPushTopic = (v: string): v is PushTopic => (PUSH_TOPICS as readonly string[]).includes(v)
