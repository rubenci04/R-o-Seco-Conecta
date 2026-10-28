import { expect, test } from '@playwright/test'

// Widget oficial de Facebook y página de residuos (PWA estática, datos locales). El widget real se verificó a mano en un
// navegador real; acá se comprueba el comportamiento de la aplicación SIN depender de que Facebook responda.

test('Noticias: no se contacta a Facebook hasta que la persona lo pide; luego se incrusta el widget oficial', async ({ page }) => {
  const toFacebook: string[] = []
  await page.route('https://www.facebook.com/**', (route) => {
    toFacebook.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>widget simulado</body></html>' })
  })
  await page.goto('/noticias')
  await expect(page.getByText(/Contenido proporcionado por Facebook/)).toBeVisible()
  expect(toFacebook).toHaveLength(0)
  await page.getByRole('button', { name: 'Ver publicaciones de Facebook' }).click()
  const frame = page.locator('iframe[title*="Facebook"]')
  await expect(frame).toBeVisible()
  await expect.poll(() => toFacebook.length).toBeGreaterThan(0)
  expect(toFacebook[0]).toContain('/plugins/page.php')
  expect(decodeURIComponent(toFacebook[0])).toContain('Comuna-De-Rio-Seco-61553018412844')
  await expect(page.getByRole('link', { name: /Abrir la página de la Comuna en Facebook/ }).first()).toHaveAttribute('href', /facebook\.com\/p\/Comuna-De-Rio-Seco/)
})

test('si Facebook está bloqueado o no responde, queda el aviso y el enlace directo (sin cronología falsa)', async ({ page }) => {
  await page.route('https://www.facebook.com/**', (route) => route.abort())
  await page.goto('/noticias')
  await page.getByRole('button', { name: 'Ver publicaciones de Facebook' }).click()
  await expect(page.getByText(/bloqueando el contenido de Facebook|no respondió/)).toBeVisible()
  await expect(page.getByRole('link', { name: /Abrir la página de la Comuna en Facebook/ }).first()).toBeVisible()
})

test('Inicio incluye la sección «Desde Facebook» y no se desborda', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Desde Facebook' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})

test('/residuos: sin datos confirmados no inventa días ni horarios y enlaza a Servicios y Noticias', async ({ page }) => {
  await page.goto('/residuos')
  await expect(page.getByRole('heading', { name: 'Recolección de residuos y limpieza urbana', level: 1 })).toBeVisible()
  await expect(page.getByText('Todavía no hay días ni horarios confirmados')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
  await page.goto('/servicios')
  await page.getByRole('link', { name: 'Recolección de residuos y limpieza urbana' }).click()
  await expect(page).toHaveURL(/\/residuos$/)
  await page.goto('/noticias')
  await page.getByRole('button', { name: 'Recolección de residuos y limpieza urbana' }).click()
  await expect(page).toHaveURL(/categoria=residuos/)
})
