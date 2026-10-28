import { Bell, Building2, Bus, CalendarDays, Flower2, House, Info, Landmark, MapPinned, Map, Menu, Newspaper, Radio, Settings, Trash2, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  description: string
  /** Etiqueta corta para la barra inferior. */
  short?: string
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Inicio', icon: House, description: 'Resumen de lo importante' },
  { to: '/colectivos', label: 'Colectivos', icon: Bus, description: 'Horarios desde y hacia Río Seco' },
  { to: '/pueblo', label: 'Nuestro pueblo', short: 'Pueblo', icon: Landmark, description: 'Historia, cultura y tradiciones' },
  { to: '/servicios', label: 'Servicios', icon: MapPinned, description: 'Policía, salud, farmacias y lugares útiles' },
  { to: '/mapa', label: 'Explorá Río Seco', short: 'Mapa', icon: Map, description: 'Mapa con lugares de interés' },
  { to: '/noticias', label: 'Noticias', icon: Newspaper, description: 'Novedades con fuente y fecha' },
  { to: '/alertas', label: 'Alertas', icon: Bell, description: 'Avisos importantes' },
  { to: '/residuos', label: 'Residuos', icon: Trash2, description: 'Recolección y limpieza urbana' },
  { to: '/radios', label: 'Radios', icon: Radio, description: 'Emisoras de la zona' },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays, description: 'Eventos, festividades y actividades' },
  { to: '/obituarios', label: 'Obituarios', icon: Flower2, description: 'Comunicados verificados' },
  { to: '/comuna', label: 'Comuna', icon: Building2, description: 'Información institucional' },
  { to: '/configuracion', label: 'Configuración', icon: Settings, description: 'Notificaciones y preferencias' },
  { to: '/acerca', label: 'Acerca de la app', icon: Info, description: 'Fuentes, privacidad y versión' },
]

export const MORE_ITEM: NavItem = { to: '/mas', label: 'Más', icon: Menu, description: 'Todas las secciones' }

/** Pestañas de la barra inferior en celulares. El resto vive en "Más". */
export const BOTTOM_NAV: NavItem[] = [NAV_ITEMS[0], NAV_ITEMS[1], NAV_ITEMS[2], NAV_ITEMS[3], MORE_ITEM]

export const MORE_SECTIONS: NavItem[] = NAV_ITEMS.filter((n) => !BOTTOM_NAV.includes(n))
