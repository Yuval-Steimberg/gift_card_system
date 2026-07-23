import 'server-only'
import { isSupabaseConfigured } from '@/lib/env'
import { MemoryStore } from './memory-store'
import { SupabaseStore } from './supabase-store'
import type { GiftCardStore } from './store'

/**
 * Store resolution.
 *
 * - Default / local dev / tests: MemoryStore — seeded, fully offline, atomic
 *   ops serialized by a per-card mutex. This is the reference data layer for
 *   the MVP and the target of the financial integration tests.
 * - Production: when Supabase is configured, the SupabaseStore is used. Its
 *   atomic redemption is delegated to the `redeem_gift_card()` Postgres
 *   function (SELECT … FOR UPDATE) created by the migrations in supabase/.
 *
 * The MemoryStore is a process-global singleton so state persists across
 * requests within a running dev server.
 */
let store: GiftCardStore | null = null

export function getStore(): GiftCardStore {
  if (store) return store
  if (isSupabaseConfigured()) {
    store = new SupabaseStore()
  } else {
    if (process.env.NODE_ENV === 'production') {
      // MemoryStore is per-instance and resets on cold start — unusable for a
      // real/shared deployment. Warn loudly so a misconfigured deploy is obvious.
      // eslint-disable-next-line no-console
      console.warn(
        '[data] NODE_ENV=production but Supabase is not configured — using the in-memory ' +
          'store. Data will NOT persist or be shared across instances. Set ' +
          'NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for a real deployment.',
      )
    }
    store = new MemoryStore()
  }
  return store
}

/** Test helper to reset the in-memory singleton between tests. */
export function _resetStore(): void {
  store = null
}

export type { GiftCardStore } from './store'
export * from './store'
