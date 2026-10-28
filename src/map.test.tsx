import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import PlacesMap, { TILE_ERROR_LIMIT } from '@/components/map/PlacesMap'
import { DataProvider } from '@/data/repository/DataContext'
import { LocalJsonRepository } from '@/data/repository/localJsonRepository'
import { mappedPlaces } from '@/features/map/layers'
import { AppRoutes } from './routes'

// jsdom no calcula tamaños: se simula un contenedor de 800×600 para que Leaflet cree teselas y marcadores.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const repo = new LocalJsonRepository()

function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.pathname + l.search}</output>
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DataProvider>
        <AppRoutes />
        <Where />
      </DataProvider>
    </MemoryRouter>,
  )
}

async function renderMap(selectedId: string | null = null, onSelect = vi.fn()) {
  const places = mappedPlaces(await repo.getPlaces())
  const utils = render(
    <MemoryRouter>
      <PlacesMap places={places} selectedId={selectedId} onSelect={onSelect} />
    </MemoryRouter>,
  )
  return { ...utils, places, onSelect }
}

const geo = (impl: (ok: PositionCallback, err: PositionErrorCallback) => void) => {
  const getCurrentPosition = vi.fn(impl)
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition }, onLine: true })
  return getCurrentPosition
}

describe('componente del mapa (Leaflet)', () => {
  it('muestra un marcador accesible por lugar con ubicación verificada, y ninguno para los pendientes', async () => {
    const { places } = await renderMap()
    const markers = document.querySelectorAll('.leaflet-marker-icon')
    expect(markers).toHaveLength(places.length)
    expect(places.length).toBe(20)
    const comisaria = screen.getByRole('button', { name: /Comisaría de Río Seco, Policía/ })
    expect(comisaria).toHaveAttribute('tabindex', '0') // enfocable con teclado
    expect(screen.queryByRole('button', { name: /Farmacia Santa Rita/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /El ingenio/ })).toBeNull()
  })
  it('muestra la atribución a OpenStreetMap con enlaces seguros y sin el prefijo de Leaflet', async () => {
    await renderMap()
    const attribution = document.querySelector('.leaflet-control-attribution') as HTMLElement
    expect(attribution.textContent).toContain('OpenStreetMap')
    for (const a of attribution.querySelectorAll('a')) {
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
      expect(a.getAttribute('target')).toBe('_blank')
    }
    expect(attribution.textContent).not.toContain('Leaflet')
  })
  it('el mapa se mantiene dentro de los límites del pueblo y con zoom acotado (uso prudente de teselas)', async () => {
    await renderMap()
    const tiles = document.querySelectorAll('img.leaflet-tile')
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles.length).toBeLessThan(60) // una vista, no una descarga masiva
    for (const t of tiles) expect((t as HTMLImageElement).src).toMatch(/^https:\/\/tile\.openstreetmap\.org\/1[3-8]\//)
  })
  it('abrir un marcador muestra el globo con ficha, llamada y cómo llegar', async () => {
    const onSelect = vi.fn()
    await renderMap(null, onSelect)
    fireEvent.click(screen.getByRole('button', { name: /Comisaría de Río Seco/ }))
    expect(onSelect).toHaveBeenCalledWith('comisaria-rio-seco')
    const popup = await waitFor(() => {
      const el = document.querySelector('.leaflet-popup') as HTMLElement
      expect(el).toBeTruthy()
      return el
    })
    expect(within(popup).getByRole('link', { name: 'Ver ficha' })).toHaveAttribute('href', '/servicios/comisaria-rio-seco')
    expect(within(popup).getByRole('link', { name: /Llamar al 03863-471081/ })).toHaveAttribute('href', 'tel:03863471081')
    const how = within(popup).getByRole('link', { name: /Cómo llegar/ })
    expect(how.getAttribute('href')).toContain('https://www.google.com/maps/dir/')
    expect(how).toHaveAttribute('rel', 'noopener noreferrer')
    expect(how).toHaveAttribute('target', '_blank')
  })
  it('el lugar seleccionado se centra y abre su globo (viene de la URL o de la lista)', async () => {
    await renderMap('farmacia-inexistente')
    expect(document.querySelector('.leaflet-popup')).toBeNull()
    document.body.innerHTML = ''
    await renderMap('caps-rio-seco')
    await waitFor(() => expect(document.querySelector('.leaflet-popup')?.textContent).toContain('CAPS Río Seco'))
  })
})

describe('ubicación del usuario (opcional)', () => {
  it('NO pide la ubicación al cargar: solo cuando el usuario toca el botón', async () => {
    const spy = geo(() => {})
    await renderMap()
    expect(spy).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: /Mi ubicación/ }))
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('con permiso: muestra el punto y aclara que no se guarda', async () => {
    geo((ok) => ok({ coords: { latitude: -27.2687, longitude: -65.5585, accuracy: 25 } } as GeolocationPosition))
    await renderMap()
    await userEvent.setup().click(screen.getByRole('button', { name: /Mi ubicación/ }))
    expect(await screen.findByText(/solo se usa en tu dispositivo y no se guarda/i)).toBeInTheDocument()
    expect(document.querySelector('path.rs-me')).toBeTruthy()
  })
  it('si el permiso se rechaza, informa sin bloquear el mapa', async () => {
    geo((_ok, err) => err({ code: 1, message: 'denied' } as GeolocationPositionError))
    await renderMap()
    await userEvent.setup().click(screen.getByRole('button', { name: /Mi ubicación/ }))
    expect(await screen.findByText(/permiso fue rechazado/)).toBeInTheDocument()
    expect(document.querySelectorAll('.leaflet-marker-icon').length).toBeGreaterThan(10)
  })
  it('si la ubicación no está disponible o no hay soporte, lo informa', async () => {
    geo((_ok, err) => err({ code: 2, message: 'unavailable' } as GeolocationPositionError))
    await renderMap()
    await userEvent.setup().click(screen.getByRole('button', { name: /Mi ubicación/ }))
    expect(await screen.findByText(/No pudimos obtener tu ubicación/)).toBeInTheDocument()
    document.body.innerHTML = ''
    vi.stubGlobal('navigator', { onLine: true })
    await renderMap()
    await userEvent.setup().click(screen.getByRole('button', { name: /Mi ubicación/ }))
    expect(await screen.findByText(/no permite obtener la ubicación/)).toBeInTheDocument()
  })
})

describe('errores del proveedor de mapas', () => {
  it('si las teselas fallan sin cargar ninguna, avisa y recuerda que las fichas siguen disponibles', async () => {
    await renderMap()
    expect(screen.queryByRole('alert')).toBeNull()
    const tiles = [...document.querySelectorAll('img.leaflet-tile')]
    expect(tiles.length).toBeGreaterThanOrEqual(TILE_ERROR_LIMIT)
    act(() => {
      for (const t of tiles) fireEvent.error(t)
    })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/No se pudo cargar el mapa base de OpenStreetMap/)
    expect(alert.textContent).toMatch(/fichas sigue disponible/)
    expect(document.querySelectorAll('.leaflet-marker-icon').length).toBeGreaterThan(10) // los marcadores siguen
  })
  it('sin conexión muestra el aviso correspondiente y lo retira al volver', async () => {
    await renderMap()
    act(() => void window.dispatchEvent(new Event('offline')))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Sin conexión/)
    act(() => void window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

describe('pantalla «Explorá Río Seco»', () => {
  it('muestra filtros por categoría, mapa, lista de lugares y los lugares con ubicación pendiente', async () => {
    renderApp('/mapa')
    expect(await screen.findByRole('heading', { level: 1, name: 'Explorá Río Seco' })).toBeInTheDocument()
    const nav = await screen.findByRole('navigation', { name: 'Capas del mapa' })
    for (const l of ['Seguridad', 'Salud', 'Farmacias', 'Administración pública', 'Educación', 'Cultura', 'Religión', 'Deporte', 'Transporte']) {
      expect(within(nav).getByRole('button', { name: new RegExp(l) })).toBeInTheDocument()
    }
    expect(await screen.findByRole('heading', { name: /Lugares en el mapa \(20\)/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Ubicación pendiente \(2\)/ })).toBeInTheDocument()
    const pending = screen.getByRole('region', { name: 'Lugares sin ubicación confirmada' })
    expect(within(pending).getByText('Farmacia Santa Rita')).toBeInTheDocument()
    expect(within(pending).getByText(/El ingenio/)).toBeInTheDocument()
    expect(within(pending).queryByRole('button', { name: /Ver .* en el mapa|Mostrar/ })).toBeNull() // no se puede «mostrar» lo que no tiene ubicación
    expect(screen.getByRole('link', { name: /Ir a la lista de lugares/ })).toHaveAttribute('href', '#lista-de-lugares')
  })
  it('el filtro por categoría se aplica y se comparte por URL', async () => {
    const user = userEvent.setup()
    renderApp('/mapa')
    await screen.findByRole('heading', { name: /Lugares en el mapa \(20\)/ })
    await user.click(screen.getByRole('button', { name: /^Salud/ }))
    expect(screen.getByTestId('where').textContent).toBe('/mapa?capas=salud')
    expect(await screen.findByRole('heading', { name: /Lugares en el mapa \(2\)/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Farmacias/ }))
    expect(screen.getByTestId('where').textContent).toBe('/mapa?capas=salud%2Cfarmacias')
    expect(screen.getByRole('button', { name: /^Salud/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Todas' }))
    expect(screen.getByTestId('where').textContent).toBe('/mapa')
  })
  it('una URL compartida con capas restaura el filtro; las capas inválidas se ignoran', async () => {
    renderApp('/mapa?capas=educacion,inventada')
    expect(await screen.findByRole('heading', { name: /Lugares en el mapa \(6\)/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Educación/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Comisaría de Río Seco')).toBeNull()
  })
  it('una capa sin lugares verificados (Transporte) muestra un estado vacío, sin inventar paradas', async () => {
    renderApp('/mapa?capas=transporte')
    expect(await screen.findByText('Sin lugares con ubicación verificada en esta selección')).toBeInTheDocument()
    expect(document.querySelectorAll('.leaflet-marker-icon')).toHaveLength(0)
  })
  it('abre centrado en el lugar indicado en la URL y muestra su panel con ficha', async () => {
    renderApp('/mapa?lugar=comuna-rio-seco')
    const panel = await screen.findByRole('region', { name: 'Lugar seleccionado' })
    expect(within(panel).getByText('Comuna de Río Seco')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Ver ficha' })).toHaveAttribute('href', '/servicios/comuna-rio-seco')
    await waitFor(() => expect(document.querySelector('.leaflet-popup')?.textContent).toContain('Comuna de Río Seco'))
  })
  it('un lugar sin ubicación en la URL no se coloca en el mapa', async () => {
    renderApp('/mapa?lugar=farmacia-santa-rita')
    await screen.findByRole('heading', { name: /Lugares en el mapa/ })
    expect(screen.queryByRole('region', { name: 'Lugar seleccionado' })).toBeNull()
    expect(document.querySelector('.leaflet-popup')).toBeNull()
  })
  it('desde la lista, «Ver en el mapa» selecciona el lugar en la URL', async () => {
    const user = userEvent.setup()
    Element.prototype.scrollIntoView = vi.fn()
    renderApp('/mapa')
    await screen.findByRole('heading', { name: /Lugares en el mapa/ })
    await user.click(screen.getByRole('button', { name: 'Mostrar Club San Ramón en el mapa' }))
    expect(screen.getByTestId('where').textContent).toBe('/mapa?lugar=club-san-ramon')
  })
  it('los enlaces externos de la pantalla abren en pestaña nueva de forma segura', async () => {
    renderApp('/mapa')
    await screen.findByRole('heading', { name: /Lugares en el mapa/ })
    const external = [...document.querySelectorAll('main a[href^="http"]')]
    expect(external.length).toBeGreaterThan(5)
    for (const a of external) {
      expect(a.getAttribute('rel'), a.getAttribute('href') ?? '').toBe('noopener noreferrer')
      expect(a.getAttribute('target')).toBe('_blank')
    }
    expect(external.some((a) => a.getAttribute('href')?.startsWith('https://operations.osmfoundation.org'))).toBe(true)
  })
})

describe('navegación desde Servicios y ficha', () => {
  it('Servicios ofrece «Ver en el mapa» solo para lugares con ubicación y «Ubicación pendiente» para el resto', async () => {
    renderApp('/servicios')
    await screen.findByText('Comisaría de Río Seco')
    expect(screen.getByRole('link', { name: 'Ver Comisaría de Río Seco en el mapa de Río Seco' })).toHaveAttribute('href', '/mapa?lugar=comisaria-rio-seco')
    expect(screen.queryByRole('link', { name: /Ver Farmacia Santa Rita en el mapa/ })).toBeNull()
    expect(screen.getAllByText('Ubicación pendiente').length).toBe(2)
  })
  it('la categoría activa en Servicios se lleva al mapa como capa', async () => {
    const user = userEvent.setup()
    renderApp('/servicios')
    await screen.findByText('Comisaría de Río Seco')
    expect(screen.getByRole('link', { name: /Explorá Río Seco en el mapa/ })).toHaveAttribute('href', '/mapa')
    await user.click(screen.getByRole('button', { name: 'Farmacias' }))
    expect(screen.getByRole('link', { name: /Ver «Farmacias» en el mapa/ })).toHaveAttribute('href', '/mapa?capas=farmacias')
  })
  it('navegar desde Servicios al mapa centra el lugar elegido', async () => {
    const user = userEvent.setup()
    renderApp('/servicios')
    await screen.findByText('Comisaría de Río Seco')
    await user.click(screen.getByRole('link', { name: 'Ver Comisaría de Río Seco en el mapa de Río Seco' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Explorá Río Seco' })).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).toBe('/mapa?lugar=comisaria-rio-seco')
    expect(await screen.findByRole('region', { name: 'Lugar seleccionado' })).toBeInTheDocument()
  })
  it('desde un marcador se abre la ficha completa del lugar', async () => {
    const user = userEvent.setup()
    renderApp('/mapa?lugar=caps-rio-seco')
    const popup = await waitFor(() => {
      const el = document.querySelector('.leaflet-popup') as HTMLElement
      expect(el).toBeTruthy()
      return el
    })
    await user.click(within(popup).getByRole('link', { name: 'Ver ficha' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Ficha del lugar' })).toBeInTheDocument()
    expect(screen.getByText('CAPS Río Seco')).toBeInTheDocument()
    expect(screen.getByText(/Fuente: OpenStreetMap · node\/12863034641/)).toBeInTheDocument()
    expect(screen.getByText(/consultada el/)).toBeInTheDocument()
  })
  it('la ficha muestra dirección, teléfono, fuente, verificación y los botones de acción', async () => {
    renderApp('/servicios/comisaria-rio-seco')
    expect(await screen.findByRole('heading', { level: 3, name: 'Comisaría de Río Seco' })).toBeInTheDocument()
    expect(screen.getByText('Av. Himno Patrio s/n, Río Seco')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Llamar a Comisaría de Río Seco' })).toHaveAttribute('href', 'tel:03863471081')
    expect(screen.getByRole('link', { name: /Cómo llegar a Comisaría/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Abrir Comisaría de Río Seco en OpenStreetMap/ })).toHaveAttribute('href', expect.stringContaining('openstreetmap.org/?mlat=-27.268584&mlon=-65.560203'))
    expect(screen.getByText(/Verificado el/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Policía de Tucumán/ })).toBeInTheDocument()
  })
  it('una ficha inexistente muestra un mensaje y un enlace de regreso', async () => {
    renderApp('/servicios/no-existe')
    expect(await screen.findByText('Lugar no encontrado')).toBeInTheDocument()
  })
  it('la ficha de un lugar sin ubicación no ofrece mapa y mantiene la dirección para indicaciones', async () => {
    renderApp('/servicios/farmacia-santa-rita')
    expect(await screen.findByText('Ubicación pendiente')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /en el mapa de Río Seco/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Cómo llegar a Farmacia Santa Rita/ })).toBeInTheDocument()
  })
})
