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
