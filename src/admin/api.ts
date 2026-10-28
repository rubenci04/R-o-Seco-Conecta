/**
 * Cliente de la API administrativa. La sesión viaja en una cookie HttpOnly (el código del navegador nunca ve el token
 * ni guarda credenciales) y cada modificación lleva la cabecera de protección CSRF.
 */
export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'AdminApiError'
  }
}

export interface Admin {
  id: number
  email: string
  displayName: string
  role: 'admin' | 'editor' | 'viewer'
}

export async function adminRequest<T = unknown>(method: string, path: string, body?: unknown, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<T> {
  let res: Response
  try {
    res = await fetchImpl(`/api/admin${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-rsc-csrf': '1', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new AdminApiError('No hay conexión con el servidor. Revisá tu conexión e intentá de nuevo.', 0)
  }
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* sin cuerpo JSON */
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Error ${res.status}`
    throw new AdminApiError(res.status === 401 ? 'Tu sesión venció. Iniciá sesión de nuevo.' : message, res.status)
  }
  return data as T
}

export const api = {
  get: <T,>(path: string) => adminRequest<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => adminRequest<T>('POST', path, body ?? {}),
  patch: <T,>(path: string, body: unknown) => adminRequest<T>('PATCH', path, body),
  del: <T,>(path: string) => adminRequest<T>('DELETE', path),
}

// ---- Tipos de las respuestas ----
export interface PostSummary {
  id: number
  title: string
  body: string
  url: string | null
  status: 'draft' | 'pending' | 'published' | 'rejected' | 'deleted'
  review_state: string
  origin: 'api' | 'assisted' | 'manual'
  published_at: string
  imported_at: string
  source_id: string
  rectification: string | null
  categories: { id: string; confidence: number; confirmed: boolean }[]
}
export interface PostDetail {
  post: PostSummary & { source_label: string | null; rectified_at: string | null }
  categories: { category_id: string; confidence: number; proposed_by: string; confirmed: number; reasons_json: string }[]
  history: { action: string; actor_label: string; note: string | null; at: string }[]
}
export interface AlertRow {
  id: number
  kind: string
  severity: 'info' | 'urgente'
  priority: number
  title: string
  body: string
  source_url: string | null
  starts_at: string
  expires_at: string | null
  confirmation: 'proposed' | 'confirmed' | 'dismissed'
  proposed_reason: string | null
}
export interface EventRow {
  id: number
  title: string
  description: string | null
  starts_at: string
  ends_at: string | null
  place_ref: string | null
  place_text: string | null
  category: 'evento' | 'festividad' | 'actividad'
  source_label: string
  source_url: string
  published: number
}
export interface ObituaryRow {
  id: number
  post_id: number | null
  name: string
  death_date: string | null
  message: string | null
  service_info: string | null
  source_url: string | null
  state: 'pending' | 'approved' | 'rejected' | 'retracted'
  rectification: string | null
  created_at: string
}
export interface SourceInfo {
  id: string
  name: string
  kind: string
  mode: string
  enabled: boolean
  status: string
  readiness: { ready: boolean; missing: string[] }
  lastSuccessAt: string | null
  lastCheckedAt: string | null
  nextAttemptAt: string | null
  lastError: string | null
}
export interface Dashboard {
  posts: { published: number; draft: number; pending: number; rejected: number; withdrawn: number; needsReview: number }
  alerts: { active: number; proposed: number }
  events: { upcoming: number; next: { id: number; title: string; starts_at: string }[] }
  obituaries: { pending: number }
  history: { entity_type: string; entity_id: string; action: string; actor_label: string; note: string | null; at: string }[]
  sources: SourceInfo[]
  generatedAt: string
}
export interface UserRow {
  id: number
  email: string
  display_name: string
  role: Admin['role']
  active: number
  last_login_at: string | null
}
