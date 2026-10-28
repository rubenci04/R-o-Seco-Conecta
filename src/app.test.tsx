import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { DataProvider } from '@/data/repository/DataContext'
import { LocalJsonRepository } from '@/data/repository/localJsonRepository'
import type { DataRepository } from '@/data/repository/types'
import { LINKS } from '@/config/links'
import { makeService, TEST_HOLIDAYS } from '@/test/fixtures'
import { AppRoutes } from './routes'

function renderApp(path = '/', repo?: DataRepository) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DataProvider repository={repo}>
        <AppRoutes />
      </DataProvider>
    </MemoryRouter>,
  )
}

/** Repositorio con datos SINTÉTICOS solo para probar la interfaz. */
function syntheticRepo(): DataRepository {
  const base = new LocalJsonRepository()
  return {
    ...base,
    getHolidays: async () => TEST_HOLIDAYS,
    getTransport: async () => ({
      companies: [{ id: 'empresa-prueba', name: 'Empresa de prueba' }],
      localities: [{ id: 'concepcion', name: 'Concepción', status: 'verificado' }],
      stops: [
        { id: 'parada-a', name: 'Parada A', localityId: 'rio-seco' },
        { id: 'parada-b', name: 'Parada B', localityId: 'concepcion' },
      ],
      services: [makeService({ id: 'x1', departure: '06:00', dayTypes: ['weekday', 'saturday', 'sunday', 'holiday'] })],
    }),
  }
}

describe('navegación entre pantallas', () => {
  it('muestra la pantalla de inicio con accesos rápidos', async () => {
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1, name: /Río Seco/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Accesos rápidos' })).toBeInTheDocument()
  })

  it.each([
    ['/colectivos', 'Colectivos'],
    ['/pueblo', 'Nuestro pueblo'],
    ['/pueblo/tradicion-pesebres', 'Río Seco y la tradición de los pesebres'],
    ['/servicios', 'Servicios y lugares útiles'],
    ['/noticias', 'Noticias'],
    ['/alertas', 'Alertas'],
    ['/radios', 'Radios'],
    ['/agenda', 'Agenda'],
    ['/obituarios', 'Obituarios'],
    ['/comuna', 'Comuna de Río Seco'],
    ['/acerca', 'Acerca de la aplicación'],
    ['/mas', 'Más secciones'],
  ])('renderiza %s', async (path, title) => {
    renderApp(path)
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
  })

  it('navega desde la barra inferior', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await screen.findByRole('heading', { level: 1, name: /Río Seco/ })
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    await user.click(within(nav).getByRole('link', { name: 'Nuestro pueblo' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Nuestro pueblo' })).toBeInTheDocument()
    await user.click(within(nav).getByRole('link', { name: 'Servicios' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Servicios y lugares útiles' })).toBeInTheDocument()
    await user.click(within(nav).getByRole('link', { name: 'Más' }))
    await user.click(within(await screen.findByRole('main')).getByRole('link', { name: /Radios/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Radios' })).toBeInTheDocument()
  })

  it('muestra 404 en rutas desconocidas', async () => {
    renderApp('/no-existe')
    expect(await screen.findByText('Página no encontrada')).toBeInTheDocument()
  })
})

describe('estados vacíos: sin contenido inventado', () => {
  it.each([
    ['/noticias', 'Todavía no hay noticias publicadas'],
    ['/alertas', 'No hay alertas vigentes'],
    ['/agenda', 'No hay eventos cargados'],
    ['/obituarios', 'No hay comunicados'],
  ])('%s', async (path, text) => {
    renderApp(path)
    expect(await screen.findByText(text)).toBeInTheDocument()
  })
})

describe('radios y enlaces externos', () => {
  it('abre los sitios reales de cada radio de forma segura', async () => {
    renderApp('/radios')
    const activa = await screen.findByRole('link', { name: /Escuchar Radio Activa 103.1/ })
    const sud = screen.getByRole('link', { name: /Escuchar Radio Sudamericana 89.3/ })
    expect(activa).toHaveAttribute('href', LINKS.radios.activa)
    expect(sud).toHaveAttribute('href', LINKS.radios.sudamericana)
    for (const a of [activa, sud]) {
      expect(a).toHaveAttribute('target', '_blank')
      expect(a.getAttribute('rel')).toContain('noopener')
    }
    expect(document.querySelector('audio')).toBeNull()
  })

  it('la página de la Comuna enlaza Facebook e Instagram', async () => {
    renderApp('/comuna')
    expect(await screen.findByRole('link', { name: /Abrir página de la Comuna/ })).toHaveAttribute('href', LINKS.comuna.facebook)
    expect(screen.getByRole('link', { name: /Abrir @comunaderioseco/ })).toHaveAttribute('href', LINKS.comuna.instagram)
  })

  it('todos los enlaces externos usan rel noopener noreferrer', async () => {
    renderApp('/acerca')
    await screen.findByRole('heading', { level: 1, name: /Acerca/ })
    const external = [...document.querySelectorAll('a[href^="http"]')]
    expect(external.length).toBeGreaterThan(4)
    for (const a of external) expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })
})

describe('colectivos', () => {
  it('con horarios reales: Río Seco → Concepción muestra resultados, no un estado vacío', async () => {
    renderApp('/colectivos')
    expect(await screen.findByRole('heading', { name: 'Resultados' })).toBeInTheDocument()
    expect(screen.queryByText(/Sin servicio directo/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/\d{2}:\d{2}/).length).toBeGreaterThan(0)
  })

  it('un tramo sin viajes directos informa la situación y enlaza la fuente, sin inventar combinaciones', async () => {
    renderApp('/colectivos?localidad=fronterita')
    expect(await screen.findByText(/Sin servicio directo entre Río Seco y Fronterita/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver horarios en Colectivos Tucumán/ })).toHaveAttribute('href', expect.stringContaining('colectivostucuman.com.ar'))
  })

  it('el botón invertir cambia origen y destino', async () => {
    const user = userEvent.setup()
    renderApp('/colectivos')
    await screen.findByRole('heading', { name: 'Resultados' })
    const desde = () => screen.getByText('Desde').nextElementSibling?.textContent
    expect(desde()).toBe('Río Seco')
    await user.click(screen.getByRole('button', { name: 'Invertir origen y destino' }))
    expect(desde()).toBe('Concepción')
  })

  it('con datos sintéticos lista todos los horarios y guarda favoritos', async () => {
    const user = userEvent.setup()
    renderApp('/colectivos?modo=all', syntheticRepo())
    expect(await screen.findByText('06:00')).toBeInTheDocument()
    expect(screen.getByText('Confirmado')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Guardar ruta/ }))
    expect(JSON.parse(localStorage.getItem('rsc-favoritos')!)).toHaveLength(1)
    expect(screen.getByRole('link', { name: /Río Seco → Concepción/ })).toBeInTheDocument()
  })

  it('con datos pero sin coincidencias muestra ausencia de resultados', async () => {
    renderApp('/colectivos?modo=arrive-by&hora=00:01', syntheticRepo())
    expect(await screen.findByText('No encontramos colectivos para esta búsqueda')).toBeInTheDocument()
  })
})
