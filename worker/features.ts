/**
 * Banderas de funcionalidades. Lo que está en `false` NO registra rutas: no existe en producción.
 * - push: suscripciones y envío de notificaciones Web Push (requiere claves VAPID; sin ellas la API responde «no disponible»).
 * - staticModules: API de radios, lugares, transporte y CRUD de esas tablas (los datos vigentes siguen en JSON validado).
 * - syncSources: sincronización con Meta desde el panel y el cron (requiere credenciales y permisos).
 */
export interface Features {
  push: boolean
  staticModules: boolean
  syncSources: boolean
  /** Sincronización automática programada (cron) con Meta. Sigue desactivada hasta el Sprint 06. */
  scheduledSync: boolean
}

export const PRODUCTION_FEATURES: Features = { push: true, staticModules: false, syncSources: true, scheduledSync: false }
