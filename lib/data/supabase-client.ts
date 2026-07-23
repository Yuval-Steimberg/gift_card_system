import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env'

let admin: SupabaseClient | null = null

/**
 * Server-side Supabase client using the SERVICE ROLE key. This bypasses RLS and
 * must NEVER be imported into client code. Privileged writes go through here;
 * public reads go through SECURITY DEFINER RPCs (get_public_gift_card).
 */
export function supabaseAdmin(): SupabaseClient {
  if (admin) return admin
  const env = serverEnv()
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase is not configured (missing URL or service role key)')
  }
  admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return admin
}
