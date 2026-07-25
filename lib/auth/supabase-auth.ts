import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { serverEnv } from '@/lib/env'
import type { Role } from '@/lib/permissions/roles'
import type { AppUser } from './users'

/**
 * Production authentication via Supabase Auth. Active when Supabase is
 * configured; otherwise the demo cookie auth in ./session.ts is used. Roles come
 * from the `user_roles` table (joined through `profiles.auth_user_id`), so RBAC,
 * RLS, and audit all key off the real user + role.
 *
 * Cookie writes are wrapped in try/catch: in a Server Component render context
 * cookies() is read-only and throws on set — the middleware (middleware.ts)
 * refreshes the session so reads still see a fresh token.
 */
function serverSupabase() {
  const env = serverEnv()
  const store = cookies()
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => {
        try {
          toSet.forEach(({ name, value, options }) => store.set(name, value, options))
        } catch {
          /* read-only context (server component) — middleware handles refresh */
        }
      },
    },
  })
}

// Most-privileged role wins when a profile has several.
const ROLE_PRIORITY: Role[] = ['owner', 'admin', 'store_manager', 'finance', 'store_employee', 'read_only']

export async function supabaseSignIn(email: string, password: string): Promise<{ ok: boolean; message?: string }> {
  const supabase = serverSupabase()
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) return { ok: false, message: 'פרטי התחברות שגויים' }
  // Confirm the user has a profile + role; otherwise they aren't staff.
  const user = await supabaseCurrentUser()
  if (!user) {
    await supabase.auth.signOut()
    return { ok: false, message: 'לחשבון אין הרשאות צוות' }
  }
  return { ok: true }
}

export async function supabaseSignOut(): Promise<void> {
  await serverSupabase().auth.signOut()
}

export async function supabaseCurrentUser(): Promise<AppUser | null> {
  const supabase = serverSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, is_active')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!profile || !profile.is_active) return null

  // The roles lookup and the default-store lookup are independent — run them in
  // parallel instead of serially (this path runs on every admin page load).
  const [roleRes, locRes] = await Promise.all([
    supabase.from('user_roles').select('role').eq('profile_id', profile.id),
    // Default the acting store to the first active location (profiles carry no
    // location in the MVP schema); redemption records this on each transaction.
    supabase.from('store_locations').select('id').eq('is_active', true).limit(1).maybeSingle(),
  ])
  const roles = (roleRes.data ?? []).map((r) => r.role as Role)
  const role = ROLE_PRIORITY.find((r) => roles.includes(r))
  if (!role) return null
  const loc = locRes.data

  return {
    id: profile.id,
    email: profile.email,
    name: profile.full_name,
    role,
    storeLocationId: loc?.id ?? null,
    active: true,
  }
}
