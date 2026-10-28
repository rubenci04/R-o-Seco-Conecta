import { describe, expect, it } from 'vitest'
import { defaultClassifier } from './classifier'
import { isCategoryId, isPushTopic } from './categories'
import { TOPIC_INFO, TOPIC_ORDER } from './pushTopics'

// Todos los textos son SINTÉTICOS (redactados para probar reglas): no son publicaciones reales ni personas reales.
const classify = (body: string) => defaultClassifier.classify({ title: body.split('\n')[0].slice(0, 80), body })
const ids = (r: ReturnType<typeof classify>) => r.categories.map((c) => c.id)

describe('categoría residuos', () => {
  it('existe como categoría y como tema de notificación independiente', () => {
    expect(isCategoryId('residuos')).toBe(true)
    expect(isPushTopic('residuos')).toBe(true)
    expect(TOPIC_ORDER).toContain('residuos')
    expect(TOPIC_INFO.residuos.label).toMatch(/residuos/i)
  })

  it.each([
    'Se suspende la recolección de residuos de hoy por trabajos en el camión recolector.',
    'Recolección reprogramada: el camión recolector pasará el jueves en lugar del miércoles.',
    'Cambio de recorrido de la recolección de basura en barrio Sur durante esta semana.',
    'El servicio de limpieza informa nuevo horario de recolección de residuos domiciliarios.',
    'Invitamos a la jornada de limpieza del barrio. Traé guantes y bolsas.',
  ])('clasifica como residuos: %s', (text) => {
    expect(ids(classify(text))).toContain('residuos')
  })

  it('una palabra suelta no alcanza', () => {
    expect(ids(classify('Hoy tiramos la basura de la vida cotidiana y seguimos adelante con alegría.'))).not.toContain('residuos')
    expect(ids(classify('Torneo de fútbol infantil este sábado en el club del pueblo, entrada libre.'))).not.toContain('residuos')
  })

  it('una suspensión propone un aviso de servicio NO urgente, que requiere confirmación humana', () => {
    const r = classify('Se suspende la recolección de residuos de hoy por las intensas lluvias.')
    expect(r.alert).toMatchObject({ kind: 'comunicado', severity: 'info' })
    expect(r.alert?.severity).not.toBe('urgente')
  })

  it('la recolección habitual (informativa) no genera alerta', () => {
    const r = classify('Recordamos los días de recolección de residuos domiciliarios: lunes, miércoles y viernes por la mañana.')
    expect(ids(r)).toContain('residuos')
    expect(r.alert).toBeNull()
  })

  it('un servicio restablecido no propone alerta', () => {
    expect(classify('Se restableció la recolección de residuos en todo el pueblo, ya funciona con normalidad.').alert).toBeNull()
  })
})

describe('una publicación, varias categorías', () => {
  it('suspensión de recolección por lluvias: residuos + meteorológica + aviso de servicio', () => {
    const r = classify('Se suspende la recolección de residuos por las intensas lluvias de hoy.')
    expect(ids(r)).toEqual(expect.arrayContaining(['residuos', 'meteorologica']))
    expect(r.alert?.kind).toBe('comunicado')
  })

  it('Festival del Pesebre: eventos + cultura', () => {
    expect(ids(classify('Festival del Pesebre este sábado en la plaza con música y artesanos. Los esperamos.'))).toEqual(expect.arrayContaining(['eventos', 'cultura']))
  })

  it('suspensión de clases por tormenta: educación + meteorológica', () => {
    const r = classify('Se suspenden las clases en todas las escuelas por la tormenta prevista para mañana.')
    expect(ids(r)).toEqual(expect.arrayContaining(['educacion', 'meteorologica']))
  })

  it('un comunicado común nunca se vuelve urgente por sí solo', () => {
    const r = classify('Se suspende la recolección de residuos. Es urgente que los vecinos saquen la basura antes de las 7. ')
    expect(r.alert?.severity).not.toBe('urgente')
  })
})

describe('obituarios: expresiones locales (textos sintéticos)', () => {
  it.each([
    'Con inmenso dolor comunicamos que partió a la casa del Padre Juana Pérez. Sus restos serán velados en su domicilio.',
    'Participamos con dolor el fallecimiento de Carlos Gómez. El cortejo fúnebre saldrá a las 16 hs.',
    'La familia invita a acompañar a Rosa Díaz. Cámara ardiente en el salón comunal. En paz descanse.',
    'Dolorosa pérdida para el pueblo: falleció don Mario Ledesma. Velatorio en su casa, sepelio mañana.',
  ])('detecta aviso fúnebre y exige revisión humana: %s', (text) => {
    const r = classify(text)
    expect(ids(r)).toContain('obituarios')
    expect(r.obituary).not.toBeNull()
    expect(r.needsReview).toBe(true)
    expect(r.alert).toBeNull()
  })

  it('un aviso fúnebre no se mezcla con eventos ni deportes por palabras sueltas', () => {
    expect(ids(classify('Despedimos a don Luis Rojas, querido vecino y fundador del club. Velatorio en el club, sepelio a las 17 hs.'))).toEqual(['obituarios'])
  })

  it('texto que habla de otra cosa no es obituario', () => {
    expect(classify('Mantenimiento del cementerio: la Comuna realiza tareas de pintura y limpieza esta semana.').obituary).toBeNull()
  })
})
