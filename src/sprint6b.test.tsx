import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { NewsCard } from '@/components/content/ContentCards'
import type { NewsItem } from '@/domain/types'

// Enlaces SINTÉTICOS (ids inventados).
const REEL = 'https://www.facebook.com/reel/111111111111111/'
const linkOnly = (over: Partial<NewsItem> = {}): NewsItem => ({
  id: '1',
  title: 'Video institucional',
  publishedAt: '2026-10-28T15:00:00.000Z',
  verified: false,
  source: { label: 'Facebook oficial de la Comuna', url: REEL },
  linkOnly: true,
  dateVerified: false,
  contentType: 'reel',
  categories: [],
  ...over,
})

describe('tarjeta de una publicación externa enlazada', () => {
  it('se identifica como publicación externa, sin inventar fecha ni resumen, y enlaza al original', () => {
    render(<NewsCard item={linkOnly()} />)
    expect(screen.getByText('Publicación externa enlazada')).toBeInTheDocument()
    expect(screen.getByText(/Registrada el/)).toBeInTheDocument()
    expect(screen.getByText(/no se conoce su fecha original/)).toBeInTheDocument()
    expect(screen.getByText('Sin revisión editorial')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Abrir la publicación en Facebook/ })).toHaveAttribute('href', REEL)
  })

  it('con fecha verificada la muestra como fecha de publicación y no dice «Registrada»', () => {
    render(<NewsCard item={linkOnly({ dateVerified: true })} />)
    expect(screen.queryByText(/Registrada el/)).not.toBeInTheDocument()
    expect(screen.queryByText(/no se conoce su fecha original/)).not.toBeInTheDocument()
  })

  it('el embed oficial es opcional y diferido: no hay iframe hasta que la persona lo pide', async () => {
    const user = userEvent.setup()
    render(<NewsCard item={linkOnly()} />)
    expect(document.querySelector('iframe')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Ver la publicación original' }))
    const frame = document.querySelector('iframe')!
    const src = new URL(frame.getAttribute('src')!)
    expect(src.origin + src.pathname).toBe('https://www.facebook.com/plugins/video.php')
    expect(src.searchParams.get('href')).toBe(REEL)
    expect(frame).toHaveAttribute('loading', 'lazy')
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts')
    expect(screen.getByText(/Contenido proporcionado por Facebook/)).toBeInTheDocument()
    // La alternativa visible sigue ahí para publicaciones que Facebook no deje incrustar.
    expect(screen.getByRole('link', { name: /Abrir la publicación en Facebook/ })).toBeInTheDocument()
  })

  it('una fuente que no es una publicación (p. ej. la página) conserva el enlace de fuente y no ofrece embed', () => {
    render(<NewsCard item={linkOnly({ linkOnly: false, dateVerified: true, source: { label: 'Comuna', url: 'https://www.facebook.com/p/Comuna-De-Rio-Seco-61553018412844/' } })} />)
    expect(screen.queryByRole('button', { name: 'Ver la publicación original' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Fuente: Comuna/ })).toBeInTheDocument()
  })

  it('una noticia con texto y enlace a su publicación también ofrece el original, sin cambiar su texto', () => {
    render(<NewsCard item={linkOnly({ linkOnly: false, dateVerified: true, summary: 'Texto de la nota', verified: true })} />)
    expect(screen.queryByText('Publicación externa enlazada')).not.toBeInTheDocument()
    expect(screen.getByText('Texto de la nota')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver la publicación original' })).toBeInTheDocument()
  })
})
