import { renderToStaticMarkup } from 'react-dom/server'
import L from 'leaflet'
import { Bus, BookOpen, Church, GraduationCap, HeartPulse, Landmark, Pill, Shield, Trophy } from 'lucide-react'
import { MARKER_TONES, type MapLayer } from '@/features/map/layers'

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

const GLYPHS = { shield: Shield, heart: HeartPulse, pill: Pill, landmark: Landmark, school: GraduationCap, book: BookOpen, church: Church, trophy: Trophy, bus: Bus }

/**
 * Marcador circular con glifo blanco sobre fondo de la paleta, anillo blanco y sombra oscura:
 * se distingue sobre cualquier fondo cartográfico y por forma (glifo), no solo por color.
 */
export function markerIcon(layer: MapLayer, label: string, selected = false): L.DivIcon {
  const Glyph = GLYPHS[layer.icon]
  const svg = renderToStaticMarkup(<Glyph size={selected ? 22 : 17} strokeWidth={2.4} color="#fff" aria-hidden="true" />)
  const size = selected ? 42 : 34
  return L.divIcon({
    className: 'rs-marker-wrap',
    html: `<span class="rs-marker${selected ? ' rs-marker--selected' : ''}" style="background:${MARKER_TONES[layer.tone]}">${svg}<span class="rs-sr">${escapeHtml(label)}</span></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}
