// Genera src/data/json/places.json a partir de los datos documentados (una sola vez; luego se edita el JSON).
// Las coordenadas provienen de OpenStreetMap (consulta manual y puntual el 2026-10-28, ver docs/mapa.md).
// Solo se cargan coordenadas cuando un elemento de OSM identifica el lugar; si no, queda la ubicación pendiente.
import { readFileSync, writeFileSync } from 'node:fs'

const prev = JSON.parse(readFileSync('src/data/json/places.json', 'utf8'))
const D = '2026-10-28'
const osm = (type, id, lat, lng, accuracy = 'edificio', note) => ({
  lat,
  lng,
  accuracy,
  source: { label: `OpenStreetMap · ${type}/${id}`, url: `https://www.openstreetmap.org/${type}/${id}`, date: D },
  ...(note ? { note } : {}),
})
const osmSrc = (type, id) => ({ label: `OpenStreetMap (colaborativo) · ${type}/${id}`, url: `https://www.openstreetmap.org/${type}/${id}`, date: D })
const base = (id) => prev.find((p) => p.id === id)

const out = []
const com = base('comisaria-rio-seco')
out.push({
  ...com,
  location: osm('node', 12863034640, -27.268584, -65.560203),
  dataNote: `${com.dataNote} Ubicación en el mapa según OpenStreetMap (Comisaría Río Seco, Av. Himno Patrio), coherente con la dirección publicada.`,
})
const caps = base('caps-rio-seco')
out.push({
  ...caps,
  location: osm('node', 12863034641, -27.268378, -65.560108),
  sources: [...caps.sources, osmSrc('node', 12863034641)],
  dataNote: `${caps.dataNote} Ubicación en OpenStreetMap (CAPS Río Seco, Av. Himno Patrio): coincide con la dirección aportada, pero es un dato colaborativo y no lo confirma el Ministerio.`,
})
const far = base('farmacia-santa-rita')
out.push({
  ...far,
  pending: ['phone', 'hours', 'location'],
  dataNote: `${far.dataNote} Ubicación en el mapa pendiente: OpenStreetMap no registra esta farmacia y una dirección textual no alcanza para fijar coordenadas exactas.`,
})
const cu = base('comuna-rio-seco')
out.push({
  ...cu,
  address: 'Inmaculada Concepción 230, Río Seco',
  pending: ['phone', 'hours'],
  location: osm('node', 12863034628, -27.268375, -65.557277),
  sources: [...cu.sources, osmSrc('node', 12863034628)],
  dataNote: 'Dirección y ubicación según OpenStreetMap (colaborativo); falta confirmarlas con la Comuna. Teléfono y horarios de atención pendientes.',
})

const P = (id, name, category, o) => out.push({ id, name, category, links: [], sources: [], pending: [], ...o })
const PEND = (extra = []) => [...extra, 'phone', 'hours']
const OSMNOTE = 'Dato colaborativo de OpenStreetMap.'

P('centro-rehabilitacion-perito-moreno', 'Centro de Rehabilitación (Perito Moreno)', 'salud', { address: 'Perito Moreno 468, Río Seco', description: 'En OpenStreetMap figura como centro de salud / rehabilitación.', location: osm('way', 371263503, -27.257617, -65.548858), sources: [osmSrc('way', 371263503)], verifiedAt: D, pending: PEND(), dataNote: 'Dato colaborativo de OpenStreetMap: confirmar nombre, tipo de servicio, teléfono y horarios.' })
P('escuela-quintana', 'Escuela Doctor Manuel Quintana', 'educacion', { address: 'Obispo Colombres 134, Río Seco', location: osm('node', 12862761359, -27.267222, -65.561508), sources: [osmSrc('node', 12862761359)], verifiedAt: D, pending: PEND(), dataNote: 'Nombre y ubicación según OpenStreetMap (colaborativo).' })
P('escuela-secundaria-rio-seco', 'Escuela Secundaria de Río Seco', 'educacion', { address: 'Obispo Colombres 134, Río Seco', location: osm('node', 12863055884, -27.267569, -65.561611), sources: [osmSrc('node', 12863055884)], verifiedAt: D, pending: PEND(), dataNote: 'Nombre y ubicación según OpenStreetMap (colaborativo); comparte domicilio con la Escuela Doctor Manuel Quintana.' })
P('escuela-tecnica-1', 'Escuela Técnica N.º 1 de Río Seco', 'educacion', { address: 'Av. Himno Patrio, Río Seco', location: osm('node', 12862782392, -27.276322, -65.561978), sources: [osmSrc('node', 12862782392)], verifiedAt: D, pending: PEND(), dataNote: 'Nombre y ubicación según OpenStreetMap (colaborativo).' })
P('escuela-magnasco', 'Escuela Osvaldo Magnasco', 'educacion', { address: 'Inmaculada Concepción 341, Río Seco', location: osm('way', 370502388, -27.269456, -65.556242, 'zona'), sources: [osmSrc('way', 370502388)], verifiedAt: D, pending: PEND(), dataNote: 'Nombre y ubicación según OpenStreetMap (colaborativo).' })
P('nivel-inicial-magnasco', 'Escuela de Nivel Inicial Osvaldo Magnasco', 'educacion', { address: 'Inmaculada Concepción 341, Río Seco', location: osm('node', 12863055885, -27.26983, -65.556111), sources: [osmSrc('node', 12863055885)], verifiedAt: D, pending: PEND(), dataNote: 'Nombre y ubicación según OpenStreetMap (colaborativo).' })
P('fundacion-juan-xxiii', 'Fundación Juan XXIII (anexo Río Seco)', 'educacion', { address: 'Av. Himno Patrio, Río Seco', description: 'En OpenStreetMap figura como establecimiento de educación superior.', location: osm('node', 12863055886, -27.276555, -65.561395), sources: [osmSrc('node', 12863055886)], verifiedAt: D, pending: PEND(), dataNote: 'Dato colaborativo de OpenStreetMap; confirmar la oferta educativa.' })
P('cic-rio-seco', 'Centro Integrador Comunitario', 'comunitarios', { description: 'Centro comunitario registrado en OpenStreetMap.', location: osm('node', 8736164232, -27.265955, -65.549177), sources: [osmSrc('node', 8736164232)], verifiedAt: D, pending: PEND(['address']), dataNote: 'Dato colaborativo de OpenStreetMap; faltan dirección, teléfono y horarios.' })
P('plazoleta', 'Plazoleta', 'comunitarios', { description: 'Espacio verde registrado como «Plazoleta» en OpenStreetMap.', location: osm('way', 221872867, -27.269271, -65.554659, 'zona'), sources: [osmSrc('way', 221872867)], verifiedAt: D, pending: ['address', 'description'], dataNote: OSMNOTE })
P('espacio-verde-central', 'Espacio verde central (a confirmar si es la plaza principal)', 'cultural', { description: 'Parque sin nombre en OpenStreetMap, ubicado junto a la Comuna y la parroquia.', location: osm('way', 195121028, -27.267518, -65.55923, 'zona', 'OpenStreetMap no lo nombra: falta confirmar si corresponde a la plaza principal.'), sources: [osmSrc('way', 195121028)], verifiedAt: D, pending: ['address', 'description'], dataNote: 'No se afirma que sea «la plaza»: la ubicación es la del espacio verde mapeado, con el nombre pendiente de confirmación.' })
P('biblioteca-vergara', 'Biblioteca Popular Carlos N. Vergara', 'cultural', { address: 'Inmaculada Concepción, Río Seco', description: 'Registrada en OpenStreetMap como biblioteca pública.', location: osm('node', 12863034615, -27.268064, -65.559234), sources: [osmSrc('node', 12863034615)], verifiedAt: D, pending: PEND(), dataNote: 'Dato colaborativo de OpenStreetMap; confirmar horarios y servicios.' })
P('cartel-entrada', 'Entrada principal «Río Seco»', 'cultural', { description: 'Espacio de la entrada al pueblo con el cartel «Río Seco», registrado en OpenStreetMap.', location: osm('way', 221874035, -27.270017, -65.55321, 'zona'), sources: [osmSrc('way', 221874035)], verifiedAt: D, pending: ['address'], dataNote: OSMNOTE })
P('ingenio', 'El ingenio (ubicación pendiente)', 'cultural', { description: 'Según Cadena 3, el pueblo nació junto a un ingenio. Nombre, estado actual y ubicación exacta pendientes de documentación.', links: [{ label: 'Cadena 3 · Río Seco, la capital del pesebre', url: 'https://www.cadena3.com/noticia/turno-noche/rio-seco-la-capital-del-pesebre-esta-en-tucuman_375912' }], sources: [{ label: 'Cadena 3 (08/12/2023)', url: 'https://www.cadena3.com/noticia/turno-noche/rio-seco-la-capital-del-pesebre-esta-en-tucuman_375912', date: '2023-12-08' }], pending: ['address', 'phone', 'hours', 'location'], dataNote: 'No se coloca en el mapa: OpenStreetMap solo muestra predios industriales sin nombre y no hay confirmación de cuál corresponde al ingenio.' })
P('parroquia-inmaculada-concepcion', 'Parroquia Inmaculada Concepción', 'iglesias', { description: 'Templo registrado en OpenStreetMap (nombre en el mapa: «Parroquía Inmaculada Concepción»).', location: osm('node', 12862761360, -27.26679, -65.562285), sources: [osmSrc('node', 12862761360)], verifiedAt: D, pending: PEND(['address']), dataNote: 'Dato colaborativo de OpenStreetMap; confirmar horarios de misas con la parroquia.' })
P('capilla-virgen-del-valle', 'Virgen del Valle', 'iglesias', { description: 'Lugar de culto registrado en OpenStreetMap.', location: osm('node', 3840916459, -27.258813, -65.547762), sources: [osmSrc('node', 3840916459)], verifiedAt: D, pending: PEND(['address']), dataNote: OSMNOTE })
P('virgen-del-rosario-de-nicolas', 'Virgen del Rosario de Nicolás', 'iglesias', { description: 'Lugar de culto registrado en OpenStreetMap.', location: osm('node', 3840916457, -27.255204, -65.547429), sources: [osmSrc('node', 3840916457)], verifiedAt: D, pending: PEND(['address']), dataNote: OSMNOTE })
P('club-san-ramon', 'Club San Ramón', 'clubes', { address: 'Av. Libertador, Río Seco', description: 'Centro deportivo registrado en OpenStreetMap.', location: osm('way', 220593533, -27.255772, -65.545305, 'zona'), sources: [osmSrc('way', 220593533)], verifiedAt: D, pending: PEND(), dataNote: OSMNOTE })
P('la-providencia', 'La Providencia (club)', 'clubes', { description: 'Centro deportivo con cancha y pileta, registrado en OpenStreetMap.', location: osm('way', 1389613940, -27.271767, -65.558157, 'zona'), sources: [osmSrc('way', 1389613940)], verifiedAt: D, pending: PEND(['address']), dataNote: 'Dato colaborativo de OpenStreetMap; confirmar nombre completo e institución.' })

writeFileSync('src/data/json/places.json', `${JSON.stringify(out, null, 2)}\n`)
console.log(out.length, 'lugares;', out.filter((p) => p.location).length, 'con ubicación verificada;', out.filter((p) => !p.location).length, 'sin ubicación')
