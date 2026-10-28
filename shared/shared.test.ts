// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { addSeconds, nextDelaySeconds } from './backoff'
import { defaultClassifier, suggestName } from './classifier'
import { contentHash, isNearDuplicate, parsePostLink, similarity } from './dedupe'
import { decideAlertNotification, decidePostNotification, subscriptionMatches } from './notificationPolicy'
import { can } from './permissions'

/** Textos redactados para probar reglas; NO son publicaciones reales de la Comuna. */
const classify = (body: string, title = body.split('\n')[0]) => defaultClassifier.classify({ title, body })
const ids = (r: ReturnType<typeof classify>) => r.categories.map((c) => c.id)

describe('clasificador por reglas', () => {
  it('detecta corte de agua por contexto (sujeto + acción en la misma oración)', () => {
    const r = classify('Aviso: mañana habrá interrupción del suministro de agua en barrio Norte por trabajos de reparación.')
    expect(ids(r)).toContain('agua')
    expect(r.alert?.kind).toBe('agua')
    expect(r.alert?.severity).toBe('info')
  })
  it('detecta corte de energía y calles cortadas, y permite varias categorías', () => {
    const r = classify('Corte de luz programado en el centro. Además la calle San Martín estará cortada por trabajos.')
    expect(ids(r)).toEqual(expect.arrayContaining(['energia', 'calles']))
  })
  it('clasifica eventos, deportes, cultura, educación y salud', () => {
    expect(ids(classify('Este sábado festival folclórico en la plaza, entrada libre. Te esperamos.'))).toContain('eventos')
    expect(ids(classify('Torneo de fútbol infantil en el club, inscripciones abiertas para los equipos.'))).toContain('deportes')
    expect(ids(classify('Taller de artesanías en la biblioteca popular, música y danza folclórica.'))).toContain('cultura')
    expect(ids(classify('Inscripciones abiertas en la escuela N° 45 para el ciclo lectivo.'))).toContain('educacion')
    expect(ids(classify('Campaña de vacunación en el centro de salud, operativo sanitario para vecinos.'))).toContain('salud')
  })
  it('una palabra aislada NO crea alerta: "urgente" sin contexto, o "corte" sin sujeto', () => {
    expect(classify('Es urgente que los vecinos pasen por la oficina a retirar sus boletas.').alert?.severity).not.toBe('urgente')
    const corte = classify('Hoy tuvimos un corte de pelo solidario en la plaza.')
    expect(ids(corte)).not.toContain('agua')
    expect(ids(corte)).not.toContain('energia')
    expect(corte.alert).toBeNull()
  })
  it('urgente requiere contexto de categoría MÁS marcador de urgencia', () => {
    const r = classify('ALERTA NARANJA por tormentas fuertes y granizo. Máxima precaución, evitar circular por rutas.')
    expect(r.alert?.kind).toBe('meteorologica')
    expect(r.alert?.severity).toBe('urgente')
    expect(r.alert?.priority).toBe(3)
  })
  it('el mismo contexto sin marcador de urgencia queda como informativo', () => {
    const r = classify('Aviso meteorológico: se esperan lluvias moderadas durante la tarde.')
    expect(r.alert?.severity).toBe('info')
  })
  it('servicio restablecido o simulacro no genera alerta urgente', () => {
    const resolved = classify('Se restableció el suministro de agua en todo el pueblo tras la emergencia.')
    expect(resolved.alert?.severity).not.toBe('urgente')
    expect(classify('Simulacro de evacuación por tormenta en la escuela, ejercicio de prueba.').alert).toBeNull()
  })
  it('detecta posible obituario, sugiere nombre y exige revisión, sin crear alerta', () => {
    const r = classify('Con profundo pesar comunicamos el fallecimiento de Juan Carlos Pérez. Velatorio en su domicilio, sepelio a las 16 hs.')
    expect(ids(r)).toContain('obituarios')
    expect(r.obituary?.nameSuggestion).toBe('Juan Carlos Pérez')
    expect(r.needsReview).toBe(true)
    expect(r.alert).toBeNull()
  })
  it('sin evidencia suficiente propone baja confianza y va a revisión', () => {
    const r = classify('Buen día a todos.')
    expect(r.categories[0].confidence).toBeLessThan(0.5)
    expect(r.needsReview).toBe(true)
  })
  it('expone nombre del clasificador (reemplazable)', () => {
    expect(defaultClassifier.name).toBe('rules-v1')
  })
  it('suggestName devuelve null si no hay un nombre claro', () => {
    expect(suggestName('Hoy falleció alguien querido por todos')).toBeNull()
  })
})

describe('deduplicación', () => {
  it('la huella ignora mayúsculas, tildes, enlaces y signos', async () => {
    expect(await contentHash('¡Corte de AGUA mañana! https://x.com/a')).toBe(await contentHash('corte de agua mañana'))
    expect(await contentHash('uno')).not.toBe(await contentHash('dos'))
  })
  it('detecta la misma novedad publicada con retoques (Facebook ↔ Instagram)', () => {
    const fb = 'Mañana habrá corte de agua en barrio Norte desde las 8 hasta las 14 horas por trabajos de mantenimiento en la red.'
    const ig = 'MAÑANA habrá corte de agua en barrio Norte desde las 8 hasta las 14 horas por trabajos de mantenimiento en la red 💧 #RioSeco'
    expect(isNearDuplicate(fb, ig)).toBe(true)
    expect(similarity(fb, 'Torneo de fútbol infantil este domingo en el club con equipos de toda la zona y premios')).toBeLessThan(0.2)
  })
  it('textos cortos no se consideran duplicados por similitud', () => {
    expect(isNearDuplicate('Buen día', 'Buen día')).toBe(false)
  })
  it('interpreta enlaces de Instagram y Facebook y rechaza otros hosts', () => {
    expect(parsePostLink('https://www.instagram.com/p/Cxyz_123/?igsh=abc')).toEqual({ platform: 'instagram', externalId: 'Cxyz_123', canonicalUrl: 'https://www.instagram.com/p/Cxyz_123/' })
    expect(parsePostLink('https://www.facebook.com/comunaderioseco/posts/pfbid02abcDEF')?.externalId).toBe('pfbid02abcDEF')
    expect(parsePostLink('https://www.facebook.com/permalink.php?story_fbid=12345678&id=61553018412844')?.externalId).toBe('12345678')
    expect(parsePostLink('https://evil.example.com/p/abc')).toBeNull()
    expect(parsePostLink('javascript:alert(1)')).toBeNull()
    expect(parsePostLink('no es un enlace')).toBeNull()
  })
})

describe('reintentos con retroceso', () => {
  const mid = () => 0.5
  it('crece exponencialmente con tope', () => {
    expect(nextDelaySeconds('error', 1, undefined, mid)).toBe(60)
    expect(nextDelaySeconds('error', 2, undefined, mid)).toBe(120)
    expect(nextDelaySeconds('error', 3, undefined, mid)).toBe(240)
    expect(nextDelaySeconds('error', 30, undefined, mid)).toBe(3600)
  })
  it('respeta el Retry-After del proveedor y un mínimo ante límite de API', () => {
    expect(nextDelaySeconds('rate-limited', 1, 3000, mid)).toBe(3000)
    expect(nextDelaySeconds('rate-limited', 1, 10, mid)).toBe(900)
  })
  it('credenciales o permisos faltantes no se reintentan cada minuto', () => {
    expect(nextDelaySeconds('auth-error', 1)).toBe(21600)
    expect(nextDelaySeconds('permission-missing', 5)).toBe(21600)
  })
  it('addSeconds suma sobre ISO', () => {
    expect(addSeconds('2026-10-28T00:00:00.000Z', 90)).toBe('2026-10-28T00:01:30.000Z')
  })
})

describe('permisos por rol', () => {
  it('viewer solo lee', () => {
    expect(can('viewer', 'content:read')).toBe(true)
    for (const p of ['content:write', 'obituary:approve', 'alert:confirm-urgent', 'sources:manage', 'users:manage'] as const) expect(can('viewer', p)).toBe(false)
  })
  it('editor modera pero no administra conectores ni usuarios', () => {
    expect(can('editor', 'obituary:approve')).toBe(true)
    expect(can('editor', 'alert:confirm-urgent')).toBe(true)
    expect(can('editor', 'sources:manage')).toBe(false)
    expect(can('editor', 'users:manage')).toBe(false)
  })
  it('admin puede todo y sin rol no puede nada', () => {
    expect(can('admin', 'users:manage')).toBe(true)
    expect(can(undefined, 'content:read')).toBe(false)
  })
})

describe('política de notificaciones', () => {
  const now = new Date('2026-10-28T15:00:00Z')
  const post = (over = {}) => ({ status: 'published' as const, publishedAt: '2026-10-28T14:30:00Z', categories: ['agua' as const], obituaryPending: false, ...over })
  it('notifica una publicación reciente a sus categorías, sin usar el tema urgente', () => {
    expect(decidePostNotification(post(), now)).toEqual({ send: true, topics: ['agua'] })
  })
  it('no notifica publicaciones antiguas, ocultas, obituarios pendientes ni cargas masivas', () => {
    expect(decidePostNotification(post({ publishedAt: '2026-10-27T00:00:00Z' }), now).send).toBe(false)
    expect(decidePostNotification(post({ status: 'pending' }), now).send).toBe(false)
    expect(decidePostNotification(post({ obituaryPending: true }), now).send).toBe(false)
    expect(decidePostNotification(post(), now, 10).send).toBe(false)
  })
  it('las alertas urgentes requieren confirmación editorial y vigencia', () => {
    const base = { severity: 'urgente' as const, confirmation: 'proposed' as const, expiresAt: null }
    expect(decideAlertNotification(base, now).send).toBe(false)
    expect(decideAlertNotification({ ...base, confirmation: 'confirmed' }, now)).toEqual({ send: true, topics: ['urgente'] })
    expect(decideAlertNotification({ ...base, confirmation: 'confirmed', expiresAt: '2026-10-28T10:00:00Z' }, now).send).toBe(false)
  })
  it('un aviso informativo confirmado no genera notificación masiva', () => {
    expect(decideAlertNotification({ severity: 'info', confirmation: 'confirmed', expiresAt: null }, now).send).toBe(false)
  })
  it('las suscripciones reciben solo los temas elegidos', () => {
    expect(subscriptionMatches(['agua', 'salud'], ['agua'])).toBe(true)
    expect(subscriptionMatches(['salud'], ['urgente'])).toBe(false)
  })
})
