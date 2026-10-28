import { useState, type FormEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { formatTucuman } from '@/lib/tucuman'
import { api, type UserRow } from '../api'
import { useAuth } from '../auth'
import { Field, Notice, PageTitle, Select, TextInput, useAction, useAdminData } from '../ui'

const ROLE = { admin: 'Administrador', editor: 'Editor', viewer: 'Solo lectura' } as const

export function AccountPage() {
  const { admin } = useAuth()
  const act = useAction()
  const [f, setF] = useState({ currentPassword: '', newPassword: '', repeat: '' })
  const mismatch = f.newPassword !== f.repeat

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (mismatch) return
    const ok = await act.run(() => api.post('/password', { currentPassword: f.currentPassword, newPassword: f.newPassword }), 'Contraseña actualizada. Se cerraron tus otras sesiones.')
    if (ok) setF({ currentPassword: '', newPassword: '', repeat: '' })
  }
  return (
    <>
      <PageTitle title="Mi cuenta" />
      <Card className="mb-4 text-sm">
        <p>
          <strong>{admin?.displayName}</strong> · {admin?.email}
        </p>
        <p className="text-muted-foreground">Rol: {admin ? ROLE[admin.role] : ''}</p>
      </Card>
      <Card className="max-w-md space-y-3">
        <CardTitle>Cambiar contraseña</CardTitle>
        <form onSubmit={submit} className="space-y-3">
          {act.message && <Notice tone={act.message.tone}>{act.message.text}</Notice>}
          <Field label="Contraseña actual" htmlFor="cur">
            <TextInput id="cur" type="password" autoComplete="current-password" required value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
          </Field>
          <Field label="Contraseña nueva" htmlFor="new" hint="Mínimo 12 caracteres. Usá una frase larga que no uses en otros sitios.">
            <TextInput id="new" type="password" autoComplete="new-password" required minLength={12} value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
          </Field>
          <Field label="Repetir contraseña nueva" htmlFor="rep">
            <TextInput id="rep" type="password" autoComplete="new-password" required value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} />
          </Field>
          {mismatch && f.repeat && <Notice tone="error">Las contraseñas nuevas no coinciden.</Notice>}
          <Button type="submit" disabled={act.busy || mismatch}>
            Cambiar contraseña
          </Button>
        </form>
      </Card>
    </>
  )
}

export function UsersAdmin() {
  const { admin } = useAuth()
  const { data, error, loading, reload } = useAdminData(() => api.get<UserRow[]>('/users'))
  const act = useAction()
  const [f, setF] = useState({ email: '', displayName: '', role: 'editor', password: '' })

  const create = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await act.run(() => api.post('/users', f), 'Usuario creado. Compartile la contraseña inicial por un canal seguro y pedile que la cambie al ingresar.')
    if (ok) {
      setF({ email: '', displayName: '', role: 'editor', password: '' })
      reload()
    }
  }
  const patch = (u: UserRow, body: Record<string, unknown>, ok: string) => act.run(async () => { await api.patch(`/users/${u.id}`, body); reload() }, ok)

  return (
    <>
      <PageTitle title="Usuarios" />
      {act.message && <div className="mb-3"><Notice tone={act.message.tone}>{act.message.text}</Notice></div>}
      {loading && <p role="status">Cargando…</p>}
      {error && <Notice tone="error">{error.message}</Notice>}
      <ul className="mb-5 space-y-2">
        {data?.map((u) => (
          <li key={u.id}>
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {u.display_name} <span className="font-normal text-muted-foreground">· {u.email}</span>
                </p>
                <p className="text-xs text-muted-foreground">Último ingreso: {u.last_login_at ? formatTucuman(u.last_login_at) : 'nunca'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={u.active ? 'info' : 'danger'}>{u.active ? 'Activo' : 'Desactivado'}</Badge>
                <label className="sr-only" htmlFor={`role-${u.id}`}>
                  Rol de {u.display_name}
                </label>
                <Select id={`role-${u.id}`} className="min-h-9 w-auto py-0 text-sm" value={u.role} disabled={u.id === admin?.id || act.busy} onChange={(e) => void patch(u, { role: e.target.value }, 'Rol actualizado.')}>
                  {Object.entries(ROLE).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
                {u.id !== admin?.id && (
                  <Button size="sm" variant="outline" disabled={act.busy} onClick={() => void patch(u, { active: !u.active }, u.active ? 'Usuario desactivado y sesiones cerradas.' : 'Usuario reactivado.')}>
                    {u.active ? 'Desactivar' : 'Reactivar'}
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <Card className="max-w-lg space-y-3">
        <CardTitle>Nuevo usuario</CardTitle>
        <form onSubmit={create} className="space-y-3">
          <Field label="Correo electrónico" htmlFor="u-email">
            <TextInput id="u-email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Nombre" htmlFor="u-name">
            <TextInput id="u-name" required maxLength={100} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
          </Field>
          <Field label="Rol" htmlFor="u-role" hint="Editor: carga y modera contenido. Solo lectura: mira el panel sin modificar nada.">
            <Select id="u-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {Object.entries(ROLE).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Contraseña inicial" htmlFor="u-pass" hint="Mínimo 12 caracteres, única. La persona debe cambiarla al ingresar.">
            <TextInput id="u-pass" type="password" autoComplete="new-password" required minLength={12} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
          <Button type="submit" disabled={act.busy}>
            Crear usuario
          </Button>
        </form>
      </Card>
    </>
  )
}
