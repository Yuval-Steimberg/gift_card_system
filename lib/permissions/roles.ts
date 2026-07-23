/**
 * Role-based access control. Permissions are enforced SERVER-SIDE on every
 * protected action (hiding a button is never authorization). The UI may read
 * these to hide controls, but server actions/route handlers must call
 * `assertPermission` independently.
 */

export type Role = 'owner' | 'admin' | 'store_manager' | 'store_employee' | 'finance' | 'read_only'

export const ROLES: Role[] = ['owner', 'admin', 'store_manager', 'store_employee', 'finance', 'read_only']

export type Permission =
  // redemption
  | 'redemption:perform'
  | 'redemption:reverse'
  // gift card management
  | 'giftcard:read'
  | 'giftcard:resend'
  | 'giftcard:edit_recipient'
  | 'giftcard:suspend'
  | 'giftcard:cancel'
  | 'giftcard:reissue'
  | 'giftcard:adjust_balance'
  | 'giftcard:refund'
  | 'giftcard:add_note'
  // templates + settings
  | 'template:manage'
  | 'settings:manage'
  // people
  | 'employee:manage'
  // finance
  | 'finance:view'
  | 'export:financial'
  // audit
  | 'audit:read'

const OWNER_PERMS: Permission[] = [
  'redemption:perform',
  'redemption:reverse',
  'giftcard:read',
  'giftcard:resend',
  'giftcard:edit_recipient',
  'giftcard:suspend',
  'giftcard:cancel',
  'giftcard:reissue',
  'giftcard:adjust_balance',
  'giftcard:refund',
  'giftcard:add_note',
  'template:manage',
  'settings:manage',
  'employee:manage',
  'finance:view',
  'export:financial',
  'audit:read',
]

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: OWNER_PERMS,
  // Admin has the full operational permission set (owner-only distinctions,
  // e.g. transferring ownership, are not modeled in the MVP).
  admin: OWNER_PERMS,
  store_manager: [
    'redemption:perform',
    'redemption:reverse',
    'giftcard:read',
    'giftcard:add_note',
    'employee:manage',
    'audit:read',
  ],
  store_employee: ['redemption:perform', 'giftcard:read'],
  finance: ['giftcard:read', 'finance:view', 'export:financial', 'audit:read'],
  read_only: ['giftcard:read', 'audit:read'],
}

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? []
}

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false
  return permissionsForRole(role).includes(permission)
}

export function hasAnyRole(role: Role | null | undefined, allowed: Role[]): boolean {
  return Boolean(role && allowed.includes(role))
}

export const ROLE_LABEL_HE: Record<Role, string> = {
  owner: 'בעלים',
  admin: 'מנהל מערכת',
  store_manager: 'מנהל חנות',
  store_employee: 'עובד חנות',
  finance: 'כספים',
  read_only: 'צפייה בלבד',
}
