import { describe, it, expect, vi } from 'vitest'

// 2,500 rows behind a fake PostgREST that — like Supabase — never returns more
// than 1000 rows per request, whatever range was asked for.
const ROWS = Array.from({ length: 2500 }, (_, i) => ({ id: `id-${String(i).padStart(4, '0')}` }))
const MAX_ROWS = 1000
const requests: [number, number][] = []

function query() {
  const q = {
    select: () => q,
    eq: () => q,
    or: () => q,
    order: () => q,
    range: (from: number, to: number) => {
      requests.push([from, to])
      const data = ROWS.slice(from, Math.min(to + 1, from + MAX_ROWS))
      return Promise.resolve({ data, count: ROWS.length, error: null })
    },
  }
  return q
}

vi.mock('@/lib/data/supabase-client', () => ({ supabaseAdmin: () => ({ from: () => query() }) }))

describe('SupabaseStore.listGiftCards paging', () => {
  it('returns every card past the 1000-row PostgREST cap', async () => {
    const { SupabaseStore } = await import('@/lib/data/supabase-store')
    const store = new SupabaseStore()
    ;(store as unknown as { toCard: (r: unknown) => unknown }).toCard = (r) => r
    const { items, total } = await store.listGiftCards({ limit: 100000 })
    expect(total).toBe(2500)
    expect(items).toHaveLength(2500)
    expect(new Set(items.map((c) => c.id)).size).toBe(2500)
  })

  it('still honours a small page (admin list view)', async () => {
    requests.length = 0
    const { SupabaseStore } = await import('@/lib/data/supabase-store')
    const store = new SupabaseStore()
    ;(store as unknown as { toCard: (r: unknown) => unknown }).toCard = (r) => r
    const { items, total } = await store.listGiftCards({ limit: 50, offset: 100 })
    expect(total).toBe(2500)
    expect(items.map((c) => c.id)).toEqual(ROWS.slice(100, 150).map((r) => r.id))
    expect(requests).toEqual([[100, 149]])
  })
})
