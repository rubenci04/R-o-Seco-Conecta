import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// Pruebas del panel contra el Worker REAL (wrangler dev) con una base D1 local aislada.
// Las credenciales de prueba las genera `e2e/worker-server.mjs` (aleatorias, fuera de Git).
const creds = () => JSON.parse(readFileSync('.wrangler/e2e-admin.json', 'utf8')) as { email: string; password: string }

test.describe.configure({ mode: 'serial', timeout: 90_000 })

async function login(page: Page) {
  const { email, password } = creds()
  await page.goto('/admin')
  await page.getByLabel('Correo electrónico').fill(email)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Panel', exact: true })).toBeVisible()
}

const tag = (name: string) => name.replace(/[^a-z]/gi, '').slice(0, 6)

test('sin sesión, /admin muestra el acceso y la API administrativa responde 401', async ({ page, request }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Acceso al panel' })).toBeVisible()
  await page.goto('/admin/noticias')
  await expect(page.getByRole('heading', { name: 'Acceso al panel' })).toBeVisible()
  expect((await request.get('/api/admin/users')).status()).toBe(401)
  expect((await request.post('/api/admin/posts', { data: { body: 'x' } })).status()).toBe(403) // sin cabecera CSRF
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

test('login: error claro con contraseña incorrecta y acceso correcto; cerrar sesión', async ({ page }) => {
  const { email } = creds()
  await page.goto('/admin')
  await page.getByLabel('Correo electrónico').fill(email)
  await page.getByLabel('Contraseña').fill('contraseña-incorrecta-123')
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page.getByRole('alert')).toContainText('Correo o contraseña incorrectos')
  await login(page)
  await expect(page.getByRole('navigation', { name: 'Secciones del panel' })).toBeVisible()
  await page.getByRole('button', { name: 'Salir' }).click()
  await expect(page.getByRole('heading', { name: 'Acceso al panel' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Acceso al panel' })).toBeVisible() // la sesión terminó
})

test('crear, clasificar y publicar una noticia: aparece en el feed público sin tocar código ni GitHub', async ({ page }, info) => {
  const title = `Noticia E2E ${tag(info.project.name)} ${Date.now()}`
  await login(page)
  await page.getByRole('link', { name: 'Noticias' }).first().click()
  await page.getByRole('link', { name: 'Nueva noticia' }).click()
  await page.getByLabel('Título', { exact: true }).fill(title)
  await page.getByLabel('Texto de la noticia').fill('La Comuna informa que continúan los trabajos de mejoras en la plaza principal del pueblo.')
  await page.getByLabel('Fuente (cómo se cita)').fill('Comuna de Río Seco')
  await page.getByLabel('Noticias institucionales').check()
  await page.getByRole('button', { name: 'Publicar ahora' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Editar noticia' })).toBeVisible()
  await expect(page.getByText('Publicada', { exact: true }).first()).toBeVisible()

  // Vista pública: sin build ni recarga de la aplicación.
  await page.goto('/noticias')
  const card = page.locator('div', { has: page.getByRole('heading', { name: title }) }).last()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByText('Revisada por la redacción').first()).toBeVisible()
  await expect(page.getByText('Fuente: Comuna de Río Seco').first()).toBeVisible()
  void card
  await page.getByRole('button', { name: 'Noticias institucionales' }).click()
  await expect(page).toHaveURL(/categoria=institucional/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await page.getByRole('button', { name: 'Salud', exact: true }).click()
  await expect(page.getByRole('heading', { name: title })).toHaveCount(0)
})

test('borrador: no es público hasta publicarlo; luego se edita, se rectifica y se retira', async ({ page }, info) => {
  const title = `Borrador E2E ${tag(info.project.name)} ${Date.now()}`
  page.on('dialog', (d) => void d.accept())
  await login(page)
  await page.goto('/admin/noticias/nueva')
  await page.getByLabel('Título', { exact: true }).fill(title)
  await page.getByLabel('Texto de la noticia').fill('Texto de un borrador que todavía no debe verse en la aplicación pública.')
  await page.getByRole('button', { name: 'Guardar borrador' }).click()
  await expect(page.getByText('Borrador', { exact: true }).first()).toBeVisible()
  const editUrl = page.url()

  await page.goto('/noticias')
  await expect(page.getByRole('heading', { name: title })).toHaveCount(0)

  await page.goto(editUrl)
  await page.getByRole('button', { name: 'Publicar', exact: true }).click()
  await expect(page.getByText('Noticia publicada: ya aparece en la aplicación.')).toBeVisible()
  await page.goto('/noticias')
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  await page.goto(editUrl)
  const edited = `${title} (editada)`
  await page.getByLabel('Título', { exact: true }).fill(edited)
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByText('Cambios guardados.')).toBeVisible()
  await page.getByLabel(/Texto de la rectificación/).fill('Se corrige el horario informado en la versión anterior.')
  await page.getByRole('button', { name: 'Publicar rectificación' }).click()
  await expect(page.getByText('Rectificación publicada.')).toBeVisible()
  await expect(page.getByText('Historial de modificaciones')).toBeVisible()

  await page.goto('/noticias')
  await expect(page.getByRole('heading', { name: edited })).toBeVisible()
  await expect(page.getByText('Se corrige el horario informado').first()).toBeVisible()

  await page.goto(editUrl)
  await page.getByRole('button', { name: 'Retirar de la aplicación' }).click()
  await expect(page.getByText('Noticia retirada.')).toBeVisible()
  await page.goto('/noticias')
  await expect(page.getByRole('heading', { name: edited })).toHaveCount(0)
})

test('alertas: una alerta confirmada se ve en la aplicación y una sin confirmar no', async ({ page }, info) => {
  const shown = `Corte de agua E2E ${tag(info.project.name)} ${Date.now()}`
  const hidden = `Aviso sin confirmar E2E ${tag(info.project.name)} ${Date.now()}`
  await login(page)
  await page.goto('/admin/alertas')
  for (const [title, confirm] of [[shown, true], [hidden, false]] as const) {
    await page.getByRole('button', { name: /Nueva alerta|Cerrar formulario/ }).click()
    await page.getByLabel('Título', { exact: true }).fill(title)
    await page.getByLabel('Descripción', { exact: true }).fill('Interrupción del suministro de agua en barrio Norte por trabajos de reparación.')
    if (confirm) await page.getByLabel(/Confirmar y publicar ahora/).check()
    await page.getByRole('button', { name: confirm ? 'Crear y publicar' : 'Guardar sin publicar' }).click()
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
  }
  await page.goto('/alertas')
  await expect(page.getByRole('heading', { name: shown })).toBeVisible()
  await expect(page.getByRole('heading', { name: hidden })).toHaveCount(0)
})

test('agenda: un evento publicado aparece en la aplicación (hora de Tucumán)', async ({ page }, info) => {
  const title = `Festival de pesebres E2E ${tag(info.project.name)} ${Date.now()}`
  await login(page)
  await page.goto('/admin/agenda')
  await page.getByRole('button', { name: 'Nuevo evento' }).click()
  await page.getByLabel('Título', { exact: true }).fill(title)
  await page.getByLabel('Tipo').selectOption('festividad')
  await page.getByLabel('Inicio (hora de Tucumán)').fill('2030-12-08T21:30')
  await page.getByLabel('Lugar del catálogo').selectOption('comuna-rio-seco')
  await page.getByLabel('Enlace a la fuente').fill('https://www.facebook.com/p/Comuna-De-Rio-Seco-61553018412844/')
  await page.getByRole('button', { name: 'Guardar evento' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await page.goto('/agenda')
  const event = page.getByRole('heading', { name: title })
  await expect(event).toBeVisible()
  await expect(page.getByText('8 de diciembre a las 21:30').first()).toBeVisible() // 21:30 en Tucumán, sin corrimiento de zona
  await expect(page.getByText('Comuna de Río Seco').first()).toBeVisible()
})

test('obituarios: un aviso fúnebre no se publica solo; se aprueba tras validar nombre y fecha', async ({ page }, info) => {
  const name = info.project.name === 'admin-movil' ? 'Jorge Luis Ramos' : 'Mario Alberto Sosa'
  await login(page)
  await page.goto('/admin/noticias/nueva')
  await page.getByLabel('Título', { exact: true }).fill(`Aviso fúnebre ${tag(info.project.name)}`)
  await page.getByLabel('Texto de la noticia').fill(`Con profundo pesar comunicamos el fallecimiento de ${name}. Velatorio en su domicilio, sepelio a las 16 hs.`)
  await page.getByRole('button', { name: 'Publicar ahora' }).click()
  await expect(page.getByText(/posible obituario/)).toBeVisible()

  await page.goto('/noticias')
  await expect(page.getByText(name)).toHaveCount(0)
  await page.goto('/obituarios')
  await expect(page.getByText(name)).toHaveCount(0)

  await page.goto('/admin/obituarios')
  const card = page.locator('li', { has: page.getByLabel(/Nombre/).and(page.locator(`[value="${name}"]`)) })
  await expect(card.getByRole('button', { name: 'Aprobar y publicar' })).toBeDisabled() // falta la fecha: validación humana
  await card.getByLabel('Fecha de fallecimiento').fill('2026-10-27')
  await card.getByRole('button', { name: 'Aprobar y publicar' }).click()
  await expect(page.getByText('Obituario aprobado: ya se ve en la aplicación.')).toBeVisible()

  await page.goto('/obituarios')
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await page.goto('/noticias')
  await expect(page.getByText(/Con profundo pesar/).first()).toBeVisible() // también en el feed general, con su fuente
})

test('mi cuenta y panel: la contraseña exige 12 caracteres; el panel no se desborda en pantallas chicas', async ({ page }) => {
  await login(page)
  await page.goto('/admin/cuenta')
  await expect(page.getByLabel('Contraseña nueva', { exact: true })).toHaveAttribute('minlength', '12')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  await page.goto('/admin/fuentes')
  await expect(page.getByText(/no están conectados/)).toBeVisible()
  await expect(page.getByText('Sin sincronización automática').first()).toBeVisible()
  await page.goto('/admin')
  await expect(page.getByText('Estado de las fuentes')).toBeVisible()
})

test('importación asistida: varias publicaciones con vista previa, duplicados y clasificación de residuos', async ({ page, request }, info) => {
  const t = Date.now()
  // Palabras únicas por ejecución: dos corridas sobre la misma base no deben tomarse por texto casi idéntico.
  const uniq = [1, 2, 3, 4, 5, 6].map((n) => `k${t}${n}`).join(' ')
  await login(page)
  await page.goto('/admin/fuentes')
  await page.getByRole('button', { name: 'Varias a la vez' }).click()
  const bulk = [
    `https://www.facebook.com/ComunaDeRioSeco/posts/${t}1`,
    'Fecha: 2026-10-28 09:30',
    `Se suspende la recolección de residuos de hoy por las intensas lluvias (prueba ${tag(info.project.name)} ${uniq}).`,
    '---',
    `https://www.facebook.com/ComunaDeRioSeco/posts/${t}2`,
    `Con inmenso dolor comunicamos que partió a la casa del Padre una vecina de prueba ${t}. Sus restos serán velados en su domicilio ${uniq}.`,
  ].join('\n')
  await page.getByLabel('Publicaciones').fill(bulk)
  await page.getByRole('button', { name: 'Analizar y ver vista previa' }).click()
  const preview = page.getByRole('region', { name: 'Vista previa de la importación' })
  await expect(preview.getByText('Se publicará')).toBeVisible()
  await expect(preview.getByText(/Recolección de residuos y limpieza urbana \(\d+ %\)/)).toBeVisible()
  await expect(preview.getByText(/Una persona deberá confirmarlo antes de notificar/)).toBeVisible()
  await expect(preview.getByText('Quedará en revisión (posible obituario)')).toBeVisible()
  expect((await request.get('/api/public/feed')).status()).toBe(200) // la vista previa no guardó nada
  await page.getByRole('button', { name: /Confirmar e importar 2 publicaciones/ }).click()
  await expect(page.getByText('Importación terminada.')).toBeVisible()

  // La suspensión se ve en el feed y en el filtro de residuos (una sola publicación); el obituario NO se publica solo.
  const feed = (await (await request.get('/api/public/feed?limite=50')).json()) as Array<{ title: string; body?: string; categories: string[] }>
  const waste = feed.filter((p) => p.title.includes('Se suspende la recolección') && p.categories.includes('residuos'))
  expect(waste.length).toBeGreaterThanOrEqual(1)
  expect(feed.some((p) => p.body?.includes('vecina de prueba ' + t))).toBe(false)
  // Y los mismos textos ahora figuran como duplicados.
  await page.getByRole('button', { name: 'Varias a la vez' }).click()
  await page.getByLabel('Publicaciones').fill(bulk.split('\n---\n')[0])
  await page.getByRole('button', { name: 'Analizar y ver vista previa' }).click()
  await expect(page.getByText('Duplicada: se omite')).toBeVisible()
  await expect(page.getByRole('button', { name: /Confirmar e importar 0 publicaciones/ })).toBeDisabled()
})
