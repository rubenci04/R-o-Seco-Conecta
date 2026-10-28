import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { DataProvider } from '@/data/repository/DataContext'
import { ApiError } from '@/data/repository/httpRepository'
import { LocalJsonRepository } from '@/data/repository/localJsonRepository'
import type { DataRepository, NewsQuery } from '@/data/repository/types'
import type { NewsItem } from '@/domain/types'
import { NEWS_PAGE_SIZE } from '@/pages/ContentPages'
import { AppRoutes } from './routes'

const item = (n: number, over: Partial<NewsItem> = {}): NewsItem => ({
  id: String(n),
  title: `Noticia ${n}`,
  summary: `Resumen ${n}`,
  publishedAt: new Date(Date.UTC(2026, 9, 28, 12, 0) - n * 3_600_000).toISOString(),
  source: { label: 'Redacción Río Seco Conecta' },
  verified: true,
  origin: 'manual',
  categories: ['institucional'],
  ...over,
})

function Where() {
  const l = useLocation()
  return <output data-testid="where">{l.pathname + l.search}</output>
}
function renderWith(overrides: Partial<DataRepository>, path = '/noticias') {
  const repo = { ...new LocalJsonRepository(), ...overrides } as DataRepository
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DataProvider repository={repo}>
        <AppRoutes />
        <Where />
      </DataProvider>
    </MemoryRouter>,
  )
}

describe('Noticias dinámicas', () => {
  it('muestra el feed con fecha, categorías, fuente y la hora de actualización', async () => {
    renderWith({ getNews: async () => [item(1)] })
    expect(await screen.findByRole('heading', { name: 'Noticia 1' })).toBeInTheDocument()
    expect(screen.getByText('Revisada por la redacción')).toBeInTheDocument()
    expect(screen.getByText('Noticias institucionales', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('Fuente: Redacción Río Seco Conecta')).toBeInTheDocument() // sin enlace: texto, no un link roto
    expect(screen.getByText(/Actualizado a las \d{2}:\d{2}/)).toBeInTheDocument()
  })
  it('distingue lo verificado por la redacción de lo importado sin revisión', async () => {
    renderWith({ getNews: async () => [item(1), item(2, { verified: false, origin: 'api', source: { label: 'Comuna de Río Seco', url: 'https://www.facebook.com/p/1' } })] })
    expect(await screen.findByRole('heading', { name: 'Noticia 2' })).toBeInTheDocument()
    expect(screen.getAllByText('Revisada por la redacción')).toHaveLength(1)
    expect(screen.getByText('Sin revisión editorial')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Fuente: Comuna de Río Seco/ })).toHaveAttribute('href', 'https://www.facebook.com/p/1')
  })
  it('muestra la rectificación pública y el texto completo desplegable', async () => {
    renderWith({ getNews: async () => [item(1, { body: 'Cuerpo completo de la noticia.\nSegunda línea.', rectification: 'El torneo es el domingo.' })] })
    expect(await screen.findByText(/El torneo es el domingo/)).toBeInTheDocument()
    expect(screen.getByText(/Cuerpo completo/)).toBeInTheDocument()
  })
  it('el contenido con HTML se muestra como texto, sin ejecutarse', async () => {
    renderWith({ getNews: async () => [item(1, { title: '<img src=x onerror=alert(1)>', summary: '<script>alert(2)</script>' })] })
    expect(await screen.findByRole('heading', { name: '<img src=x onerror=alert(1)>' })).toBeInTheDocument()
    expect(document.querySelector('main script, main img')).toBeNull()
  })
  it('estado vacío honesto y filtro por categoría compartible por URL', async () => {
    const calls: (NewsQuery | undefined)[] = []
    const user = userEvent.setup()
    renderWith({ getNews: async (q) => (calls.push(q), []) })
    expect(await screen.findByText('Todavía no hay noticias publicadas')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salud' }))
    expect(screen.getByTestId('where').textContent).toBe('/noticias?categoria=salud')
    expect(await screen.findByText('No hay noticias en esta categoría')).toBeInTheDocument()
    expect(calls.at(-1)).toMatchObject({ category: 'salud', limit: NEWS_PAGE_SIZE })
  })
  it('una categoría inválida en la URL se ignora', async () => {
    const calls: (NewsQuery | undefined)[] = []
    renderWith({ getNews: async (q) => (calls.push(q), [item(1)]) }, '/noticias?categoria=<script>')
    await screen.findByRole('heading', { name: 'Noticia 1' })
    expect(calls[0]?.category).toBeUndefined()
  })
  it('pagina con «Cargar más» usando la fecha de la última nota como cursor, sin duplicar', async () => {
    const all = Array.from({ length: 20 }, (_, i) => item(i + 1))
    const calls: (NewsQuery | undefined)[] = []
    const user = userEvent.setup()
    renderWith({ getNews: async (q) => (calls.push(q), all.filter((n) => !q?.before || n.publishedAt < q.before).slice(0, q?.limit ?? 20)) })
    await screen.findByRole('heading', { name: 'Noticia 1' })
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(NEWS_PAGE_SIZE)
    await user.click(screen.getByRole('button', { name: 'Cargar más noticias' }))
    await screen.findByRole('heading', { name: 'Noticia 20' })
    expect(calls.at(-1)?.before).toBe(all[NEWS_PAGE_SIZE - 1].publishedAt)
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(20)
    expect(screen.queryByRole('button', { name: 'Cargar más noticias' })).toBeNull() // última página: no hay más
  })
  it('si falla «Cargar más» muestra el error y conserva lo ya cargado', async () => {
    const all = Array.from({ length: NEWS_PAGE_SIZE }, (_, i) => item(i + 1))
    const user = userEvent.setup()
    renderWith({ getNews: async (q) => (q?.before ? Promise.reject(new ApiError('El servidor tuvo un problema.', 500)) : all) })
    await screen.findByRole('heading', { name: 'Noticia 1' })
    await user.click(screen.getByRole('button', { name: 'Cargar más noticias' }))
    expect(await screen.findByText('El servidor tuvo un problema.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Noticia 1' })).toBeInTheDocument()
  })
  it('ante un fallo del servidor muestra un mensaje claro con «Reintentar» (nunca un vacío engañoso)', async () => {
    const user = userEvent.setup()
    let fail = true
    renderWith({ getNews: async () => (fail ? Promise.reject(new ApiError('El servidor tuvo un problema. Probá de nuevo en unos minutos.', 503)) : [item(1)]) })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No pudimos cargar esta información')
    expect(alert).toHaveTextContent('El servidor tuvo un problema')
    expect(screen.queryByText('Todavía no hay noticias publicadas')).toBeNull()
    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { name: 'Noticia 1' })).toBeInTheDocument()
  })
  it('revalida en segundo plano sin parpadeos cuando la pestaña vuelve a estar visible', async () => {
    let n = 1
    const getNews = vi.fn(async () => [item(n)])
    renderWith({ getNews })
    await screen.findByRole('heading', { name: 'Noticia 1' })
    n = 2
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Noticia 2' })).toBeInTheDocument())
    expect(getNews.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
  it('Inicio, Alertas, Agenda y Obituarios usan los datos dinámicos y manejan sus errores sin romper los módulos estáticos', async () => {
    const boom = () => Promise.reject(new ApiError('No pudimos conectar con el servidor. Revisá tu conexión.', null))
    renderWith({ getNews: boom, getAlerts: boom, getEvents: boom, getObituaries: boom }, '/')
    expect(await screen.findByRole('heading', { level: 1, name: /bienvenidos a Río Seco/ })).toBeInTheDocument()
    expect((await screen.findAllByText(/No pudimos conectar con el servidor/)).length).toBeGreaterThan(0)
    expect(await screen.findByRole('heading', { name: 'Próximo colectivo' })).toBeInTheDocument() // horarios reales siguen
    expect(await screen.findByText('Servicios y teléfonos útiles')).toBeInTheDocument()
  })
  it('Alertas vigentes y Agenda muestran lo que publica la API', async () => {
    const alert = { id: '1', title: 'Corte de agua en barrio Norte', body: 'Trabajos de reparación.', severity: 'urgente' as const, publishedAt: '2026-10-28T10:00:00.000Z', source: { label: 'Comuna' } }
    const event = { id: '1', title: 'Festival de los pesebres', startsAt: '2030-12-09T00:30:00.000Z', category: 'festividad' as const, source: { label: 'Comuna', url: 'https://www.facebook.com/p/x' } }
    renderWith({ getAlerts: async () => [alert] }, '/alertas')
    expect(await screen.findByRole('heading', { name: alert.title })).toBeInTheDocument()
    document.body.innerHTML = ''
    renderWith({ getEvents: async () => [event] }, '/agenda')
    expect(await screen.findByRole('heading', { name: event.title })).toBeInTheDocument()
    expect(screen.getByText('8 de diciembre a las 21:30')).toBeInTheDocument() // hora de Tucumán
  })
})
