import { z } from 'zod'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha esperada: AAAA-MM-DD')
const isoDateTime = z.string().datetime({ offset: true })
/** HH:mm, admite horas 24–47 para servicios que cruzan la medianoche (ej. "24:30" = 00:30 del día siguiente). */
export const timeString = z.string().regex(/^([0-3]\d|4[0-7]):[0-5]\d$/, 'Hora esperada: HH:mm (00–47)')
const url = z.url({ protocol: /^https?$/ })

export const sourceSchema = z.object({
  label: z.string().min(1),
  url,
  /** Si el dato puede reutilizarse según la fuente. Los horarios solo se cargan con `true`. */
  reuseAuthorized: z.boolean(),
})

// ---------- Transporte ----------
export const dayTypeSchema = z.enum(['weekday', 'saturday', 'sunday', 'holiday'])
export const directionSchema = z.enum(['from-rio-seco', 'to-rio-seco'])

export const companySchema = z.object({ id: z.string().min(1), name: z.string().min(1) })
export const stopSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  localityId: z.string().min(1),
})
export const localitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Estado de verificación del servicio hacia/desde esta localidad. */
  status: z.enum(['sin-datos', 'verificado']),
  referenceUrl: url.optional(),
})

export const serviceSchema = z.object({
  id: z.string().min(1),
  companyId: z.string().min(1),
  localityId: z.string().min(1),
  direction: directionSchema,
  originStopId: z.string().min(1),
  destinationStopId: z.string().min(1),
  departure: timeString,
  arrival: timeString.optional(),
  serviceType: z.enum(['común', 'semirrápido', 'rápido', 'diferencial']).default('común'),
  dayTypes: z.array(dayTypeSchema).min(1),
  precision: z.enum(['confirmed', 'approximate']),
  source: sourceSchema,
  lastVerified: isoDate,
  validFrom: isoDate.optional(),
  validTo: isoDate.optional(),
  /** Fechas puntuales en las que el servicio no circula. */
  exceptions: z.array(z.object({ date: isoDate, note: z.string().optional() })).default([]),
  // Datos adicionales conservados de la fuente (opcionales).
  durationMinutes: z.number().int().positive().optional(),
  observations: z.string().optional(),
  routeName: z.string().optional(),
  arrivalApproximate: z.boolean().optional(),
  /** Paradas intermedias con la hora que informa la fuente (null = sin dato). Nunca se interpolan. */
  stopTimes: z.array(z.object({ name: z.string(), time: timeString.nullable(), approximate: z.boolean() })).optional(),
})

export const holidaySchema = z.object({
  /** Fecha completa, o MM-DD para feriados de fecha fija que se repiten todos los años. */
  date: z.union([isoDate, z.string().regex(/^\d{2}-\d{2}$/)]),
  name: z.string().min(1),
  scope: z.enum(['nacional', 'provincial', 'local']),
  source: z.string().min(1),
})

export const transportDataSchema = z.object({
  companies: z.array(companySchema),
  localities: z.array(localitySchema),
  stops: z.array(stopSchema),
  services: z.array(serviceSchema),
})

// ---------- Contenido editorial ----------
const contentSource = z.object({ label: z.string().min(1), url })
/** Fuente con enlace opcional (p. ej. notas de la redacción sin enlace externo). */
const optionalSource = z.object({ label: z.string().min(1), url: url.optional() })

export const newsItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().optional(),
  publishedAt: isoDateTime,
  source: optionalSource,
  /** true = la redacción revisó y aprobó el contenido. Lo importado sin revisión NO es verified. */
  verified: z.boolean(),
  origin: z.enum(['api', 'assisted', 'manual']).optional(),
  body: z.string().optional(),
  categories: z.array(z.string()).optional(),
  rectification: z.string().optional(),
  rectifiedAt: isoDateTime.optional(),
})
export const alertSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  severity: z.enum(['info', 'aviso', 'urgente']),
  publishedAt: isoDateTime,
  expiresAt: isoDateTime.optional(),
  source: optionalSource,
})
export const eventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  startsAt: isoDateTime,
  place: z.string().optional(),
  category: z.enum(['evento', 'festividad', 'actividad']),
  source: contentSource,
})
export const obituarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  message: z.string().optional(),
  date: isoDate,
  service: z.string().optional(),
  source: optionalSource,
  rectification: z.string().optional(),
  /** Solo se publican comunicados verificados con consentimiento de la familia. */
  verified: z.literal(true),
})
export const radioSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  frequency: z.string().min(1),
  siteUrl: url,
  tagline: z.string().optional(),
})

export const newsFileSchema = z.array(newsItemSchema)
export const alertsFileSchema = z.array(alertSchema)
export const eventsFileSchema = z.array(eventSchema)
export const obituariesFileSchema = z.array(obituarySchema)
export const radiosFileSchema = z.array(radioSchema)
export const holidaysFileSchema = z.array(holidaySchema)
