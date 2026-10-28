import { z } from 'zod'

const url = z.url({ protocol: /^https?$/ })
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Cómo respalda el proyecto cada afirmación: nunca se presenta como confirmado lo que no lo está. */
export const evidenceKindSchema = z.enum([
  'documentado', // figura en una fuente enlazada
  'equipo', // aporte del equipo del proyecto, a confirmar con documentación
  'pendiente', // falta información: se muestra como pendiente
])

export const sourceRefSchema = z.object({
  label: z.string().min(1),
  url: url.optional(),
  /** Fecha de publicación o de consulta de la fuente. */
  date: isoDate.optional(),
})

// ---------------------------------------------------------- Servicios y lugares
export const PLACE_CATEGORIES = ['policia', 'salud', 'farmacias', 'comuna', 'educacion', 'clubes', 'iglesias', 'comunitarios', 'cultural', 'transporte'] as const
export const placeCategorySchema = z.enum(PLACE_CATEGORIES)

export const PLACE_CATEGORY_LABEL: Record<(typeof PLACE_CATEGORIES)[number], string> = {
  policia: 'Policía',
  salud: 'CAPS y salud',
  farmacias: 'Farmacias',
  comuna: 'Comuna',
  educacion: 'Instituciones educativas',
  clubes: 'Clubes',
  iglesias: 'Iglesias',
  comunitarios: 'Espacios comunitarios',
  cultural: 'Lugares culturales e históricos',
  transporte: 'Paradas de colectivo',
}

export const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** 'edificio' = punto sobre el inmueble; 'zona' = centro de un predio o espacio abierto. */
  accuracy: z.enum(['edificio', 'zona']).default('edificio'),
  /** Procedencia obligatoria de las coordenadas (p. ej. elemento de OpenStreetMap) y fecha de consulta. */
  source: sourceRefSchema.extend({ url: z.url({ protocol: /^https?$/ }) }),
  note: z.string().optional(),
})

export const placeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: placeCategorySchema,
  address: z.string().optional(),
  /** Número en formato visible, tal como se publica. */
  phone: z.string().optional(),
  hours: z.string().optional(),
  description: z.string().optional(),
  links: z.array(z.object({ label: z.string(), url })).default([]),
  /**
   * Ubicación en el mapa. Solo se carga con coordenadas respaldadas por una fuente; si no, el lugar queda
   * en su listado con la ubicación marcada como pendiente (campo `pending` con «location»).
   */
  location: locationSchema.optional(),
  sources: z.array(sourceRefSchema).default([]),
  /** Última verificación contra la fuente (AAAA-MM-DD). */
  verifiedAt: isoDate.optional(),
  /** Campos todavía sin confirmar (se muestran como "pendiente de confirmación"). */
  pending: z.array(z.enum(['address', 'phone', 'hours', 'description', 'location'])).default([]),
  /** Aclaración sobre la procedencia del dato, visible en la ficha. */
  dataNote: z.string().optional(),
})
export const placesFileSchema = z.array(placeSchema)

export const emergencyNumberSchema = z.object({
  id: z.string(),
  label: z.string(),
  phone: z.string(),
  note: z.string().optional(),
})
export const emergencyFileSchema = z.array(emergencyNumberSchema)

// --------------------------------------------------------------- Nuestro pueblo
export const heritageClaimSchema = z.object({
  kind: evidenceKindSchema,
  text: z.string().min(1),
  source: sourceRefSchema.optional(),
})

/** Ranura para material cedido (fotos oficiales, reseñas). Vacía hasta contar con autorización. */
export const heritageMediaSchema = z.object({
  src: z.string().min(1),
  alt: z.string().min(1),
  credit: z.string().min(1),
  license: z.string().min(1),
})

export const heritageSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Frase breve de presentación (sin datos no documentados). */
  summary: z.string().min(1),
  icon: z.enum(['landmark', 'factory', 'trophy', 'church', 'trees', 'flag', 'star', 'award', 'music']),
  claims: z.array(heritageClaimSchema).min(1),
  media: z.array(heritageMediaSchema).default([]),
  /** Detalles que se incorporarán cuando haya documentación o material cedido por la Comuna. */
  pendingDetails: z.array(z.string()).default([]),
  featured: z.boolean().default(false),
})
export const heritageFileSchema = z.array(heritageSectionSchema)

export type EvidenceKind = z.infer<typeof evidenceKindSchema>
export type Place = z.infer<typeof placeSchema>
export type PlaceLocation = z.infer<typeof locationSchema>
export type PlaceCategory = z.infer<typeof placeCategorySchema>
export type EmergencyNumber = z.infer<typeof emergencyNumberSchema>
export type HeritageSection = z.infer<typeof heritageSectionSchema>
export type HeritageClaim = z.infer<typeof heritageClaimSchema>
