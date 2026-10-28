import { expect, test, type Page } from '@playwright/test'

// PNG transparente de 1×1: las pruebas no consumen los servidores públicos de teselas de OpenStreetMap.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

async function stubTiles(page: Page, mode: 'ok' | 'fail' = 'ok') {
  const hits: string[] = []
  await page.route('https://tile.openstreetmap.org/**', (route) => {
    hits.push(route.request().url())
    return mode === 'ok' ? route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }) : route.abort()
  })
  return hits
}

test('el mapa carga de forma diferida: Inicio no descarga Leaflet y /mapa sí', async ({ page }) => {
  await stubTiles(page)
  const requested: string[] = []
  page.on('request', (r) => requested.push(r.url()))
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(requested.some((u) => /PlacesMap-/.test(u))).toBe(false)
  await page.goto('/mapa')
  await expect(page.locator('.leaflet-container')).toBeVisible()
  expect(requested.some((u) => /PlacesMap-.*\.js/.test(u))).toBe(true)
})

test('Explorá Río Seco: mapa con marcadores, atribución a OpenStreetMap y sin desborde horizontal', async ({ page }) => {
  const hits = await stubTiles(page)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/mapa')
  await expect(page.getByRole('heading', { level: 1, name: 'Explorá Río Seco' })).toBeVisible()
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(20)
  await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap')
  const box = await page.locator('.leaflet-container').boundingBox()
  expect(box!.width).toBeGreaterThan(300)
  expect(box!.height).toBeGreaterThan(300)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  expect(hits.length).toBeGreaterThan(0)
  expect(hits.length).toBeLessThan(40) // una vista, no una descarga masiva
  expect(hits.every((u) => /\/1[3-8]\//.test(u))).toBe(true)
  expect(errors).toEqual([])
})

test('filtros por categoría compartibles por URL', async ({ page }) => {
  await stubTiles(page)
  await page.goto('/mapa')
  await page.getByRole('button', { name: /^Educación/ }).click()
  await expect(page).toHaveURL(/capas=educacion/)
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(6)
  await page.reload()
  await expect(page.getByRole('button', { name: /^Educación/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(6)
})

test('desde un marcador se llega a la ficha completa del lugar', async ({ page }) => {
  await stubTiles(page)
  await page.goto('/mapa?lugar=comisaria-rio-seco')
  const popup = page.locator('.leaflet-popup')
  await expect(popup).toContainText('Comisaría de Río Seco')
  await expect(popup.getByRole('link', { name: /Llamar al 03863-471081/ })).toHaveAttribute('href', 'tel:03863471081')
  await popup.getByRole('link', { name: 'Ver ficha' }).click()
  await expect(page).toHaveURL(/\/servicios\/comisaria-rio-seco$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Ficha del lugar' })).toBeVisible()
})

test('Servicios → «Ver en el mapa» centra el lugar', async ({ page }) => {
  await stubTiles(page)
  await page.goto('/servicios')
  await page.getByRole('link', { name: 'Ver Comuna de Río Seco en el mapa de Río Seco' }).click()
  await expect(page).toHaveURL(/\/mapa\?lugar=comuna-rio-seco/)
  await expect(page.locator('.leaflet-popup')).toContainText('Comuna de Río Seco')
})

test('si el proveedor de mapas falla, la pantalla avisa y las fichas y teléfonos siguen disponibles', async ({ page }) => {
  await stubTiles(page, 'fail')
  await page.goto('/mapa')
  await expect(page.getByRole('alert')).toContainText('No se pudo cargar el mapa base')
  await expect(page.getByRole('link', { name: 'Llamar a Comisaría de Río Seco' }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: /Ubicación pendiente \(2\)/ })).toBeVisible()
})

test('la ubicación se pide solo al tocar «Mi ubicación»', async ({ page, context }) => {
  await stubTiles(page)
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: -27.2687, longitude: -65.5585 })
  await page.addInitScript(() => {
    const orig = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation)
    ;(window as unknown as { __geoCalls: number }).__geoCalls = 0
    navigator.geolocation.getCurrentPosition = (...a) => {
      ;(window as unknown as { __geoCalls: number }).__geoCalls++
      return orig(...a)
    }
  })
  await page.goto('/mapa')
  await expect(page.locator('.leaflet-container')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls)).toBe(0)
  await page.getByRole('button', { name: /Mi ubicación/ }).click()
  await expect(page.getByText(/solo se usa en tu dispositivo/i)).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls)).toBe(1)
})

test('los marcadores se pueden recorrer con el teclado', async ({ page }) => {
  await stubTiles(page)
  await page.goto('/mapa')
  const marker = page.locator('.leaflet-marker-icon').first()
  await marker.focus()
  await expect(marker).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('.leaflet-popup')).toBeVisible()
})
