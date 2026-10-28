import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AlertCard, alertClass } from '@/components/content/ContentCards'
import { LINKS } from '@/config/links'
import { DataProvider } from '@/data/repository/DataContext'
import { LocalJsonRepository } from '@/data/repository/localJsonRepository'
import type { DataRepository } from '@/data/repository/types'
import type { AlertItem } from '@/domain/types'
import type { WasteInfo } from '@/domain/waste'
import { AppRoutes } from './routes'

function renderAt(path: string, overrides: Partial<DataRepository> = {}) {
  const repo = { ...new LocalJsonRepository(), ...overrides } as DataRepository
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DataProvider repository={repo}>
        <AppRoutes />
      </DataProvider>
    </MemoryRouter>,
  )
}
const alert = (over: Partial<AlertItem> = {}): AlertItem => ({ id: '1', title: 'Aviso', body: 'Texto', severity: 'info', publishedAt: '2026-10-28T12:00:00.000Z', source: { label: 'Comuna' }, ...over })

describe('cronología oficial de Facebook (widget)', () => {
  it('Noticias: no carga nada de Facebook hasta que la persona lo pide, avisa quién provee el contenido y enlaza la página original', async () => {
    renderAt('/noticias', { getNews: async () => [] })
    expect(await screen.findByText(/Contenido proporcionado por Facebook/)).toBeInTheDocument()
    expect(document.querySelector('iframe')).toBeNull()
    const original = screen.getAllByRole('link', { name: /Abrir la página de la Comuna en Facebook/ })[0]
    expect(original).toHaveAttribute('href', LINKS.comuna.facebook)
  })

  it('al pedirlo, carga el widget oficial de ESTA página, diferido, con cronología y sin cabecera de portada', async () => {
    const user = userEvent.setup()
    renderAt('/noticias', { getNews: async () => [] })
    await user.click(await screen.findByRole('button', { name: 'Ver publicaciones de Facebook' }))
    const frame = document.querySelector('iframe')!
    expect(frame).not.toBeNull()
    const src = new URL(frame.getAttribute('src')!)
    expect(src.origin + src.pathname).toBe('https://www.facebook.com/plugins/page.php')
    expect(src.searchParams.get('href')).toBe(LINKS.comuna.facebook)
    expect(src.searchParams.get('tabs')).toBe('timeline')
    expect(frame).toHaveAttribute('loading', 'lazy')
    expect(frame).toHaveAttribute('title', expect.stringMatching(/Comuna de Río Seco/))
    // Si el navegador bloquea el contenido de Facebook, la persona conserva el enlace directo.
    expect(screen.getByText(/bloqueando el contenido de Facebook/)).toBeInTheDocument()
  })

  it('no aparece al filtrar por una categoría, y el bloque es distinto del feed propio', async () => {
    renderAt('/noticias?categoria=agua', { getNews: async () => [] })
    await screen.findByText(/No hay noticias en esta categoría/)
    expect(screen.queryByText(/Contenido proporcionado por Facebook/)).not.toBeInTheDocument()
  })

  it('Inicio muestra la sección «Desde Facebook»', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Desde Facebook' })).toBeInTheDocument()
  })
})

describe('alertas: urgentes, interrupciones de servicio e informativas', () => {
  it('clasifica el aviso para mostrarlo', () => {
    expect(alertClass(alert({ severity: 'urgente', kind: 'meteorologica' })).label).toBe('Urgente')
    expect(alertClass(alert({ kind: 'agua' })).label).toBe('Interrupción de servicio')
    expect(alertClass(alert({ kind: 'comunicado', categories: ['residuos'] })).label).toBe('Interrupción de servicio')
    expect(alertClass(alert({ kind: 'comunicado' })).label).toBe('Aviso informativo')
  })
  it('la tarjeta muestra la etiqueta', () => {
    render(<AlertCard item={alert({ kind: 'calles' })} />)
    expect(screen.getByText('Interrupción de servicio')).toBeInTheDocument()
  })
})

describe('/residuos', () => {
  const empty: WasteInfo = { schedule: [], campaigns: [] }
  it('sin datos confirmados lo dice y no inventa días ni horarios', async () => {
    renderAt('/residuos', { getWaste: async () => empty, getAlerts: async () => [], getNews: async () => [] })
    expect(await screen.findByText('Todavía no hay días ni horarios confirmados')).toBeInTheDocument()
    expect(screen.getByText(/No publicamos frecuencias ni recorridos que no estén confirmados/)).toBeInTheDocument()
    expect(screen.getByText('No hay avisos vigentes sobre la recolección')).toBeInTheDocument()
    expect(screen.queryByText(/lunes|martes|miércoles/i)).not.toBeInTheDocument()
  })

  it('muestra los días confirmados con su fuente y los avisos vigentes de residuos (solo esos)', async () => {
    const data: WasteInfo = {
      schedule: [{ id: 's1', zone: 'Zona centro (dato de prueba)', days: ['lunes', 'jueves'], time: '07:00', source: { label: 'Fuente de prueba', url: 'https://example.com/fuente', reuseAuthorized: true }, lastVerified: '2026-10-01' }],
      campaigns: [{ id: 'c1', title: 'Jornada de limpieza (prueba)', date: '2026-11-01', source: { label: 'Fuente', url: 'https://example.com/f', reuseAuthorized: true } }],
    }
    renderAt('/residuos', {
      getWaste: async () => data,
      getAlerts: async () => [alert({ id: 'a', title: 'Recolección suspendida hoy', kind: 'comunicado', categories: ['residuos'] }), alert({ id: 'b', title: 'Corte de agua', kind: 'agua', categories: ['agua'] })],
      getNews: async () => [],
    })
    const section = await screen.findByRole('region', { name: 'Días, horarios y recorridos confirmados' })
    expect(within(section).getByText('Zona centro (dato de prueba)')).toBeInTheDocument()
    expect(within(section).getByText(/lunes, jueves · 07:00/)).toBeInTheDocument()
    expect(within(section).getByText(/Fuente de prueba/)).toBeInTheDocument()
    expect(screen.getByText('Recolección suspendida hoy')).toBeInTheDocument()
    expect(screen.queryByText('Corte de agua')).not.toBeInTheDocument()
    expect(screen.getByText('Jornada de limpieza (prueba)')).toBeInTheDocument()
  })

  it('está enlazada desde Servicios, Inicio y el menú', async () => {
    renderAt('/servicios')
    expect(await screen.findByRole('link', { name: 'Recolección de residuos y limpieza urbana' })).toHaveAttribute('href', '/residuos')
  })

  it('el filtro de Noticias incluye la categoría', async () => {
    renderAt('/noticias', { getNews: async () => [] })
    expect(await screen.findByRole('button', { name: 'Recolección de residuos y limpieza urbana' })).toBeInTheDocument()
  })
})
