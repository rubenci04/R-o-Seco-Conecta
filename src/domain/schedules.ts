import { z } from 'zod'
import { dayTypeSchema, sourceSchema } from './schemas'

/**
 * Formato de almacenamiento de horarios importados: fiel a la fuente (por página de ruta, ruta, viaje),
 * compacto y sin horarios deducidos. `expandSchedules` lo convierte al modelo `Service` que usa el buscador.
 */

/** "HH:mm" tal como figura en la fuente (las salidas de madrugada llegan como 00:10, 01:15…); "~" delante = aproximado. */
export const rawTimeSchema = z.string().regex(/^~?([01]\d|2[0-3]):[0-5]\d$/)

export const scheduleStopSchema = z.object({
  city: z.string().min(1),
  /** Referencia del punto de parada ("Terminal", "Plaza", "Iglesia"…). */
  note: z.string().optional(),
})

export const scheduleTripSchema = z.object({
  /** Los feriados usan el cuadro de domingo según la fuente ("domingos y feriados"). */
  dayType: z.enum(['weekday', 'saturday', 'sunday']),
  serviceType: z.enum(['común', 'semirrápido']),
  /** Un valor por parada de la ruta; `null` = la fuente no informa hora en esa parada (no se deduce). */
  times: z.array(rawTimeSchema.nullable()).min(2),
})

export const scheduleRouteSchema = z.object({
  name: z.string().min(1),
  companyId: z.string().min(1),
  stops: z.array(scheduleStopSchema).min(2),
  trips: z.array(scheduleTripSchema),
})

export const schedulePageSchema = z.object({
  /** Localidad opuesta a Río Seco. */
  localityId: z.string().min(1),
  localityName: z.string().min(1),
  direction: z.enum(['from-rio-seco', 'to-rio-seco']),
  url: z.url(),
  routes: z.array(scheduleRouteSchema),
  /** Totales que la propia página declara, para verificar la importación. */
  declared: z.object({ weekday: z.number().int().nullable(), saturday: z.number().int().nullable(), sunday: z.number().int().nullable() }),
  /** Cantidad de horarios distintos que enumera su FAQ por tipo de día (la FAQ elimina horas repetidas). */
  faqUniqueTimes: z.object({ weekday: z.number().int(), saturday: z.number().int(), sunday: z.number().int() }),
})

export const schedulesDatasetSchema = z.object({
  source: sourceSchema,
  fetchedAt: z.string().datetime(),
  /** Aclaración editorial sobre la procedencia y las reglas aplicadas. */
  notes: z.array(z.string()),
  companies: z.array(z.object({ id: z.string(), name: z.string() })),
  pages: z.array(schedulePageSchema),
})

export type ScheduleTrip = z.infer<typeof scheduleTripSchema>
export type ScheduleRoute = z.infer<typeof scheduleRouteSchema>
export type SchedulePage = z.infer<typeof schedulePageSchema>
export type SchedulesDataset = z.infer<typeof schedulesDatasetSchema>
export { dayTypeSchema }
