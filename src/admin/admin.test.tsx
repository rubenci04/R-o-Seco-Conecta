import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isoToLocalInput, localInputToIso, formatTucuman } from '@/lib/tucuman'
import { AdminApiError, adminRequest } from './api'
import AdminApp from './AdminApp'

interface Call {
  method: string
  path: string
  body: unknown
  headers: Record<string, string>
}

/** Servidor falso del panel: devuelve las respuestas por ruta y registra cada llamada. */
function fakeApi(routes: Record<string, (c: Call) => { status?: number; json?: unknown } | undefined>) {
  const calls: Call[] = []
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const call: Call = { method: init.method ?? 'GET', path: String(url).replace('/api/admin', ''), body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers as Record<string, string> }
    calls.push(call)
    const key = `${call.method} ${call.path.split('?')[0]}`
    const r = routes[key]?.(call) ?? { status: 404, json: { error: 'No encontrado' } }
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', impl)
  return calls
}

const admin = { id: 1, email: 'ana@example.test', displayName: 'Ana', role: 'admin' as const }
const dashboard = {
  posts: { published: 3, draft: 1, pending: 0, rejected: 0, withdrawn: 0, needsReview: 2 },
  alerts: { active: 1, proposed: 1 },
  events: { upcoming: 1, next: [{ id: 1, title: 'Fiesta', starts_at: '2030-12-09T00:30:00.000Z' }] },
  obituaries: { pending: 1 },
  history: [{ entity_type: 'post', entity_id: '5', action: 'published', actor_label: 'ana@example.test', note: null, at: '2026-10-28T15:00:00.000Z' }],
  sources: [{ id: 'facebook-comuna', name: 'Comuna · Facebook', kind: 'facebook', mode: 'manual', enabled: false, status: 'not-configured', readiness: { ready: false, missing: ['META_PAGE_ACCESS_TOKEN (secreto)'] }, lastSuccessAt: null, lastCheckedAt: null, nextAttemptAt: null, lastError: null }],
  generatedAt: '2026-10-28T15:00:00.000Z',
}

const renderAdmin = (path = '/admin') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="admin/*" element={<AdminApp />} />
      </Routes>
    </MemoryRouter>,
  )

afterEach(() => vi.unstubAllGlobals())

describe('hora de Tucumán en los formularios', () => {
  it('convierte entre datetime-local (UTC-3) e ISO sin corrimientos', () => {
    expect(localInputToIso('2026-12-08T21:30')).toBe('2026-12-09T00:30:00.000Z')
    expect(isoToLocalInput('2026-12-09T00:30:00.000Z')).toBe('2026-12-08T21:30')
    expect(isoToLocalInput(localInputToIso('2026-03-01T00:05'))).toBe('2026-03-01T00:05')
    expect(localInputToIso('mañana')).toBe('')
    expect(isoToLocalInput(null)).toBe('')
    expect(formatTucuman('2026-12-09T00:30:00.000Z')).toContain('21:30')
  })
})

describe('cliente de la API administrativa', () => {
  it('envía la cabecera CSRF y la cookie de sesión (mismo origen), sin guardar credenciales', async () => {
    const calls = fakeApi({ 'POST /posts': () => ({ json: { ok: true } }) })
    await adminRequest('POST', '/posts', { body: 'x' })
    expect(calls[0].headers['x-rsc-csrf']).toBe('1')
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' })
    expect(JSON.stringify(localStorage) + JSON.stringify(sessionStorage)).not.toMatch(/password|token|session/i)
  })
  it('traduce sesión vencida, permisos y fallas de red a mensajes claros', async () => {
    fakeApi({ 'GET /a': () => ({ status: 401, json: { error: 'x' } }), 'GET /b': () => ({ status: 403, json: { error: 'No tenés permiso para esta acción' } }) })
    await expect(adminRequest('GET', '/a')).rejects.toThrow('Tu sesión venció')
    const forbidden = (await adminRequest('GET', '/b').then(() => null, (e: unknown) => e)) as AdminApiError
    expect(forbidden.status).toBe(403)
    expect(forbidden.message).toBe('No tenés permiso para esta acción')
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(adminRequest('GET', '/c')).rejects.toThrow(/No hay conexión/)
  })
})

describe('acceso al panel', () => {
  it('sin sesión muestra el acceso; con credenciales incorrectas, un mensaje claro y sin revelar qué falló', async () => {
    const calls = fakeApi({ 'GET /me': () => ({ status: 401, json: { error: 'Sin sesión' } }), 'POST /login': () => ({ status: 401, json: { error: 'Credenciales inválidas' } }) })
    const user = userEvent.setup()
    renderAdmin()
    expect(await screen.findByRole('heading', { name: 'Acceso al panel' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@example.test')
    await user.type(screen.getByLabelText('Contraseña'), 'incorrecta-incorrecta')
    await user.click(screen.getByRole('button', { name: 'Ingresar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.')
    expect(screen.getByLabelText('Contraseña')).toHaveValue('') // se borra la contraseña tipeada
    expect(calls.find((c) => c.path === '/login')?.body).toEqual({ email: 'ana@example.test', password: 'incorrecta-incorrecta' })
  })
  it('una cuenta bloqueada informa el bloqueo temporal', async () => {
    fakeApi({ 'GET /me': () => ({ status: 401, json: {} }), 'POST /login': () => ({ status: 429, json: { error: 'bloqueada' } }) })
    const user = userEvent.setup()
    renderAdmin()
    await user.type(await screen.findByLabelText('Correo electrónico'), 'a@b.co')
    await user.type(screen.getByLabelText('Contraseña'), 'x')
    await user.click(screen.getByRole('button', { name: 'Ingresar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/bloqueada unos minutos/)
  })
  it('con sesión válida muestra el panel con los contadores, las fuentes sin credenciales y la actividad', async () => {
    fakeApi({ 'GET /me': () => ({ json: { admin } }), 'GET /dashboard': () => ({ json: dashboard }) })
    renderAdmin()
    expect(await screen.findByRole('heading', { level: 1, name: 'Panel' })).toBeInTheDocument()
    const summary = screen.getByRole('region', { name: 'Resumen' })
    expect(within(summary).getByText('Noticias publicadas').previousElementSibling).toHaveTextContent('3')
    expect(within(summary).getByText('Obituarios pendientes de revisión').previousElementSibling).toHaveTextContent('1')
    expect(screen.getByText('Sin credenciales')).toBeInTheDocument()
    expect(screen.getByText(/se carga manualmente desde el panel/)).toBeInTheDocument()
    expect(screen.getByText(/publicó noticia #5/)).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Secciones del panel' })).toBeInTheDocument()
  })
  it('cerrar sesión vuelve al acceso', async () => {
    const calls = fakeApi({ 'GET /me': () => ({ json: { admin } }), 'GET /dashboard': () => ({ json: dashboard }), 'POST /logout': () => ({ json: { ok: true } }) })
    const user = userEvent.setup()
    renderAdmin()
    await user.click(await screen.findByRole('button', { name: 'Salir' }))
    expect(await screen.findByRole('heading', { name: 'Acceso al panel' })).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/logout')).toBe(true)
  })
})

describe('permisos en la interfaz (el servidor los vuelve a comprobar siempre)', () => {
  it('«Usuarios» solo aparece para administradores', async () => {
    fakeApi({ 'GET /me': () => ({ json: { admin: { ...admin, role: 'editor' } } }), 'GET /dashboard': () => ({ json: dashboard }) })
    const first = renderAdmin()
    await screen.findByRole('heading', { level: 1, name: 'Panel' })
    expect(screen.queryByRole('link', { name: 'Usuarios' })).toBeNull()
    first.unmount()
    fakeApi({ 'GET /me': () => ({ json: { admin } }), 'GET /dashboard': () => ({ json: dashboard }) })
    renderAdmin()
    expect(await screen.findByRole('link', { name: 'Usuarios' })).toBeInTheDocument()
  })
  it('el rol de solo lectura no ve «Nueva noticia» ni puede editar', async () => {
    fakeApi({ 'GET /me': () => ({ json: { admin: { ...admin, role: 'viewer' } } }), 'GET /posts': () => ({ json: [] }) })
    renderAdmin('/admin/noticias')
    await screen.findByText('No hay noticias en esta vista.')
    expect(screen.queryByRole('link', { name: 'Nueva noticia' })).toBeNull()
  })
  it('una ruta de administración a la que el rol no accede muestra un aviso y no llama a la API', async () => {
    const calls = fakeApi({ 'GET /me': () => ({ json: { admin: { ...admin, role: 'editor' } } }) })
    renderAdmin('/admin/usuarios')
    expect(await screen.findByText('No tenés permiso para esta sección.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/users')).toBe(false)
  })
})

describe('crear y publicar una noticia desde el panel', () => {
  it('envía título, texto, fuente, categorías y fecha en hora de Tucumán; avisa si se propuso una alerta', async () => {
    const calls = fakeApi({
      'GET /me': () => ({ json: { admin } }),
      'POST /posts': () => ({ status: 201, json: { postId: 7, status: 'published', categories: ['agua'], alertId: 3, obituaryId: null } }),
      'GET /posts/7': () => ({ json: { post: { id: 7, title: 'Corte de agua', body: 'Texto', url: null, source_label: null, status: 'published', review_state: 'approved', origin: 'manual', published_at: '2026-10-28T15:00:00.000Z', imported_at: '2026-10-28T15:00:00.000Z', rectification: null, rectified_at: null, source_id: 'manual', categories: [] }, categories: [{ category_id: 'agua', confidence: 1, proposed_by: 'editor', confirmed: 1, reasons_json: '[]' }], history: [] } }),
    })
    const user = userEvent.setup()
    renderAdmin('/admin/noticias/nueva')
    await user.type(await screen.findByLabelText('Título', { exact: true }), 'Corte de agua')
    await user.type(screen.getByLabelText('Texto de la noticia'), 'Mañana habrá interrupción del suministro de agua en barrio Norte.')
    await user.type(screen.getByLabelText('Fuente (cómo se cita)'), 'Comuna de Río Seco')
    await user.click(screen.getByLabelText('Cortes de agua'))
    await user.click(screen.getByRole('button', { name: 'Publicar ahora' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/posts')).toBe(true))
    const post = calls.find((c) => c.method === 'POST' && c.path === '/posts')!.body as Record<string, unknown>
    expect(post).toMatchObject({ title: 'Corte de agua', sourceLabel: 'Comuna de Río Seco', categories: ['agua'], status: 'published' })
    expect(String(post.publishedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    // Se re-consulta el DOM en cada intento: la pantalla se vuelve a montar al pasar de «nueva» a la noticia creada.
    await waitFor(() => expect(screen.getByText(/Se propuso una alerta/)).toBeInTheDocument(), { timeout: 4000 })
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Editar noticia' })).toBeInTheDocument())
  })
  it('los botones de publicar y guardar borrador exigen texto', async () => {
    fakeApi({ 'GET /me': () => ({ json: { admin } }) })
    renderAdmin('/admin/noticias/nueva')
    expect(await screen.findByRole('button', { name: 'Publicar ahora' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeDisabled()
  })
  it('un posible obituario avisa que no se publica solo y queda en su cola', async () => {
    fakeApi({
      'GET /me': () => ({ json: { admin } }),
      'POST /posts': () => ({ status: 201, json: { postId: 8, status: 'pending', categories: ['obituarios'], alertId: null, obituaryId: 2 } }),
      'GET /posts/8': () => ({ json: { post: { id: 8, title: 'Aviso', body: 'x', url: null, source_label: null, status: 'pending', review_state: 'needs_review', origin: 'manual', published_at: '2026-10-28T15:00:00.000Z', imported_at: '2026-10-28T15:00:00.000Z', rectification: null, rectified_at: null, source_id: 'manual', categories: [] }, categories: [], history: [] } }),
    })
    const user = userEvent.setup()
    renderAdmin('/admin/noticias/nueva')
    await user.type(await screen.findByLabelText('Texto de la noticia'), 'Con profundo pesar comunicamos el fallecimiento de Juan Pérez.')
    await user.click(screen.getByRole('button', { name: 'Publicar ahora' }))
    await waitFor(() => expect(screen.getByText(/no se publica solo/)).toBeInTheDocument(), { timeout: 4000 })
  })
})

describe('obituarios en el panel: aprobación humana', () => {
  const o = { id: 1, post_id: 4, name: '', death_date: null, message: 'Comunicado', service_info: null, source_url: 'https://www.facebook.com/p/1', state: 'pending', rectification: null, created_at: '2026-10-28T15:00:00.000Z' }
  it('no permite aprobar sin nombre y fecha confirmados; con ambos aprueba tras guardar los datos validados', async () => {
    const calls = fakeApi({
      'GET /me': () => ({ json: { admin } }),
      'GET /obituaries': () => ({ json: [o] }),
      'PATCH /obituaries/1': () => ({ json: { ok: true } }),
      'POST /obituaries/1/approve': () => ({ json: { ok: true } }),
    })
    const user = userEvent.setup()
    renderAdmin('/admin/obituarios')
    const approve = await screen.findByRole('button', { name: 'Aprobar y publicar' })
    expect(approve).toBeDisabled()
    expect(screen.getByText(/No se publica solo/)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Nombre/), 'Juan Carlos Pérez')
    await user.type(screen.getByLabelText('Fecha de fallecimiento'), '2026-10-27')
    expect(approve).toBeEnabled()
    await user.click(approve)
    await waitFor(() => expect(calls.some((c) => c.path === '/obituaries/1/approve')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ name: 'Juan Carlos Pérez', deathDate: '2026-10-27' })
    const order = calls.filter((c) => c.path.startsWith('/obituaries/1')).map((c) => c.method + c.path)
    expect(order).toEqual(['PATCH/obituaries/1', 'POST/obituaries/1/approve']) // primero se guardan los datos validados
  })
})

describe('fuentes: estado honesto de Facebook e Instagram', () => {
  it('indica que no están conectadas, qué falta y que no hay sincronización automática', async () => {
    fakeApi({
      'GET /me': () => ({ json: { admin } }),
      'GET /sources': () => ({ json: dashboard.sources.map((s) => ({ ...s, automatic: false })) }),
      'GET /sync-runs': () => ({ json: [] }),
    })
    renderAdmin('/admin/fuentes')
    expect(await screen.findByText('Sin sincronización automática')).toBeInTheDocument() // espera a que carguen las fuentes
    expect(screen.getByText(/Facebook e Instagram todavía/)).toBeInTheDocument()
    expect(screen.getByText('no están conectados')).toBeInTheDocument()
    expect(screen.getByText(/META_PAGE_ACCESS_TOKEN/)).toBeInTheDocument()
    expect(screen.getByText('Nunca')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sincronizar ahora' })).toBeDisabled() // sin credenciales no se puede sincronizar
    expect(screen.getByText('Sin errores registrados.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Importar publicaciones de Facebook o Instagram' })).toBeInTheDocument()
  })
})
