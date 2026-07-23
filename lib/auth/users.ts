import type { Role } from '@/lib/permissions/roles'
import { DEMO_USERS } from '@/lib/data/seed-data'

export interface AppUser {
  id: string
  email: string
  name: string
  role: Role
  storeLocationId: string | null
  active: boolean
}

/**
 * Demo user directory for the offline/local auth layer. In production this is
 * replaced by Supabase Auth (profiles + user_roles); see docs/roles-and-permissions.md.
 *
 * ALL demo accounts share the password below — for LOCAL DEVELOPMENT ONLY.
 */
export const DEMO_PASSWORD = 'password'

export const DEMO_USER_LIST: AppUser[] = [
  { id: DEMO_USERS.owner, email: 'owner@justasecond.example', name: 'נעה ברנט', role: 'owner', storeLocationId: 'store-tlv', active: true },
  { id: DEMO_USERS.admin, email: 'admin@justasecond.example', name: 'אדמין', role: 'admin', storeLocationId: 'store-tlv', active: true },
  { id: DEMO_USERS.manager, email: 'manager@justasecond.example', name: 'מנהל חנות', role: 'store_manager', storeLocationId: 'store-tlv', active: true },
  { id: DEMO_USERS.employee1, email: 'employee1@justasecond.example', name: 'עובד/ת א׳', role: 'store_employee', storeLocationId: 'store-tlv', active: true },
  { id: DEMO_USERS.employee2, email: 'employee2@justasecond.example', name: 'עובד/ת ב׳', role: 'store_employee', storeLocationId: 'store-tlv', active: true },
  { id: DEMO_USERS.finance, email: 'finance@justasecond.example', name: 'כספים', role: 'finance', storeLocationId: null, active: true },
]

export function findDemoUserByEmail(email: string): AppUser | null {
  const e = email.trim().toLowerCase()
  return DEMO_USER_LIST.find((u) => u.email.toLowerCase() === e) ?? null
}

export function findDemoUserById(id: string): AppUser | null {
  return DEMO_USER_LIST.find((u) => u.id === id) ?? null
}
