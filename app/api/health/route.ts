import { NextResponse } from 'next/server'
import { getStore } from '@/lib/data'
import { isSupabaseConfigured } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Diagnostic endpoint. Reports which data store is active and whether the app
 * can actually read settings + templates from it — surfacing the real error
 * message (not just a digest) so misconfiguration is easy to pinpoint.
 *
 * Safe to expose: returns only booleans, counts, and error messages — never
 * secrets or customer data.
 */
export async function GET() {
  const health: Record<string, unknown> = {
    ok: false,
    store: isSupabaseConfigured() ? 'supabase' : 'memory',
    env: {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER ?? 'mock',
      EMAIL_PROVIDER: process.env.EMAIL_PROVIDER ?? 'log',
      APP_BASE_URL: Boolean(process.env.APP_BASE_URL),
    },
  }

  try {
    const store = getStore()
    const settings = await store.getSettings()
    const templates = await store.listTemplates(true)
    health.ok = true
    health.settingsLoaded = true
    health.templateCount = templates.length
    health.currency = settings.currency
    health.hint =
      templates.length === 0
        ? 'Settings loaded but no templates — run supabase/seed.sql.'
        : 'Data layer healthy.'
    return NextResponse.json(health)
  } catch (err) {
    health.ok = false
    health.error = err instanceof Error ? err.message : String(err)
    health.hint =
      'Reading from the store failed. If store=supabase: confirm the 3 migrations + seed.sql ran ' +
      'and SUPABASE_SERVICE_ROLE_KEY is correct. If store=memory: NEXT_PUBLIC_SUPABASE_URL / ' +
      'SUPABASE_SERVICE_ROLE_KEY are not both set.'
    return NextResponse.json(health, { status: 500 })
  }
}
