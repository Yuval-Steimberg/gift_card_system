import 'server-only'
import { redirect } from 'next/navigation'
import { hasPermission, type Permission, type Role } from '@/lib/permissions/roles'
import { getCurrentUser } from './session'
import type { AppUser } from './users'

export class AuthorizationError extends Error {
  constructor(message = 'Not authorized') {
    super(message)
    this.name = 'AuthorizationError'
  }
}

/** Require a logged-in user or redirect to the login page. */
export async function requireUser(loginPath = '/employee/login'): Promise<AppUser> {
  const user = await getCurrentUser()
  if (!user) redirect(loginPath)
  return user
}

/** Require one of the allowed roles or redirect. */
export async function requireRole(roles: Role[], loginPath = '/employee/login'): Promise<AppUser> {
  const user = await requireUser(loginPath)
  if (!roles.includes(user.role)) redirect(loginPath)
  return user
}

/**
 * Server-side permission assertion for actions (throws — never trust the UI).
 * Returns the user so callers can record the actor in the audit log.
 */
export async function assertPermission(permission: Permission): Promise<AppUser> {
  const user = await getCurrentUser()
  if (!user) throw new AuthorizationError('Not authenticated')
  if (!hasPermission(user.role, permission)) throw new AuthorizationError(`Missing permission: ${permission}`)
  return user
}
