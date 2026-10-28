import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { manifest } from '../pwa/pwa.config'
import { LocalJsonRepository } from '@/data/repository/localJsonRepository'
import { DataProvider } from '@/data/repository/DataContext'
import { LINKS, mapLinks } from '@/config/links'
import { AppRoutes } from './routes'

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DataProvider>
        <AppRoutes />
      </DataProvider>
    </MemoryRouter>,
  )
}

const repo = new LocalJsonRepository()

describe('Servicios y lugares útiles', () => {
  it('muestra las tres fichas documentadas con llamada, mapa y compartir', async () => {
    renderApp('/servicios')
    expect(await screen.findByText('Comisaría de Río Seco')).toBeInTheDocument()
    expect(screen.getByText('CAPS Río Seco')).toBeInTheDocument()
    expect(screen.getByText('Farmacia Santa Rita')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Llamar a Comisaría de Río Seco' })).toHaveAttribute('href', 'tel:03863471081')
    const way = screen.getByRole('link', { name: /Cómo llegar a Comisaría de Río Seco/ })
    expect(way.getAttribute('href')).toContain('https://www.google.com/maps/dir/')
    // con ubicación verificada, las indicaciones usan las coordenadas y no solo el texto de la dirección
    expect(decodeURIComponent(way.getAttribute('href')!)).toContain('-27.268584,-65.560203')
    expect(screen.getAllByRole('button', { name: /Compartir/ }).length).toBeGreaterThanOrEqual(3)
  })
  it('no inventa teléfonos ni horarios: los datos faltantes figuran como pendientes', async () => {
    const places = await repo.getPlaces()
    const caps = places.find((p) => p.id === 'caps-rio-seco')!
    const farm = places.find((p) => p.id === 'farmacia-santa-rita')!
    expect(caps.phone).toBeUndefined()
    expect(caps.pending).toEqual(expect.arrayContaining(['phone', 'hours']))
    expect(farm.phone).toBeUndefined()
    expect(farm.hours).toBeUndefined()
    expect(places.find((p) => p.id === 'comisaria-rio-seco')?.phone).toBe('03863-471081')
    for (const p of places) {
      if (p.pending.includes('phone')) expect(p.phone).toBeUndefined()
      if (p.pending.includes('hours')) expect(p.hours).toBeUndefined()
    }
    renderApp('/servicios')
    expect((await screen.findAllByText(/pendiente de confirmación/)).length).toBeGreaterThan(3)
  })
  it('el CAPS aclara que la fuente enlazada no confirma el dato', async () => {
    renderApp('/servicios?categoria=salud')
    expect(await screen.findByText(/NO confirma este dato/)).toBeInTheDocument()
  })
  it('las categorías sin fichas muestran un estado vacío honesto', async () => {
    const user = userEvent.setup()
    renderApp('/servicios')
    await screen.findByText('Comisaría de Río Seco')
    await user.click(screen.getByRole('button', { name: 'Paradas de colectivo' }))
    expect(await screen.findByText(/Todavía no relevamos: Paradas de colectivo/)).toBeInTheDocument()
    expect(screen.queryByText('Comisaría de Río Seco')).not.toBeInTheDocument()
  })
  it('incluye los números de emergencia con enlace de llamada', async () => {
    renderApp('/servicios')
    expect(await screen.findByRole('link', { name: /Llamar al 911/ })).toHaveAttribute('href', 'tel:911')
  })
  it('los enlaces de mapas codifican el texto', () => {
    expect(mapLinks.search('Av. Himno Patrio 211')).toBe('https://www.google.com/maps/search/?api=1&query=Av.%20Himno%20Patrio%20211')
    expect(mapLinks.openStreetMap('a b')).toContain('query=a%20b')
  })
})

describe('Nuestro pueblo', () => {
  it('presenta las nueve secciones pedidas, con los pesebres destacados primero', async () => {
    renderApp('/pueblo')
    await screen.findByText('Historia de Río Seco')
    const list = within(screen.getByRole('main')).getByRole('list')
    const titles = within(list).getAllByRole('link').map((a) => a.textContent ?? '')
    expect(titles).toHaveLength(9)
    expect(titles[0]).toContain('tradición de los pesebres')
    for (const t of ['Historia de Río Seco', 'El ingenio', 'clubes', 'iglesia', 'plaza', '17 de agosto', 'mejores pesebres', 'festival artístico']) {
      expect(titles.join('|').toLowerCase()).toContain(t.toLowerCase())
    }
  })
  it('cada afirmación indica su respaldo: documentado (con fuente), aporte del equipo o pendiente', async () => {
    for (const s of await repo.getHeritage()) {
      for (const c of s.claims) {
        if (c.kind === 'documentado') expect(c.source?.url, `${s.id}`).toBeTruthy()
        expect(['documentado', 'equipo', 'pendiente']).toContain(c.kind)
      }
    }
    const pesebres = (await repo.getHeritage()).find((s) => s.id === 'tradicion-pesebres')!
    expect(pesebres.claims.find((c) => c.kind === 'documentado')?.source?.url).toBe('https://www.cadena3.com/noticia/turno-noche/rio-seco-la-capital-del-pesebre-esta-en-tucuman_375912')
    expect(pesebres.claims.some((c) => c.kind === 'equipo' && c.text.includes('8 de diciembre'))).toBe(true)
  })
  it('no inventa años, ediciones ni artistas', async () => {
    const text = (await repo.getHeritage()).flatMap((s) => s.claims.map((c) => c.text)).join(' ')
    expect(text).not.toMatch(/\b(1[5-9]|20)\d{2}\b/)
    expect(text).not.toMatch(/edición n[°º]|\b\d+(ª|a|\.ª)? edición/i)
    const festival = (await repo.getHeritage()).find((s) => s.id === 'festival-pesebres')!
    expect(festival.claims.some((c) => c.kind === 'pendiente' && /artistas/.test(c.text))).toBe(true)
  })
  it('la ficha detalla fuente, estado y reserva espacio para fotografías oficiales', async () => {
    renderApp('/pueblo/tradicion-pesebres')
    expect(await screen.findByText('Documentado')).toBeInTheDocument()
    expect(screen.getByText(/Aporte del equipo/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Fuente: Cadena 3/ })).toHaveAttribute('href', expect.stringContaining('cadena3.com'))
    expect(screen.getByText(/Todavía no hay fotografías oficiales/)).toBeInTheDocument()
  })
  it('una sección inexistente muestra un mensaje en lugar de romper', async () => {
    renderApp('/pueblo/no-existe')
    expect(await screen.findByText('Sección no encontrada')).toBeInTheDocument()
  })
})

describe('Inicio', () => {
  it('muestra la fotografía, el buscador rápido con horarios reales, servicios, radios y Nuestro pueblo', async () => {
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1, name: /bienvenidos a Río Seco/ })).toBeInTheDocument()
    expect(screen.getByAltText(/Cartel «Río Seco»/)).toHaveAttribute('src', '/brand/entrada.webp')
    expect(await screen.findByRole('heading', { name: 'Próximo colectivo' })).toBeInTheDocument()
    expect((await screen.findAllByRole('listitem')).length).toBeGreaterThan(5)
    expect(await screen.findByRole('link', { name: 'Llamar a Comisaría de Río Seco' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Escuchar Radio Activa/ })).toHaveAttribute('href', LINKS.radios.activa)
    expect(screen.getByRole('link', { name: /capital|pesebres/i })).toHaveAttribute('href', '/pueblo/tradicion-pesebres')
  })
  it('mantiene estados vacíos solo donde faltan datos y no inventa noticias', async () => {
    renderApp('/')
    expect(await screen.findByText('Todavía no hay noticias publicadas')).toBeInTheDocument()
    expect(screen.getByText('No hay eventos cargados')).toBeInTheDocument()
  })
  it('el buscador rápido permite invertir el sentido', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await screen.findByRole('heading', { name: 'Próximo colectivo' })
    const swap = await screen.findByRole('button', { name: 'Invertir origen y destino' })
    expect(screen.getByRole('combobox', { name: 'Hacia' })).toBeInTheDocument()
    await user.click(swap)
    expect(screen.getByRole('combobox', { name: 'Desde' })).toBeInTheDocument()
  })
})

// ------------------------------------------------------------ identidad y accesibilidad

const css = readFileSync('src/index.css', 'utf8')
const block = (selector: string) => {
  const m = css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))
  return Object.fromEntries([...(m?.[1] ?? '').matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((x) => [x[1], x[2]]))
}
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (!d) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return Math.round((h * 60 + 360) % 360)
}

describe('identidad visual y accesibilidad', () => {
  const light = block(':root')
  const dark = block('.dark')
  const pairs: [string, string][] = [
    ['foreground', 'background'], ['foreground', 'card'], ['muted-foreground', 'background'], ['muted-foreground', 'card'], ['muted-foreground', 'muted'],
    ['primary-foreground', 'primary'], ['accent', 'background'], ['accent', 'card'], ['accent', 'accent-soft'], ['primary', 'background'],
    ['orange-foreground', 'orange'], ['warning', 'warning-soft'], ['danger', 'danger-soft'], ['orange', 'orange-soft'],
  ]
  it.each([['claro', light], ['oscuro', dark]] as const)('tokens del modo %s cumplen contraste WCAG AA (4.5:1) en texto', (_n, tokens) => {
    for (const [fg, bg] of pairs) expect(contrast(tokens[fg], tokens[bg]), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5)
  })
  it('la paleta es celeste y blanco con naranja y azul noche, derivada del logo', () => {
    expect(hue(light.brand)).toBeGreaterThanOrEqual(190)
    expect(hue(light.brand)).toBeLessThanOrEqual(215)
    expect(hue(light.primary)).toBeGreaterThanOrEqual(195)
    expect(hue(light.primary)).toBeLessThanOrEqual(215)
    expect(light.card).toBe('#ffffff')
    expect(hue(light.orange)).toBeGreaterThanOrEqual(10)
    expect(hue(light.orange)).toBeLessThanOrEqual(30)
    expect(lum(light.night)).toBeLessThan(0.04)
    expect(light.brand).toBe('#18b1e3') // celeste dominante medido en el logo «RS» (npm run brand:palette)
    expect(light.night).toBe('#073049') // azul oscuro del contorno del logo
  })
  it('no quedan restos de la paleta terracota/turquesa anterior', () => {
    const old = ['#b4532a', '#a8481f', '#2f7f86', '#1f6f77', '#e8804f', '#fbf6ee', '#66bcc4', '#1769a8', '#398fca', 'logo-sign', 'logo.jpg']
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)]))
    const files = [...walk('src').filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith('community.test.tsx')), 'index.html', 'pwa/pwa.config.ts']
    for (const f of files) for (const c of old) expect(readFileSync(f, 'utf8').toLowerCase(), `${f} ${c}`).not.toContain(c)
  })
  it('el manifiesto y la barra del navegador usan el celeste de marca', () => {
    expect(manifest.theme_color).toBe(light.primary)
    expect(readFileSync('index.html', 'utf8')).toContain(`content="${light.primary}"`)
  })
  it('los recursos de marca y de PWA existen y derivan del logo', () => {
    for (const f of ['public/brand/logo-v2.png', 'public/brand/logo-mark-v2.png', 'public/brand/entrada.webp', 'public/favicon.ico', 'public/favicon-32-v2.png', 'public/icons/icon-192-v2.png', 'public/icons/icon-512-v2.png', 'public/icons/icon-maskable-512-v2.png', 'public/icons/apple-touch-icon-v2.png']) {
      expect(existsSync(f), f).toBe(true)
    }
    expect(existsSync('src/logo.png')).toBe(true)
    expect(existsSync('src/logo.jpg')).toBe(false) // logo anterior descartado
    expect(existsSync('public/favicon.svg')).toBe(false)
    expect(existsSync('public/brand/logo-sign.webp')).toBe(false)
  })
  it('todas las imágenes tienen texto alternativo y los botones nombre accesible', async () => {
    for (const p of ['/', '/colectivos', '/servicios', '/pueblo', '/radios']) {
      const { unmount } = renderApp(p)
      await screen.findByRole('heading', { level: 1 })
      await new Promise((r) => setTimeout(r, 50))
      for (const img of document.querySelectorAll('img')) expect(img.hasAttribute('alt'), `${p} img`).toBe(true)
      for (const b of screen.queryAllByRole('button')) expect((b.textContent ?? '') + (b.getAttribute('aria-label') ?? ''), `${p} botón`).not.toBe('')
      expect(document.querySelectorAll('h1')).toHaveLength(1)
      unmount()
    }
  })
  it('el layout declara navegación principal y región principal', async () => {
    renderApp('/')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeInTheDocument()
  })
})
