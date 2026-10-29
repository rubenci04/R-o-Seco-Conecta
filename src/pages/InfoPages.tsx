import { PhotoGallery } from '@/components/community/PhotoGallery'
import { Building2, Camera, Info, Users } from 'lucide-react'
import { Link } from 'react-router'
import { ExternalLink } from '@/components/shared/ExternalLink'
import { PageHeader, Section } from '@/components/shared/PageHeader'
import { Card, CardTitle } from '@/components/ui/card'
import { APP } from '@/config/app'
import { LINKS } from '@/config/links'
import { MORE_SECTIONS } from '@/config/nav'

export function ComunaPage() {
  return (
    <>
      <PageHeader icon={Building2} title="Comuna de Río Seco" subtitle="Información institucional y canales de comunicación." />
      <Card className="mb-5 text-sm">
        <p>
          La Comuna de Río Seco (Tucumán) publica sus novedades en redes sociales. Esta aplicación no tiene acceso a esas cuentas ni
          reproduce su contenido automáticamente: te llevamos a los canales originales.
        </p>
      </Card>
      <Section title="Fotos">
        <PhotoGallery ids={['desfile5', 'guardia-urbana']} columns="sm:grid-cols-2" />
      </Section>
      <Section title="Canales oficiales">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="space-y-2">
            <CardTitle className="flex items-center gap-2"><Users className="size-5 text-accent" aria-hidden />Facebook</CardTitle>
            <ExternalLink href={LINKS.comuna.facebook} className="font-semibold text-accent underline underline-offset-2">Abrir página de la Comuna</ExternalLink>
          </Card>
          <Card className="space-y-2">
            <CardTitle className="flex items-center gap-2"><Camera className="size-5 text-accent" aria-hidden />Instagram</CardTitle>
            <ExternalLink href={LINKS.comuna.instagram} className="font-semibold text-accent underline underline-offset-2">Abrir @comunaderioseco</ExternalLink>
          </Card>
        </div>
      </Section>
      <p className="text-xs text-muted-foreground">{APP.disclaimer}</p>
    </>
  )
}

export function MorePage() {
  return (
    <>
      <PageHeader icon={Info} title="Más secciones" />
      <ul className="grid gap-3 sm:grid-cols-2">
        {MORE_SECTIONS.map(({ to, label, icon: Icon, description }) => (
          <li key={to}>
            <Link to={to} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-sm transition hover:bg-muted active:scale-[0.99]">
              <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent"><Icon className="size-5" aria-hidden /></span>
              <span>
                <span className="block font-display font-bold">{label}</span>
                <span className="block text-sm text-muted-foreground">{description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

export function AboutPage() {
  return (
    <>
      <PageHeader icon={Info} title="Acerca de la aplicación" subtitle={`${APP.name} · versión ${APP.version}`} />
      <div className="space-y-4">
        <Card className="space-y-2 text-sm">
          <CardTitle>Independiente y no oficial</CardTitle>
          <p>{APP.disclaimer}</p>
        </Card>
        <Card className="space-y-2 text-sm">
          <CardTitle>Fuentes</CardTitle>
          <ul className="list-inside list-disc space-y-1">
            <li><ExternalLink href={LINKS.comuna.facebook} className="text-accent underline">Comuna de Río Seco en Facebook</ExternalLink></li>
            <li><ExternalLink href={LINKS.comuna.instagram} className="text-accent underline">Comuna de Río Seco en Instagram</ExternalLink></li>
            <li><ExternalLink href={LINKS.radios.activa} className="text-accent underline">Radio Activa 103.1</ExternalLink></li>
            <li><ExternalLink href={LINKS.radios.sudamericana} className="text-accent underline">Radio Sudamericana 89.3</ExternalLink></li>
            <li><ExternalLink href={LINKS.transport.reference} className="text-accent underline">Colectivos Tucumán (referencia de horarios)</ExternalLink></li>
          </ul>
        </Card>
        <Card className="space-y-2 text-sm">
          <CardTitle>Responsabilidad editorial</CardTitle>
          <p>
            Cada contenido indica su fuente y fecha. No publicamos noticias, alertas, eventos ni obituarios que no puedan verificarse. Los
            horarios de colectivos solo se incorporan con fuente y autorización de reutilización; hasta entonces se informa el estado y se
            enlaza la fuente original. Los horarios pueden cambiar: confirmá con la empresa.
          </p>
        </Card>
        <Card className="space-y-2 text-sm">
          <CardTitle>Privacidad</CardTitle>
          <p>
            No hay cuentas, rastreadores ni publicidad. Tus rutas favoritas y la preferencia de tema (claro/oscuro) se guardan solo en tu
            dispositivo. Los enlaces externos abren sitios de terceros con sus propias políticas. En el mapa, tu ubicación se pide solo si tocás «Mi ubicación»
            y no se guarda ni se envía a ningún servidor; el mapa base se pide a OpenStreetMap, que puede ver tu dirección IP como cualquier sitio web.
          </p>
        </Card>
        <Card className="space-y-2 text-sm">
          <CardTitle>Versión de la aplicación</CardTitle>
          <p>
            Versión instalada: <strong data-testid="build-commit">{__BUILD_COMMIT__}</strong> (compilada el {new Date(__BUILD_TIME__).toLocaleDateString('es-AR')}). Si tras una actualización ves algo
            distinto de lo esperado, cerrá y volvé a abrir la aplicación.
          </p>
          <p>
            <a href="/admin" className="text-accent underline">Administración</a> (acceso solo para el equipo editorial; requiere iniciar sesión).
          </p>
        </Card>
        <Card className="space-y-2 text-sm">
          <CardTitle>Créditos del mapa</CardTitle>
          <p>
            Mapa y datos de ubicación: © colaboradores de{' '}
            <ExternalLink href="https://www.openstreetmap.org/copyright" className="text-accent underline">
              OpenStreetMap
            </ExternalLink>{' '}
            (licencia ODbL), con las condiciones de uso de sus servidores de teselas. Biblioteca cartográfica:{' '}
            <ExternalLink href="https://leafletjs.com/" className="text-accent underline">
              Leaflet
            </ExternalLink>
            . Los datos colaborativos pueden tener errores: cada ficha indica su fuente y su estado de verificación.
          </p>
        </Card>
      </div>
    </>
  )
}
