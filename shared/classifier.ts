import type { AlertKind, CategoryId } from './categories'
import { normalize, sentences } from './text'

/**
 * Contrato del clasificador. La aplicación depende solo de esta interfaz:
 * se puede reemplazar `RuleClassifier` por otro (modelo local, servicio propio, etc.)
 * sin tocar la ingesta, el panel ni las notificaciones.
 */
export interface Classifier {
  readonly name: string
  classify(input: ClassifierInput): ClassificationResult
}

export interface ClassifierInput {
  title: string
  body: string
}

export interface CategoryProposal {
  id: CategoryId
  /** 0..1 */
  confidence: number
  reasons: string[]
}

export interface AlertProposal {
  kind: AlertKind
  severity: 'info' | 'urgente'
  priority: number
  reason: string
  /** Horas de vigencia sugeridas desde la publicación; editable por una persona. */
  suggestedHours: number
}

export interface ObituaryProposal {
  /** Nombre sugerido (heurístico). NUNCA se publica sin que una persona lo valide. */
  nameSuggestion: string | null
  reasons: string[]
}

export interface ClassificationResult {
  classifier: string
  categories: CategoryProposal[]
  alert: AlertProposal | null
  obituary: ObituaryProposal | null
  /** true si la persona editora debería mirar la clasificación (confianza baja o señales mezcladas). */
  needsReview: boolean
}

interface Rule {
  id: CategoryId
  /** Frases fuertes: una sola alcanza para proponer la categoría. */
  strong?: RegExp[]
  /** Palabras débiles: sumadas (o con contexto) alcanzan, solas no. */
  weak?: RegExp[]
  /** Pares [sujeto, acción] que deben coincidir en la MISMA oración. */
  context?: [RegExp, RegExp][]
}

const re = (s: string) => new RegExp(s)

export const RULES: Rule[] = [
  {
    id: 'institucional',
    strong: [re('\\b(comisionado comunal|comision comunal|ordenanza|licitacion|resolucion comunal|sesion)\\b')],
    weak: [re('\\b(comuna|municipal|gestion|obra publica|obras|tramite|vecinos|atencion al publico|oficina)\\b')],
  },
  {
    id: 'agua',
    context: [
      [re('\\b(agua|suministro de agua|red de agua|agua potable|cloaca|cisterna|sat|tanque)\\b'), re('\\b(corte|cortes|interrupci\\w+|sin servicio|sin agua|falta de agua|suspension|suspend\\w+|trabajos|reparacion|baja presion|restriccion)\\b')],
    ],
    strong: [re('\\b(corte de agua|sin agua|falta de agua|corte del suministro de agua)\\b')],
  },
  {
    id: 'energia',
    context: [
      [re('\\b(energia|luz|electric\\w*|edet|transformador|tension|red electrica|suministro electrico)\\b'), re('\\b(corte|cortes|interrupci\\w+|sin luz|sin energia|apagon|suspension|suspend\\w+|trabajos|reparacion)\\b')],
    ],
    strong: [re('\\b(corte de luz|sin luz|corte de energia|apagon|corte programado de energia)\\b')],
  },
  {
    id: 'calles',
    context: [
      [re('\\b(calle|calles|ruta|avenida|camino|puente|transito|vado|acceso)\\b'), re('\\b(cortad\\w+|cerrad\\w+|interrumpid\\w+|desvio|intransitable|no transitable|corte de transito|corte total|corte parcial|anegad\\w+)\\b')],
    ],
    strong: [re('\\b(calle cortada|calles cortadas|corte de calle|corte de ruta|ruta cortada|desvio de transito)\\b')],
  },
  {
    id: 'residuos',
    // Un servicio (recolección/limpieza) más un cambio o campaña en la MISMA oración. «Basura» suelta no alcanza.
    context: [
      [re('\\b(recoleccion|recolector\\w*|camion recolector|basura|residuos|limpieza urbana|servicio de limpieza|higiene urbana)\\b'), re('\\b(suspend\\w+|suspension|reprogram\\w+|modific\\w+|cambio\\w*|no pasara|no habra|no se realizara|sin servicio|desvio|nuevo horario|nuevo recorrido|recorrido|horario|campana|jornada|dias de)\\b')],
    ],
    strong: [re('\\b(recoleccion de (residuos|basura)|camion recolector|residuos domiciliarios|recoleccion suspendida|recoleccion reprogramada|cambio de recorrido|servicio de limpieza|limpieza urbana|jornada de limpieza)\\b')],
    weak: [re('\\b(basura|residuos|basural\\w*|contenedor\\w*|reciclaje|higiene urbana)\\b')],
  },
  {
    id: 'meteorologica',
    context: [
      [re('\\b(alerta|aviso|pronostico|advertencia)\\b'), re('\\b(meteorolog\\w+|tormenta\\w*|granizo|lluvia\\w*|viento\\w*|temporal\\w*|ola de calor|ola de frio|helada\\w*|smn|servicio meteorologico|inundacion\\w*|crecida\\w*)\\b')],
      // Un fenómeno concreto que provoca un cambio de servicio («se suspende … por las intensas lluvias»).
      [re('\\b(tormenta\\w*|temporal\\w*|granizo|lluvias? intensas?|intensas? lluvias?|ola de calor|ola de frio|helada\\w*)\\b'), re('\\b(suspend\\w+|suspension|sin clases|cancel\\w+|anegad\\w+|precaucion|afecta\\w*|reprogram\\w+)\\b')],
    ],
    strong: [re('\\b(alerta meteorologica|alerta por tormenta|alerta por lluvias|alerta por vientos|servicio meteorologico nacional|smn)\\b')],
    weak: [re('\\b(tormenta|granizo|temporal|lluvias intensas)\\b')],
  },
  {
    id: 'eventos',
    strong: [re('\\b(festival|festividad\\w*|pena folclorica|pena|kermes|desfile|fiesta patronal|fiestas patronales|aniversario de|acto central|celebracion\\w*)\\b')],
    weak: [re('\\b(fiesta|baile|show|espectaculo|encuentro|invitamos|te esperamos|los esperamos|entrada libre|evento)\\b')],
  },
  {
    id: 'deportes',
    strong: [re('\\b(torneo|campeonato|futbol|liga|competencia deportiva|maraton|ciclismo|carrera pedestre|polideportivo)\\b')],
    weak: [re('\\b(club|partido|deporte\\w*|cancha|equipo|entrenamiento|atletismo|basquet|voley)\\b')],
  },
  {
    id: 'cultura',
    strong: [re('\\b(folclore|folklore|pesebre\\w*|muestra de arte|taller de (arte|musica|danza|teatro|artesanias?)|biblioteca|museo|ballet|artesanos|payada)\\b')],
    weak: [re('\\b(cultura|cultural|musica|danza|teatro|arte|coro|pintura|tradicion\\w*|poesia|libro)\\b')],
  },
  {
    id: 'educacion',
    context: [[re('\\b(clases|escuela\\w*|colegio\\w*|establecimientos? educativos?|jardin\\w*)\\b'), re('\\b(suspend\\w+|suspension|sin clases|se suspenden|reprogram\\w+)\\b')]],
    strong: [re('\\b(inscripciones? (abiertas|escolares)|ciclo lectivo|acto escolar|dia del maestro|jardin de infantes|escuela n[°o]?\\s?\\d+)\\b')],
    weak: [re('\\b(escuela|colegio|clases|docente\\w*|alumnos|estudiantes|educacion|aula|primaria|secundaria|capacitacion|beca\\w*)\\b')],
  },
  {
    id: 'salud',
    strong: [re('\\b(vacunacion|campana de vacunacion|operativo sanitario|centro de salud|caps|dengue|control medico|operativo de salud|salud publica)\\b')],
    weak: [re('\\b(salud|vacuna\\w*|hospital|sanatorio|medico\\w*|enfermer\\w*|sanitari\\w*|prevencion|odontolog\\w*|turnos)\\b')],
  },
  {
    id: 'obituarios',
    strong: [
      re('\\b(fallecio|fallecimiento|falleci\\w+|velatorio|sepelio|inhumacion|cortejo funebre|misa de cuerpo presente|q\\.?e\\.?p\\.?d|descanse en paz|nuestras condolencias|profundo pesar|lamentamos el fallecimiento|despedimos|partio a la casa del padre|con inmenso dolor|con profundo dolor|participan con dolor|participamos con dolor|sus restos|camara ardiente|en paz descanse|dolorosa perdida|acompanamos a (su|la) familia|el pueblo llora)\\b'),
    ],
  },
]

/** Señales de que el aviso ya no vale o es otra cosa (simulacro, restablecido…). Bajan la urgencia. */
const RESOLVED = re('\\b(se restablecio|restablecido|restablecimiento|normalizado|ya funciona|sin cortes|no habra cortes|finalizaron los trabajos|se levanto)\\b')
const DRILL = re('\\b(simulacro|capacitacion sobre|charla sobre|ejercicio de prueba)\\b')
const URGENCY_MARKER = re('\\b(urgente|inmediat\\w+|emergencia|evacua\\w*|alerta roja|alerta naranja|nivel rojo|nivel naranja|peligro|riesgo|extrema|extremo|no circular|evitar circular|maxima precaucion|resguardense|refugiense)\\b')
const SEVERE_LEVEL = re('\\b(alerta roja|alerta naranja|nivel rojo|nivel naranja)\\b')
const FUNERAL_CONTEXT = re('\\b(fallecio|fallecimiento|falleci\\w+|velatorio|sepelio|inhumacion|q\\.?e\\.?p\\.?d|descanse en paz|en paz descanse|condolencias|pesar|casa del padre|camara ardiente|sus restos|con inmenso dolor|dolorosa perdida)\\b')
/** Cambio o interrupción de un servicio de residuos (no una recolección habitual). */
const WASTE_SUBJECT = re('\\b(recoleccion|recolector\\w*|camion recolector|basura|residuos|servicio de limpieza|limpieza urbana)\\b')
const WASTE_INTERRUPTION = re('\\b(suspend\\w+|suspension|reprogram\\w+|no pasara|no habra|no se realizara|sin servicio|cambio de recorrido|cambio de dia|nuevo recorrido)\\b')

const ALERT_KIND_BY_CATEGORY: Partial<Record<CategoryId, AlertKind>> = {
  agua: 'agua',
  energia: 'energia',
  calles: 'calles',
  meteorologica: 'meteorologica',
}
const DEFAULT_HOURS: Record<AlertKind, number> = { agua: 24, energia: 24, calles: 24, meteorologica: 12, comunicado: 48 }

function scoreRule(rule: Rule, norm: string, sents: string[]): CategoryProposal | null {
  let score = 0
  const reasons: string[] = []
  for (const r of rule.strong ?? []) {
    const m = norm.match(r)
    if (m) {
      score += 0.65
      reasons.push(`frase clave «${m[0]}»`)
      break
    }
  }
  for (const [subject, action] of rule.context ?? []) {
    const hit = sents.find((s) => subject.test(s) && action.test(s))
    if (hit) {
      score += 0.55
      reasons.push('contexto: sujeto y acción en la misma oración')
      break
    }
  }
  let weakHits = 0
  for (const r of rule.weak ?? []) if (r.test(norm)) weakHits++
  if (weakHits) {
    score += Math.min(0.2 * weakHits, 0.4)
    reasons.push(`${weakHits} palabra(s) relacionada(s)`)
  }
  if (score < 0.3) return null
  return { id: rule.id, confidence: Math.min(Number(score.toFixed(2)), 0.97), reasons }
}

export const CONFIDENCE_ACCEPT = 0.5
export const CONFIDENCE_REVIEW_BELOW = 0.7

/** Nombre sugerido: palabras con mayúscula inicial tras "falleció / fallecimiento de / despedimos a". Solo orientativo. */
export function suggestName(text: string): string | null {
  const m = text.match(
    /(?:falleci[oó]\s+(?:el\s+se[ñn]or\s+|la\s+se[ñn]ora\s+|don\s+|do[ñn]a\s+)?|fallecimiento\s+de(?:l\s+se[ñn]or|\s+la\s+se[ñn]ora|\s+don|\s+do[ñn]a)?\s+|despedimos\s+a\s+(?:don\s+|do[ñn]a\s+)?)((?:[A-ZÁÉÍÓÚÑ][\p{L}'’-]+)(?:\s+(?:de\s+|del\s+|la\s+)?[A-ZÁÉÍÓÚÑ][\p{L}'’-]+){0,4})/u,
  )
  return m ? m[1].trim() : null
}

export class RuleClassifier implements Classifier {
  readonly name = 'rules-v1'

  classify({ title, body }: ClassifierInput): ClassificationResult {
    const full = `${title}\n${body}`
    const norm = normalize(full)
    const sents = sentences(full).map(normalize)

    let categories = RULES.map((r) => scoreRule(r, norm, sents))
      .filter((c): c is CategoryProposal => c !== null && c.confidence >= CONFIDENCE_ACCEPT)
      .sort((a, b) => b.confidence - a.confidence)

    // Un aviso fúnebre no se mezcla con eventos/deportes por palabras sueltas ("despedimos", "club"…).
    const obituaryHit = categories.some((c) => c.id === 'obituarios') && FUNERAL_CONTEXT.test(norm)
    if (obituaryHit) categories = categories.filter((c) => c.id === 'obituarios' || c.confidence >= 0.8)

    // Sin evidencia suficiente: propuesta de baja confianza, siempre a revisión editorial.
    const fallback = categories.length === 0
    if (fallback) {
      const instit = scoreRule(RULES[0], norm, sents)
      categories = [instit ? { ...instit, confidence: Math.min(instit.confidence, 0.45) } : { id: 'otros', confidence: 0.2, reasons: ['sin señales claras'] }]
    }

    const obituary: ObituaryProposal | null = obituaryHit
      ? { nameSuggestion: suggestName(full), reasons: categories.find((c) => c.id === 'obituarios')?.reasons ?? [] }
      : null

    const alert = obituaryHit ? null : this.proposeAlert(norm, categories)
    const lowConfidence = categories.every((c) => c.confidence < CONFIDENCE_REVIEW_BELOW)

    return {
      classifier: this.name,
      categories,
      alert,
      obituary,
      needsReview: lowConfidence || categories.length > 3 || obituary !== null || fallback,
    }
  }

  private proposeAlert(norm: string, categories: CategoryProposal[]): AlertProposal | null {
    if (DRILL.test(norm)) return null
    const resolved = RESOLVED.test(norm)
    // Interrupción de la recolección: aviso de servicio PROPUESTO (nunca urgente por sí solo; una persona lo confirma).
    if (!resolved && categories.some((c) => c.id === 'residuos') && sentences(norm).some((x) => WASTE_SUBJECT.test(x) && WASTE_INTERRUPTION.test(x))) {
      return { kind: 'comunicado', severity: 'info', priority: 1, reason: 'interrupción o cambio del servicio de recolección', suggestedHours: 24 }
    }
    const candidate = categories.find((c) => ALERT_KIND_BY_CATEGORY[c.id] && c.confidence >= 0.55)
    if (!candidate) {
      // Comunicado importante: solo con marcador de urgencia Y categoría institucional fuerte; nunca una palabra aislada.
      const instit = categories.find((c) => c.id === 'institucional' && c.confidence >= 0.65)
      if (instit && URGENCY_MARKER.test(norm) && !resolved) {
        return { kind: 'comunicado', severity: 'info', priority: 1, reason: 'comunicado institucional con marcador de importancia', suggestedHours: DEFAULT_HOURS.comunicado }
      }
      return null
    }
    const kind = ALERT_KIND_BY_CATEGORY[candidate.id]!
    const marker = URGENCY_MARKER.test(norm)
    const severe = SEVERE_LEVEL.test(norm)
    // Urgente = contexto fuerte de la categoría + marcador de urgencia (no basta una palabra aislada) y que no esté resuelto.
    const urgent = !resolved && candidate.confidence >= 0.6 && marker && (severe || candidate.reasons.length >= 1)
    return {
      kind,
      severity: urgent ? 'urgente' : 'info',
      priority: urgent ? (severe ? 3 : 2) : resolved ? 0 : 1,
      reason: urgent
        ? `${candidate.reasons[0]} + marcador de urgencia`
        : resolved
          ? 'aviso de servicio restablecido'
          : candidate.reasons[0],
      suggestedHours: DEFAULT_HOURS[kind],
    }
  }
}

export const defaultClassifier: Classifier = new RuleClassifier()
