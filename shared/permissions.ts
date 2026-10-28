export type Role = 'admin' | 'editor' | 'viewer'

export const PERMISSIONS = [
  'content:read',
  'content:write', // crear/editar noticias, eventos, lugares, radios, horarios
  'content:delete',
  'obituary:approve',
  'alert:confirm',
  'alert:confirm-urgent', // habilita notificaciones masivas
  'sources:read',
  'sources:manage', // activar conectores, sincronizar manualmente
  'users:manage',
] as const
export type Permission = (typeof PERMISSIONS)[number]

const MATRIX: Record<Role, readonly Permission[]> = {
  viewer: ['content:read', 'sources:read'],
  editor: ['content:read', 'content:write', 'content:delete', 'obituary:approve', 'alert:confirm', 'alert:confirm-urgent', 'sources:read'],
  admin: PERMISSIONS,
}

export const can = (role: Role | undefined, permission: Permission): boolean => !!role && MATRIX[role].includes(permission)
