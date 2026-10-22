import 'server-only'
import { getStore } from '@/lib/data'
import { salesCards } from '@/lib/gift-cards/admin-service'
import type { GiftCard, Redemption } from '@/lib/gift-cards/types'

/**
 * Daily sales and redemptions for the JAS Command Center's analytics.
 *
 * "A sale" is salesCards() — the same definition the /admin dashboard and the
 * summary endpoint use — bucketed by the Israel date of `issuedAt`. A
 * redemption is a store redemption, bucketed by its own `createdAt`; a
 * redemption that was later reversed is reported separately, never as spent.
 * Counts and agorot only: no codes, tokens, names or email addresses.
 *
 * Like /admin, a card that was later refunded is not a sale, so a past day's
 * figure can go DOWN after a refund. Liability is not here: it is a balance
 * "now", and the summary endpoint already reports it.
 */
export const SALES_TZ = 'Asia/Jerusalem'
export const MAX_RANGE_DAYS = 366

export type LocalDate = string // YYYY-MM-DD

export interface SalesDay {
  date: LocalDate
  cardsSold: number
  salesMinor: number
  redemptions: number
  redeemedMinor: number
}

export interface SalesPeriod {
  from: LocalDate
  to: LocalDate
  totals: Omit<SalesDay, 'date'> & { reversedRedemptions: number; reversedMinor: number; averageCardMinor: number | null }
  daily: SalesDay[]
  byTemplate: { templateId: string; name: string; cardsSold: number; salesMinor: number }[]
}

export interface IntegrationSales {
  version: 1
  generatedAt: string
  timezone: string
  current: SalesPeriod
  previous: SalesPeriod
}

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: SALES_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
export const israelDay = (iso: string): LocalDate => dayFmt.format(new Date(iso))

export function addDays(d: LocalDate, n: number): LocalDate {
  const t = new Date(`${d}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
export const daysBetween = (from: LocalDate, to: LocalDate) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)

/** The equally long period immediately before [from, to]. */
export function previousRange(from: LocalDate, to: LocalDate): { from: LocalDate; to: LocalDate } {
  const len = daysBetween(from, to) + 1
  return { from: addDays(from, -len), to: addDays(from, -1) }
}

/** Pure: bucket already-loaded cards and redemptions into one period. */
export function bucketPeriod(
  from: LocalDate,
  to: LocalDate,
  cards: GiftCard[],
  redemptions: Redemption[],
  templateNames: Map<string, string>,
): SalesPeriod {
  const n = daysBetween(from, to) + 1
  const daily: SalesDay[] = Array.from({ length: n }, (_, i) => ({ date: addDays(from, i), cardsSold: 0, salesMinor: 0, redemptions: 0, redeemedMinor: 0 }))
  const byDate = new Map(daily.map((d) => [d.date, d]))
  const byTemplate = new Map<string, { cardsSold: number; salesMinor: number }>()
  let reversedRedemptions = 0
  let reversedMinor = 0

  for (const c of salesCards(cards)) {
    if (!c.issuedAt) continue
    const d = byDate.get(israelDay(c.issuedAt))
    if (!d) continue
    d.cardsSold++
    d.salesMinor += c.initialAmountMinor
    const t = byTemplate.get(c.templateId) ?? { cardsSold: 0, salesMinor: 0 }
    t.cardsSold++
    t.salesMinor += c.initialAmountMinor
    byTemplate.set(c.templateId, t)
  }
  for (const r of redemptions) {
    const d = byDate.get(israelDay(r.createdAt))
    if (!d) continue
    if (r.reversedByReversalId) {
      reversedRedemptions++
      reversedMinor += r.amountMinor
      continue
    }
    d.redemptions++
    d.redeemedMinor += r.amountMinor
  }

  const sum = (k: keyof Omit<SalesDay, 'date'>) => daily.reduce((s, d) => s + d[k], 0)
  const cardsSold = sum('cardsSold')
  const salesMinor = sum('salesMinor')
  return {
    from,
    to,
    totals: {
      cardsSold,
      salesMinor,
      redemptions: sum('redemptions'),
      redeemedMinor: sum('redeemedMinor'),
      reversedRedemptions,
      reversedMinor,
      averageCardMinor: cardsSold ? Math.round(salesMinor / cardsSold) : null,
    },
    daily,
    byTemplate: [...byTemplate.entries()]
      .map(([templateId, v]) => ({ templateId, name: templateNames.get(templateId) ?? templateId, ...v }))
      .sort((a, b) => b.salesMinor - a.salesMinor),
  }
}

export async function buildIntegrationSales(from: LocalDate, to: LocalDate, now = new Date()): Promise<IntegrationSales> {
  const prev = previousRange(from, to)
  const store = getStore()
  // Fetch a day either side in UTC: an Israel day starts at 21:00 or 22:00 UTC the day before.
  const [cards, redemptions, templates] = await Promise.all([
    store.listGiftCards({ limit: 100000 }),
    store.listRedemptionsBetween(`${addDays(prev.from, -1)}T00:00:00.000Z`, `${addDays(to, 2)}T00:00:00.000Z`),
    store.listTemplates(true),
  ])
  const names = new Map(templates.map((t) => [t.id, t.name]))
  return {
    version: 1,
    generatedAt: now.toISOString(),
    timezone: SALES_TZ,
    current: bucketPeriod(from, to, cards.items, redemptions, names),
    previous: bucketPeriod(prev.from, prev.to, cards.items, redemptions, names),
  }
}
