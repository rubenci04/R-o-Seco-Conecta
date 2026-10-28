import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { manifest, pwaOptions } from '../../pwa/pwa.config'
import { allExternalLinks, LINKS } from './links'

describe('registro de enlaces externos', () => {
  it('contiene las fuentes reales del proyecto', () => {
    expect(LINKS.comuna.facebook).toContain('facebook.com/p/Comuna-De-Rio-Seco-61553018412844')
    expect(LINKS.comuna.instagram).toBe('https://www.instagram.com/comunaderioseco/')
    expect(LINKS.radios.activa).toBe('https://www.activa1031.fmmiradio.com/')
    expect(LINKS.radios.sudamericana).toBe('https://www.sudamericana893.com.ar/radio.php')
    expect(LINKS.transport.concepcion).toBe('https://colectivostucuman.com.ar/horarios/rio-seco/concepcion?dia=weekday')
  })
  it('todos son URLs https válidas', () => {
    for (const l of allExternalLinks()) {
      expect(() => new URL(l)).not.toThrow()
      expect(new URL(l).protocol).toBe('https:')
    }
  })
})

describe('instalabilidad de la PWA', () => {
  it('el manifiesto cumple los criterios de instalación', () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name.length).toBeLessThanOrEqual(12)
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    expect(manifest.lang).toBe('es-AR')
    const sizes = manifest.icons.map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true)
  })
  it('los íconos existen y son PNG del tamaño declarado', () => {
    for (const icon of manifest.icons) {
      const file = path.resolve('public', icon.src.slice(1))
      expect(existsSync(file), icon.src).toBe(true)
      const buf = readFileSync(file)
      expect(buf.subarray(1, 4).toString()).toBe('PNG')
      const w = buf.readUInt32BE(16)
      expect(`${w}x${w}`).toBe(icon.sizes)
    }
  })
  it('registra service worker con actualización automática y fallback SPA', () => {
    expect(pwaOptions.registerType).toBe('autoUpdate')
    expect(pwaOptions.workbox?.navigateFallback).toBe('/index.html')
  })
  it('index.html enlaza el manifiesto y el color del tema', () => {
    const html = readFileSync('index.html', 'utf8')
    expect(html).toContain('name="theme-color"')
    expect(html).toContain('lang="es-AR"')
  })
})

describe('PWA y mapa: sin teselas en caché y sin precargar Leaflet', () => {
  it('el código del mapa no se precachea y solo se guarda tras usarse', () => {
    expect(pwaOptions.workbox?.globIgnores).toContain('**/PlacesMap-*.{js,css}')
    const rules = pwaOptions.workbox?.runtimeCaching ?? []
    expect(rules).toHaveLength(1)
    const url = (u: string) => ({ url: new URL(u), sameOrigin: new URL(u).origin === 'https://app.test' })
    const match = rules[0].urlPattern as (c: { url: URL; sameOrigin: boolean }) => boolean
    expect(match(url('https://app.test/assets/PlacesMap-abc123.js'))).toBe(true)
    expect(match(url('https://app.test/assets/PlacesMap-abc123.css'))).toBe(true)
  })
  it('ninguna regla del service worker captura las teselas de OpenStreetMap', () => {
    const match = (pwaOptions.workbox?.runtimeCaching ?? [])[0].urlPattern as (c: { url: URL; sameOrigin: boolean }) => boolean
    expect(match({ url: new URL('https://tile.openstreetmap.org/15/12345/23456.png'), sameOrigin: false })).toBe(false)
    expect(match({ url: new URL('https://tile.openstreetmap.org/assets/PlacesMap-x.js'), sameOrigin: false })).toBe(false)
    expect(JSON.stringify(pwaOptions.workbox)).not.toContain('tile.openstreetmap')
  })
  it('el service worker generado no menciona teselas ni precachea el chunk del mapa', () => {
    if (!existsSync('dist/sw.js')) return // se valida tras `npm run build`
    const sw = readFileSync('dist/sw.js', 'utf8')
    expect(sw).not.toContain('tile.openstreetmap')
    expect(sw).toContain('rio-seco-map-code')
    expect(sw.match(/url:"assets\/PlacesMap-[^"]+"/g) ?? []).toEqual([])
  })
})
