/**
 * Extracción de los datos que Colectivos Tucumán embebe en el HTML público de cada página de horarios
 * (propiedades del componente de búsqueda, serializadas en el payload de Next.js) y de los totales que
 * la propia página declara en texto (resumen y preguntas frecuentes) para poder verificar las cantidades.
 * No se utiliza ninguna API privada, sesión ni zona protegida (robots.txt solo veda /admincompany/ y /login/).
 */

export interface RawStop {
  id: string
  city: string
  commentary?: string
  isEstimated?: boolean
}
export interface RawStopTime {
  routeStopId: string
  arrivalTime: string
  isEstimated?: boolean
}
export interface RawTrip {
  id: string
  dayType: 'weekday' | 'saturday' | 'sunday'
  tags: string[]
  price?: string
  stopTimes: RawStopTime[]
}
export interface RawRoute {
  id: string
  profileId: string
  name: string
  isActive: boolean
  stops: RawStop[]
  trips: RawTrip[]
  alerts: unknown[]
  disabledSegments: unknown[]
}
export interface RawCompany {
  id: string
  name: string
  [k: string]: unknown
}

export interface PageProps {
  routes: RawRoute[]
  companies: RawCompany[]
  prices?: unknown
  initialOrigin?: string
  initialDestination?: string
}

export interface PageSummary {
  /** Totales que declara el texto de la página ("46 salidas"). */
  declared: { weekday: number | null; saturday: number | null; sunday: number | null }
  /** Horarios que enumera la sección de preguntas frecuentes (JSON-LD FAQPage). */
  faq: { weekday: string[]; saturday: string[]; sunday: string[] }
  /** Cantidad de tarjetas de viaje renderizadas en el HTML. */
  renderedCards: number
}

export interface PageSnapshot {
  url: string
  origin: string
  destination: string
  fetchedAt: string
  props: PageProps
  summary: PageSummary
}

/** Decodifica los fragmentos `self.__next_f.push([1,"…"])` y los concatena. */
export function readFlightPayload(html: string): string {
  const out: string[] = []
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/gs)) out.push(JSON.parse(`"${m[1]}"`))
  return out.join('')
}

/** Extrae el objeto JSON balanceado que contiene la clave `"routes":[`. */
export function extractProps(html: string): PageProps {
  const payload = readFlightPayload(html)
  const key = payload.indexOf('"routes":[')
  if (key < 0) throw new Error('No se encontró la lista de rutas en la página')
  const start = payload.lastIndexOf('{', key)
  let depth = 0
  for (let i = start; i < payload.length; i++) {
    const c = payload[i]
    if (c === '"') {
      i++
      while (payload[i] !== '"') {
        if (payload[i] === '\\') i++
        i++
      }
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return JSON.parse(payload.slice(start, i + 1)) as PageProps
  }
  throw new Error('JSON de rutas incompleto')
}

const toList = (text: string): string[] => text.match(/\b\d{2}:\d{2}\b/g) ?? []

export function extractSummary(html: string): PageSummary {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
  const count = (label: RegExp) => {
    const m = text.match(label)
    return m ? Number(m[1]) : null
  }
  const declared = {
    weekday: count(/De lunes a viernes\s*:\s*(\d+)\s*salidas?/i),
    saturday: count(/Los sábados\s*:\s*(\d+)\s*salidas?/i),
    sunday: count(/Los domingos y feriados\s*:\s*(\d+)\s*salidas?/i),
  }
  const faqs: { name: string; text: string }[] = []
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)) {
    try {
      const data = JSON.parse(m[1])
      for (const node of Array.isArray(data) ? data : [data]) {
        if (node?.['@type'] === 'FAQPage') for (const q of node.mainEntity ?? []) faqs.push({ name: q.name, text: q.acceptedAnswer?.text ?? '' })
      }
    } catch {
      /* JSON-LD ajeno: se ignora */
    }
  }
  // El FAQPage también viaja en el payload; si el HTML no lo trae como <script>, se lee de allí.
  if (!faqs.length) {
    const payload = readFlightPayload(html)
    for (const m of payload.matchAll(/"name":"([^"]*)","acceptedAnswer":\{"@type":"Answer","text":"([^"]*)"\}/g)) faqs.push({ name: m[1], text: m[2] })
  }
  const pick = (re: RegExp) => toList(faqs.find((f) => re.test(f.name))?.text ?? '')
  return {
    declared,
    faq: { weekday: pick(/Lunes a Viernes/i), saturday: pick(/S[áa]bados/i), sunday: pick(/Domingos/i) },
    renderedCards: (html.match(/<article/g) ?? []).length,
  }
}

export function snapshotFromHtml(html: string, url: string, origin: string, destination: string, fetchedAt: string): PageSnapshot {
  return { url, origin, destination, fetchedAt, props: extractProps(html), summary: extractSummary(html) }
}

/** Pares `/horarios/{origen}/{destino}` del sitemap que tienen a Río Seco como extremo. */
export function routePagesFromSitemap(xml: string, hub = 'rio-seco'): { origin: string; destination: string; url: string }[] {
  const out: { origin: string; destination: string; url: string }[] = []
  for (const m of xml.matchAll(/<loc>(https:\/\/colectivostucuman\.com\.ar\/horarios\/([a-z0-9-]+)\/([a-z0-9-]+))<\/loc>/g)) {
    const [, url, origin, destination] = m
    if (origin === hub || destination === hub) out.push({ origin, destination, url })
  }
  return out
}
