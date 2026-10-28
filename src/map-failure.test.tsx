import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { DataProvider } from '@/data/repository/DataContext'
import { AppRoutes } from './routes'

// Simula que el módulo del mapa no se puede descargar (p. ej. primera visita sin conexión).
vi.mock('@/components/map/PlacesMap', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

describe('el mapa es opcional', () => {
  it('si el módulo del mapa falla, la pantalla muestra el aviso y conserva fichas, teléfonos y filtros', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <MemoryRouter initialEntries={['/mapa']}>
        <DataProvider>
          <AppRoutes />
        </DataProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('No se pudo cargar el mapa')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/lista de lugares de abajo/)
    expect(await screen.findByText('Comisaría de Río Seco')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Llamar a Comisaría de Río Seco' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /^Salud/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Ubicación pendiente \(2\)/ })).toBeInTheDocument()
  })
})
