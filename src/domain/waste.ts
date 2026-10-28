import { z } from 'zod'
import { sourceSchema } from './schemas'

/**
 * Datos CONFIRMADOS de recolección de residuos. Se cargan solo con fuente y fecha de verificación; si no hay datos
 * confirmados, la página lo dice y nunca inventa frecuencias, horarios ni recorridos.
 */
export const wasteScheduleSchema = z.object({
  id: z.string().min(1),
  zone: z.string().min(1),
  days: z.array(z.enum(['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'])).min(1),
  time: z.string().optional(),
  route: z.string().optional(),
  note: z.string().optional(),
  source: sourceSchema,
  lastVerified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})
export const wasteCampaignSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: sourceSchema,
})
export const wasteFileSchema = z.object({ schedule: z.array(wasteScheduleSchema), campaigns: z.array(wasteCampaignSchema) })
export type WasteInfo = z.infer<typeof wasteFileSchema>
