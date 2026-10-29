/**
 * Fotografías aportadas por el equipo, tomadas de la página pública de Facebook de la Comuna de Río Seco.
 * El texto alternativo describe solo lo que se ve; no se agregan nombres, fechas ni atribuciones individuales.
 * PENDIENTE: la reutilización institucional todavía no está documentada por escrito (ver docs/FOTOGRAFIAS.md).
 */
export const PHOTO_SOURCE = { label: 'Facebook de la Comuna de Río Seco', url: 'https://www.facebook.com/p/Comuna-De-Rio-Seco-61553018412844/' } as const

export interface Photo {
  id: string
  src: string
  width: number
  height: number
  alt: string
  /** 'ilustracion' = imagen generada con IA (no es una fotografía documental). */
  kind?: 'foto' | 'ilustracion'
}

/** Fotografías que ilustran cada ficha de «Nuestro pueblo» (clave = id de la sección). */
export const SECTION_PHOTOS: Record<string, string[]> = {
  'desfiles-17-agosto': ['desfile1', 'desfile2', 'desfile3', 'desfile4', 'desfile5'],
  'iglesia-tradiciones': ['parroquia'],
  'tradicion-pesebres': ['pesebre'],
}
/** Fotografías de fichas de lugares (clave = id del lugar). */
export const PLACE_PHOTOS: Record<string, string[]> = { 'parroquia-inmaculada-concepcion': ['parroquia'] }

export const PHOTOS: Record<string, Photo> = {
  desfile1: { id: 'desfile1', src: '/photos/desfile1.webp', width: 960, height: 538, alt: 'Formación uniformada desfilando por una calle' },
  desfile2: { id: 'desfile2', src: '/photos/desfile2.webp', width: 960, height: 538, alt: 'Fotografía de un desfile' },
  desfile3: { id: 'desfile3', src: '/photos/desfile3.webp', width: 538, height: 960, alt: 'Abanderado y banda de música en un desfile, con la bandera argentina' },
  desfile4: { id: 'desfile4', src: '/photos/desfile4.webp', width: 960, height: 538, alt: 'Fotografía de un desfile' },
  desfile5: { id: 'desfile5', src: '/photos/desfile5.webp', width: 960, height: 538, alt: 'Ceremonia con entrega de diplomas en un acto' },
  'guardia-urbana': { id: 'guardia-urbana', src: '/photos/guardia-urbana.webp', width: 1200, height: 802, alt: 'Grupo uniformado formado en un salón, con un cartel que dice «Río Seco»' },
  pesebre: { id: 'pesebre', src: '/photos/pesebre.webp', width: 1200, height: 900, alt: 'Ilustración generada con IA de un pesebre con un ángel y una estrella sobre una torre', kind: 'ilustracion' },
  parroquia: { id: 'parroquia', src: '/photos/parroquia.webp', width: 720, height: 542, alt: 'Celebración en el interior de una iglesia, con fieles y un sacerdote' },
}
