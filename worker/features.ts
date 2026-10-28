/**
 * Banderas de funcionalidades. Lo que está en `false` NO registra rutas: no existe en producción.
 * - push: suscripciones y envío de notificaciones Web Push (Sprint posterior, requiere claves VAPID).
 * - staticModules: API de radios, lugares, transporte y CRUD de esas tablas (los datos vigentes siguen en JSON validado).
 * - syncSources: sincronización con Meta desde el panel y el cron (requiere credenciales y permisos).
 */
export interface Features {
  push: boolean
  staticModules: boolean
  syncSources: boolean
}

export const PRODUCTION_FEATURES: Features = { push: false, staticModules: false, syncSources: true }
