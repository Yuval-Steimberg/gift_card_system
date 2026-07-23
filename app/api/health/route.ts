import { NextResponse } from 'next/server'
import { getStore } from '@/lib/data'
import { isSupabaseConfigured } from '@/lib/env'
import { supabaseAdmin } from '@/lib/data/supabase-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Diagnostic endpoint. Reports which data store is active and, for Supabase,
 * probes each key table so it's obvious whether the MIGRATIONS are missing
 * (table error) or just the SEED (table exists but empty). Returns only
 * booleans/counts/error text — never secrets or customer data.
 */
export async function GET() {
  const usingSupabase = isSupabaseConfigured()
  const health: Record<string, unknown> = {
    ok: false,
    store: usingSupabase ? 'supabase' : 'memory',
    env: {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER ?? 'mock',
      EMAIL_PROVIDER: process.env.EMAIL_PROVIDER ?? 'log',
      APP_BASE_URL: Boolean(process.env.APP_BASE_URL),
    },
  }

  if (usingSupabase) {
    // Probe each table: distinguish "migration missing" from "seed missing".
    const db = supabaseAdmin()
    const tables = ['system_settings', 'gift_card_templates', 'store_locations', 'gift_cards']
    const probe: Record<string, string> = {}
    let migrationsOk = true
    let seedOk = true
    for (const t of tables) {
      const { count, error } = await db.from(t).select('*', { head: true, count: 'exact' })
      if (error) {
        probe[t] = `MISSING (${error.message})`
        migrationsOk = false
      } else {
        probe[t] = `${count ?? 0} rows`
        if ((t === 'system_settings' || t === 'gift_card_templates') && (count ?? 0) === 0) seedOk = false
      }
    }
    health.tables = probe
    health.migrationsRan = migrationsOk
    health.seedRan = seedOk
    health.ok = migrationsOk && seedOk
    health.hint = !migrationsOk
      ? 'A table is missing — run supabase/migrations/0001_init.sql, 0002_rls.sql, 0003_functions.sql in order.'
      : !seedOk
        ? 'Tables exist but are empty — run supabase/seed.sql.'
        : 'Data layer healthy.'
    return NextResponse.json(health, { status: health.ok ? 200 : 500 })
  }

  // Memory store path.
  try {
    const store = getStore()
    const templates = await store.listTemplates(true)
    health.ok = true
    health.templateCount = templates.length
    health.hint = 'In-memory store (no Supabase configured). Data is ephemeral.'
    return NextResponse.json(health)
  } catch (err) {
    health.error = err instanceof Error ? err.message : String(err)
    return NextResponse.json(health, { status: 500 })
  }
}
