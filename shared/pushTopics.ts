import type { PushTopic } from './categories'

/**
 * Temas de notificación que el vecino puede elegir. NINGUNO está activado automáticamente:
 * el consentimiento es explícito y por tema. Los obituarios son un tema aparte, solo por elección expresa.
 */
export interface TopicInfo {
  label: string
  description: string
  group: 'importantes' | 'novedades' | 'sensibles'
}

export const TOPIC_INFO: Record<PushTopic, TopicInfo> = {
  urgente: { label: 'Alertas urgentes', description: 'Emergencias y avisos urgentes confirmados por la redacción.', group: 'importantes' },
  agua: { label: 'Cortes de agua', description: 'Interrupciones del suministro de agua.', group: 'importantes' },
  energia: { label: 'Cortes de electricidad', description: 'Interrupciones del servicio eléctrico.', group: 'importantes' },
  calles: { label: 'Calles cortadas', description: 'Cortes de calles, rutas y desvíos.', group: 'importantes' },
  residuos: { label: 'Recolección de residuos y limpieza', description: 'Suspensiones, cambios de recorrido, reprogramaciones y campañas de limpieza.', group: 'importantes' },
  meteorologica: { label: 'Alertas meteorológicas', description: 'Avisos por tormentas, calor, frío y otros fenómenos.', group: 'importantes' },
  institucional: { label: 'Noticias institucionales', description: 'Comunicados y novedades de la Comuna.', group: 'novedades' },
  eventos: { label: 'Eventos y festividades', description: 'Fiestas, actos y celebraciones del pueblo.', group: 'novedades' },
  cultura: { label: 'Cultura y eventos culturales', description: 'Música, talleres, muestras y tradiciones.', group: 'novedades' },
  deportes: { label: 'Actividades deportivas', description: 'Torneos, clubes y competencias.', group: 'novedades' },
  educacion: { label: 'Educación', description: 'Escuelas, inscripciones y clases.', group: 'novedades' },
  salud: { label: 'Salud', description: 'Campañas, vacunación y atención.', group: 'novedades' },
  otros: { label: 'Otras novedades comunitarias', description: 'Avisos que no encajan en otra categoría.', group: 'novedades' },
  obituarios: { label: 'Obituarios', description: 'Comunicados fúnebres aprobados por la redacción. Solo si lo elegís expresamente.', group: 'sensibles' },
}

/** Orden de presentación. */
export const TOPIC_ORDER: PushTopic[] = ['urgente', 'agua', 'energia', 'calles', 'residuos', 'meteorologica', 'institucional', 'eventos', 'cultura', 'deportes', 'educacion', 'salud', 'otros', 'obituarios']

/** Configuración inicial sencilla: solo avisos importantes. Nunca incluye obituarios ni «todo». */
export const PRESETS: Record<'importantes' | 'comuna', { label: string; topics: PushTopic[] }> = {
  importantes: { label: 'Solo avisos importantes', topics: ['urgente', 'agua', 'energia', 'calles', 'meteorologica'] },
  comuna: { label: 'Avisos importantes y novedades de la Comuna', topics: ['urgente', 'agua', 'energia', 'calles', 'meteorologica', 'institucional', 'eventos'] },
}
export const DEFAULT_TOPICS: PushTopic[] = PRESETS.importantes.topics
