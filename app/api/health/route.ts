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
    // Bump this marker when deploying a fix so you can confirm the LIVE build.
    build: 'auth-decoupled-v1',
    store: usingSupabase ? 'supabase' : 'memory',
    env: {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER ?? 'mock',
      EMAIL_PROVIDER: process.env.EMAIL_PROVIDER ?? 'log',
      APP_BASE_URL: Boolean(process.env.APP_BASE_URL),
      // Which staff password applies on THIS running deployment:
      //  true  -> log in with your AUTH_DEMO_PASSWORD value
      //  false -> log in with the literal password: "password"
      AUTH_DEMO_PASSWORD_SET: Boolean(process.env.AUTH_DEMO_PASSWORD),
      // Length of the stored staff password after trimming — a diagnostic to
      // catch wrapping quotes / stray characters (compare to what you expect).
      AUTH_DEMO_PASSWORD_LEN: (process.env.AUTH_DEMO_PASSWORD ?? '').trim().length,
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

    // Exercise the actual admin read path so any adapter bug surfaces here
    // (with the real message) instead of only as a page-level 500 digest.
    const checks: Record<string, string> = {}
    // Auth path: serverEnv() must not throw (this was the admin-500 root cause).
    try {
      const { serverEnv } = await import('@/lib/env')
      serverEnv()
      const { getCurrentUser } = await import('@/lib/auth/session')
      await getCurrentUser()
      checks.authLayer = 'ok'
    } catch (e) {
      checks.authLayer = `ERROR: ${e instanceof Error ? e.message : String(e)}`
    }
    try {
      const store = getStore()
      const list = await store.listGiftCards({ limit: 5 })
      checks.listGiftCards = `ok (${list.total} total)`
    } catch (e) {
      checks.listGiftCards = `ERROR: ${e instanceof Error ? e.message : String(e)}`
    }
    try {
      const { getAdminStats } = await import('@/lib/gift-cards/admin-service')
      const stats = await getAdminStats()
      checks.adminStats = `ok (active=${stats.active})`
    } catch (e) {
      checks.adminStats = `ERROR: ${e instanceof Error ? e.message : String(e)}`
    }
    try {
      const store = getStore()
      const first = (await store.listGiftCards({ limit: 1 })).items[0]
      if (first) {
        await store.getLedger(first.id)
        await store.getRedemptions(first.id)
        await store.getAudit('gift_card', first.id)
        await store.getDeliveryJobs(first.id)
        checks.cardDetailQueries = 'ok'
      } else {
        checks.cardDetailQueries = 'skipped (no cards)'
      }
    } catch (e) {
      checks.cardDetailQueries = `ERROR: ${e instanceof Error ? e.message : String(e)}`
    }
    health.checks = checks
    const checksOk = Object.values(checks).every((v) => !v.startsWith('ERROR'))

    health.ok = migrationsOk && seedOk && checksOk
    health.hint = !migrationsOk
      ? 'A table is missing — run supabase/setup.sql (or the 3 migrations in order).'
      : !seedOk
        ? 'Tables exist but are empty — run supabase/seed.sql.'
        : !checksOk
          ? 'Tables are healthy but an admin query failed — see checks[] for the exact error.'
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
