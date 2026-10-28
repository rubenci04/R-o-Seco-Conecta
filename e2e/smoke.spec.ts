import { expect, test } from '@playwright/test'

test('las pantallas principales cargan sin errores de consola', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  for (const [path, title] of [
    ['/', /Río Seco/],
    ['/colectivos', 'Colectivos'],
    ['/servicios', 'Servicios y lugares útiles'],
    ['/pueblo', 'Nuestro pueblo'],
    ['/radios', 'Radios'],
    ['/acerca', /Acerca/],
  ] as const) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(title)
  }
  expect(errors).toEqual([])
})

test('Inicio muestra la fotografía y horarios reales de colectivos', async ({ page }) => {
  await page.goto('/')
  const hero = page.getByRole('img', { name: /Cartel «Río Seco»/ })
  await expect(hero).toBeVisible()
  expect(await hero.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(100)
  await expect(page.getByRole('heading', { name: 'Próximo colectivo' })).toBeVisible()
  await expect(page.locator('ol li').first()).toContainText(/\d{2}:\d{2}/)
})

test('Colectivos: busca, invierte, comparte la consulta por URL y guarda favoritos', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
  await page.goto('/colectivos?modo=all')
  await expect(page.getByRole('heading', { name: /Todos los horarios/ })).toBeVisible()
  const cards = page.locator('article, [class*="rounded-"][class*="border"]').filter({ hasText: 'Exprebus' })
  expect(await cards.count()).toBeGreaterThan(20)
  await page.getByRole('button', { name: 'Invertir origen y destino' }).click()
  await expect(page).toHaveURL(/sentido=to-rio-seco/)
  await page.getByRole('button', { name: /Guardar ruta/ }).click()
  expect(await page.evaluate(() => localStorage.getItem('rsc-favoritos'))).toContain('to-rio-seco')
  await page.reload()
  await expect(page.getByRole('link', { name: /Concepción → Río Seco/ })).toBeVisible()
})

test('Servicios: llamar, mapas externos y datos pendientes', async ({ page }) => {
  await page.goto('/servicios')
  await expect(page.getByRole('link', { name: 'Llamar a Comisaría de Río Seco' })).toHaveAttribute('href', 'tel:03863471081')
  await expect(page.getByRole('link', { name: /Cómo llegar a Comisaría/ })).toHaveAttribute('href', /google\.com\/maps\/dir/)
  await expect(page.getByText(/pendiente de confirmación/).first()).toBeVisible()
})

test('modo oscuro cambia los colores y no hay desborde horizontal', async ({ page }) => {
  await page.goto('/')
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const light = await bg()
  await page.getByRole('button', { name: /modo oscuro/ }).first().click()
  await expect.poll(bg).not.toBe(light)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('PWA: manifiesto instalable e íconos accesibles', async ({ page, request }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const manifest = await (await request.get(href!)).json()
  expect(manifest.display).toBe('standalone')
  expect(manifest.theme_color).toBe('#1769a8')
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true)
  expect((await request.get('/favicon.ico')).ok()).toBe(true)
})
