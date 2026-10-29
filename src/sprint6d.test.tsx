import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { PhotoGallery } from '@/components/community/PhotoGallery'
import { PHOTOS } from '@/config/photos'
import { AboutPage } from '@/pages/InfoPages'

describe('Acerca de: administración y versión', () => {
  it('muestra la versión instalada y un enlace discreto a /admin (que sigue pidiendo sesión)', () => {
    render(<MemoryRouter><AboutPage /></MemoryRouter>)
    expect(screen.getByTestId('build-commit').textContent).toMatch(/^[0-9a-f]{7}$|^local$/)
    expect(screen.getByRole('link', { name: 'Administración' })).toHaveAttribute('href', '/admin')
  })
})

describe('fotografías', () => {
  it('cada foto tiene texto alternativo, dimensiones y la fuente visible', () => {
    render(<PhotoGallery ids={Object.keys(PHOTOS)} />)
    expect(screen.getAllByRole('img')).toHaveLength(8)
    for (const img of screen.getAllByRole('img')) expect(img.getAttribute('alt')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Facebook de la Comuna de Río Seco/ })).toBeInTheDocument()
  })
})
