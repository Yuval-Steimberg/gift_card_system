import 'server-only'
import { getStore } from '@/lib/data'
import type { DeliveryJob } from '@/lib/data/store'
import type { GiftCard, GiftCardStatus } from '@/lib/gift-cards/types'

/**
 * Card views for the JAS Command Center. The redemption CODE never leaves in
 * full (only its last 4 characters) and the public token never leaves at all:
 * either one is enough to spend the card. Contact details are included; the
 * command center shows them only to roles allowed to read customer data.
 */
export function maskCode(code: string): string {
  const tail = code.replace(/[^A-Za-z0-9]/g, '').slice(-4)
  return `••••-${tail}`
}

export interface IntegrationCardRow {
  id: string
  maskedCode: string
  status: GiftCardStatus
  initialAmountMinor: number
  balanceMinor: number
  templateId: string
  buyerName: string | null
  buyerEmail: string
  recipientName: string
  recipientEmail: string
  scheduledDeliveryAt: string | null
  issuedAt: string | null
  expiresAt: string | null
  createdAt: string
}

const row = (c: GiftCard): IntegrationCardRow => ({
  id: c.id,
  maskedCode: maskCode(c.code),
  status: c.status,
  initialAmountMinor: c.initialAmountMinor,
  balanceMinor: c.balanceMinor,
  templateId: c.templateId,
  buyerName: c.buyerName,
  buyerEmail: c.buyerEmail,
  recipientName: c.recipientName,
  recipientEmail: c.recipientEmail,
  scheduledDeliveryAt: c.scheduledDeliveryAt,
  issuedAt: c.issuedAt,
  expiresAt: c.expiresAt,
  createdAt: c.createdAt,
})

export const MAX_SEARCH_LIMIT = 50

/** The same search /admin's card list runs (code, names, emails, phones). */
export async function searchCards(query: string, opts: { status?: GiftCardStatus; limit?: number; offset?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), MAX_SEARCH_LIMIT)
  // The Supabase store puts the term inside a PostgREST or(...) filter: a comma or
  // parenthesis would end that filter early, and % / * / \ are pattern characters.
  const term = query.replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
  const { items, total } = await getStore().listGiftCards({ query: term || undefined, status: opts.status, limit, offset: Math.max(opts.offset ?? 0, 0) })
  return { total, items: items.map(row) }
}

const job = (j: DeliveryJob) => ({ id: j.id, channel: j.channel, status: j.status, attempts: j.attempts, lastError: j.lastError, scheduledFor: j.scheduledFor, createdAt: j.createdAt, updatedAt: j.updatedAt })

export async function cardDetail(id: string) {
  const store = getStore()
  const card = await store.getGiftCardById(id)
  if (!card) return null
  const [jobs, ledger, redemptions, payment, audit] = await Promise.all([
    store.getDeliveryJobs(id),
    store.getLedger(id),
    store.getRedemptions(id),
    store.getPaymentByGiftCard(id),
    store.getAudit('gift_card', id),
  ])
  return {
    card: { ...row(card), buyerPhone: card.buyerPhone, recipientPhone: card.recipientPhone, greeting: card.greeting, supersededByCardId: card.supersededByCardId },
    payment: payment ? { provider: payment.provider, status: payment.status, amountMinor: payment.amountMinor, createdAt: payment.createdAt } : null,
    delivery: jobs.map(job),
    ledger: ledger.map((l) => ({ id: l.id, type: l.type, amountMinor: l.amountMinor, balanceAfterMinor: l.balanceAfterMinor, reason: l.reason, createdAt: l.createdAt })),
    redemptions: redemptions.map((r) => ({ id: r.id, amountMinor: r.amountMinor, balanceAfterMinor: r.balanceAfterMinor, reversed: Boolean(r.reversedByReversalId), createdAt: r.createdAt })),
    audit: audit.map((a) => ({ action: a.action, actorRole: a.actorRole, reason: a.reason, createdAt: a.createdAt })),
  }
}
