import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let admin: SupabaseClient | null = null

/**
 * Server-side Supabase client using the SERVICE ROLE key. This bypasses RLS and
 * must NEVER be imported into client code. Privileged writes go through here;
 * public reads go through SECURITY DEFINER RPCs (get_public_gift_card).
 *
 * Reads the two Supabase vars directly (not via the full serverEnv validator)
 * so the data layer is not coupled to unrelated provider config — e.g. a missing
 * email key must never break gift-card reads. Payment/email/receipt env is
 * validated where those providers are actually used.
 */
export function supabaseAdmin(): SupabaseClient {
  if (admin) return admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Supabase is not configured (missing URL or service role key)')
  }
  admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return admin
}
