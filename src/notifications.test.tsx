import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataProvider } from '@/data/repository/DataContext'
import { LocalJsonRepository } from '@/data/repository/localJsonRepository'
import type { DataRepository } from '@/data/repository/types'
import type { AlertItem, NewsItem, Obituary } from '@/domain/types'
import * as push from '@/services/push'
import { AppRoutes } from './routes'

vi.mock('@/services/push', async (orig) => ({ ...(await orig<typeof import('@/services/push')>()), getPushStatus: vi.fn(), enablePush: vi.fn(), updatePushTopics: vi.fn(), disablePush: vi.fn() }))
const mocked = vi.mocked(push)

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
const checked = (name: RegExp) => (screen.getByRole('checkbox', { name }) as HTMLInputElement).checked

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Configuración → Mis notificaciones', () => {
  it('Configuración enlaza a Mis notificaciones y está en el menú', async () => {
    renderAt('/configuracion')
    expect(await screen.findByRole('heading', { name: 'Configuración' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Mis notificaciones/ })).toHaveAttribute('href', '/configuracion/notificaciones')
  })

  it('al abrir la pantalla NO se pide permiso ni se activa nada; solo se muestra el estado', async () => {
    mocked.getPushStatus.mockResolvedValue({ kind: 'off', permissionGranted: false })
    renderAt('/configuracion/notificaciones')
    expect(await screen.findByRole('button', { name: /Activar notificaciones/ })).toBeInTheDocument()
    expect(mocked.enablePush).not.toHaveBeenCalled()
  })

  it('la configuración inicial son solo avisos importantes; nada de novedades ni obituarios por defecto', async () => {
    mocked.getPushStatus.mockResolvedValue({ kind: 'off', permissionGranted: false })
    renderAt('/configuracion/notificaciones')
    await screen.findByRole('button', { name: /Activar notificaciones/ })
    for (const on of [/Alertas urgentes/, /Cortes de agua/, /Cortes de electricidad/, /Calles cortadas/, /Alertas meteorológicas/]) expect(checked(on), String(on)).toBe(true)
    for (const off of [/Noticias institucionales/, /Eventos y festividades/, /Cultura/, /Actividades deportivas/, /Educación/, /Salud/, /Otras novedades/, /Obituarios/]) expect(checked(off), String(off)).toBe(false)
  })

  it('ofrece los 14 temas, incluidos los obituarios en un grupo aparte y de elección expresa', async () => {
    mocked.getPushStatus.mockResolvedValue({ kind: 'off', permissionGranted: false })
    renderAt('/configuracion/notificaciones')
    await screen.findByRole('button', { name: /Activar notificaciones/ })
    expect(screen.getAllByRole('checkbox')).toHaveLength(14)
    expect(screen.getByText(/Solo los recibís si los elegís vos/)).toBeInTheDocument()
  })

  it('activar envía exactamente los temas elegidos y confirma con un mensaje', async () => {
    mocked.getPushStatus.mockResolvedValueOnce({ kind: 'off', permissionGranted: false }).mockResolvedValue({ kind: 'on', topics: ['urgente', 'agua', 'energia', 'calles', 'meteorologica', 'institucional'], verified: true })
    mocked.enablePush.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderAt('/configuracion/notificaciones')
    await user.click(await screen.findByRole('checkbox', { name: /Noticias institucionales/ }))
    await user.click(screen.getByRole('button', { name: /Activar notificaciones/ }))
    expect(mocked.enablePush).toHaveBeenCalledWith(['urgente', 'agua', 'energia', 'calles', 'meteorologica', 'institucional'])
    expect(await screen.findByText(/las notificaciones quedaron activadas/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Desactivar notificaciones' })).toBeInTheDocument()
  })

  it('el botón de activar se deshabilita sin ningún tema', async () => {
    mocked.getPushStatus.mockResolvedValue({ kind: 'off', permissionGranted: false })
    const user = userEvent.setup()
    renderAt('/configuracion/notificaciones')
    await screen.findByRole('button', { name: /Activar notificaciones/ })
    for (const box of screen.getAllByRole('checkbox')) if ((box as HTMLInputElement).checked) await user.click(box)
    expect(screen.getByRole('button', { name: /Activar notificaciones/ })).toBeDisabled()
    expect(screen.getByText('Elegí al menos un tema.')).toBeInTheDocument()
  })

  it('las configuraciones rápidas cambian la selección', async () => {
    mocked.getPushStatus.mockResolvedValue({ kind: 'off', permissionGranted: false })
    const user = userEvent.setup()
    renderAt('/configuracion/notificaciones')
    await user.click(await screen.findByRole('button', { name: /Avisos importantes y novedades de la Comuna/ }))
    expect(checked(/Noticias institucionales/)).toBe(true)
    expect(checked(/Eventos y festividades/)).toBe(true)
    expect(checked(/Obituarios/)).toBe(false)
  })

  it('con las notificaciones activas: guardar preferencias y desactivar', async () => {
    mocked.getPushStatus.mockResolvedValue({ kind: 'on', topics: ['agua'], verified: true })
    mocked.updatePushTopics.mockResolvedValue(undefined)
    mocked.disablePush.mockResolvedValue({ serverNotified: true })
    const user = userEvent.setup()
    renderAt('/configuracion/notificaciones')
    const save = await screen.findByRole('button', { name: 'Guardar preferencias' })
    expect(save).toBeDisabled() // nada cambió todavía
    await user.click(screen.getByRole('checkbox', { name: /Salud/ }))
    await user.click(save)
    expect(mocked.updatePushTopics).toHaveBeenCalledWith(['agua', 'salud'])
    expect(await screen.findByText('Guardamos tus preferencias.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Desactivar notificaciones' }))
    expect(mocked.disablePush).toHaveBeenCalled()
    expect(await screen.findByText(/Desactivamos las notificaciones en este dispositivo/)).toBeInTheDocument()
  })

  it.each([
    [{ kind: 'unsupported' as const }, /no admite notificaciones/],
    [{ kind: 'ios-install' as const }, /primero instalá la aplicación/],
    [{ kind: 'unavailable' as const }, /todavía no están disponibles/],
    [{ kind: 'denied' as const }, /están bloqueadas/],
  ])('estado bloqueante %j: explica qué hacer y no ofrece activar', async (status, text) => {
    mocked.getPushStatus.mockResolvedValue(status)
    renderAt('/configuracion/notificaciones')
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Activar notificaciones/ })).not.toBeInTheDocument()
  })

  it('suscripción vencida: lo explica y permite activar de nuevo', async () => {
    mocked.getPushStatus.mockResolvedValue({ kind: 'expired' })
    renderAt('/configuracion/notificaciones')
    expect(await screen.findByText('Tu suscripción venció')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Activar notificaciones/ })).toBeInTheDocument()
  })

  it('error de conexión al revisar: ofrece reintentar', async () => {
    mocked.getPushStatus.mockResolvedValueOnce({ kind: 'error', message: 'No pudimos conectar con el servidor.' }).mockResolvedValue({ kind: 'off', permissionGranted: false })
    const user = userEvent.setup()
    renderAt('/configuracion/notificaciones')
    expect(await screen.findByText('No pudimos conectar con el servidor.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('button', { name: /Activar notificaciones/ })).toBeInTheDocument()
  })

  it('permiso rechazado o error al activar: muestra el motivo y sigue ofreciendo activar', async () => {
    mocked.getPushStatus.mockResolvedValue({ kind: 'off', permissionGranted: false })
    mocked.enablePush.mockRejectedValue(new push.PushError('network', push.MESSAGES.network))
    const user = userEvent.setup()
    renderAt('/configuracion/notificaciones')
    await user.click(await screen.findByRole('button', { name: /Activar notificaciones/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos conectar con el servidor')
    expect(screen.getByRole('button', { name: /Activar notificaciones/ })).toBeEnabled()
  })

  it('indica que no se guardan datos personales', async () => {
    mocked.getPushStatus.mockResolvedValue({ kind: 'off', permissionGranted: true })
    renderAt('/configuracion/notificaciones')
    expect(await screen.findByText(/Ya diste permiso a este sitio/)).toBeInTheDocument()
    expect(screen.getByText(/No guardamos tu nombre, tu ubicación ni ningún dato personal/)).toBeInTheDocument()
  })
})

describe('abrir el contenido exacto desde una notificación', () => {
  const news: NewsItem = { id: '41', title: 'Horario especial de la Comuna', summary: 'Resumen', body: 'Texto completo de ESTA noticia.', publishedAt: '2026-10-28T12:00:00.000Z', source: { label: 'Redacción' }, verified: true, categories: ['institucional'] }
  const alert: AlertItem = { id: '8', title: 'Alerta naranja', body: 'Tormentas fuertes.', severity: 'urgente', publishedAt: '2026-10-28T12:00:00.000Z', source: { label: 'Comuna' } }
  const obit: Obituary = { id: '3', name: 'Juan Pérez', date: '2026-10-27', verified: true, source: { label: 'Comuna' } }

  it('/noticias/:id muestra la noticia pedida, con su texto completo desplegado', async () => {
    const getNewsItem = vi.fn(async (id: string) => (id === '41' ? news : null))
    renderAt('/noticias/41', { getNewsItem })
    expect(await screen.findByText('Horario especial de la Comuna')).toBeInTheDocument()
    expect(getNewsItem).toHaveBeenCalledWith('41')
    expect(screen.getByText('Texto completo de ESTA noticia.')).toBeVisible()
  })

  it('/alertas/:id y /obituarios/:id abren su propio contenido', async () => {
    const r1 = renderAt('/alertas/8', { getAlertItem: async () => alert })
    expect(await screen.findByText('Alerta naranja')).toBeInTheDocument()
    r1.unmount()
    renderAt('/obituarios/3', { getObituaryItem: async () => obit })
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
  })

  it('un contenido retirado o inexistente explica que ya no está disponible y ofrece volver', async () => {
    renderAt('/noticias/999', { getNewsItem: async () => null })
    expect(await screen.findByText('Esta noticia ya no está disponible')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver todas las noticias' })).toHaveAttribute('href', '/noticias')
  })

  it('un error de red al abrir se informa (no se muestra como «no disponible»)', async () => {
    renderAt('/alertas/8', { getAlertItem: async () => Promise.reject(new Error('sin conexión')) })
    await waitFor(() => expect(screen.queryByText('Esta alerta ya no está disponible')).not.toBeInTheDocument())
    expect(await screen.findByText(/sin conexión/)).toBeInTheDocument()
  })
})
