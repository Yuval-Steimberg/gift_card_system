import 'server-only'
import { getStore } from '@/lib/data'
import { getPaymentProvider } from '@/lib/payments'
import { generateGiftCardCode, generatePublicToken } from './codes'
import { canTransition } from './status'
import type { GiftCard, GiftCardStatus } from './types'
import { formatMoney, type Minor } from '@/lib/money'

interface Actor {
  actorId: string | null
  actorRole: string
  reason: string
}

/** Aggregate metrics for the dashboard overview. */
export interface AdminStats {
  /** Every card ever paid for (all time), refunds excluded. */
  soldTotal: number
  soldToday: number
  soldWeek: number
  soldMonth: number
  totalSalesMinor: Minor
  outstandingMinor: Minor
  redeemedMinor: Minor
  partiallyRedeemed: number
  fullyRedeemed: number
  active: number
  suspended: number
  refunded: number
  expiringSoon: number
  failedDeliveries: number
}

/** Paid-for cards that still hold (or held) value. Pre-payment drafts,
 *  failed/cancelled checkouts, refunds and voided reissues are NOT here. */
const PAID_STATUSES: GiftCardStatus[] = ['active', 'partially_redeemed', 'fully_redeemed', 'expired', 'suspended']

/**
 * Which cards are SALES — money actually taken from a customer.
 *
 * A reissue voids the old card (status `reissued`) and creates a new one with
 * the same initial amount and a fresh `issuedAt`. Counting the new card would
 * report a replacement as a brand-new sale today (and drop the original sale
 * date); so the sale stays on the ORIGINAL card and the replacement is skipped.
 */
export function salesCards(cards: GiftCard[]): GiftCard[] {
  const replacements = new Set(cards.map((c) => c.supersededByCardId).filter((id): id is string => !!id))
  return cards.filter(
    (c) => !replacements.has(c.id) && (PAID_STATUSES.includes(c.status) || c.status === 'reissued'),
  )
}

export async function getAdminStats(): Promise<AdminStats> {
  const store = getStore()
  const { items } = await store.listGiftCards({ limit: 100000 })
  const now = Date.now()
  const day = 86400000
  const stats: AdminStats = {
    soldTotal: 0,
    soldToday: 0,
    soldWeek: 0,
    soldMonth: 0,
    totalSalesMinor: 0,
    outstandingMinor: 0,
    redeemedMinor: 0,
    partiallyRedeemed: 0,
    fullyRedeemed: 0,
    active: 0,
    suspended: 0,
    refunded: 0,
    expiringSoon: 0,
    failedDeliveries: 0,
  }
  for (const c of salesCards(items)) {
    stats.soldTotal++
    stats.totalSalesMinor += c.initialAmountMinor
    const issued = c.issuedAt ? new Date(c.issuedAt).getTime() : null
    if (issued) {
      if (now - issued < day) stats.soldToday++
      if (now - issued < 7 * day) stats.soldWeek++
      if (now - issued < 30 * day) stats.soldMonth++
    }
  }
  for (const c of items) {
    // Value lives on the live card: a replacement carries the original initial
    // amount and the remaining balance, so initial − balance is what was spent;
    // the voided `reissued` card's balance was transferred, not redeemed.
    if (PAID_STATUSES.includes(c.status)) {
      stats.redeemedMinor += c.initialAmountMinor - c.balanceMinor
      if (c.status === 'active' || c.status === 'partially_redeemed' || c.status === 'suspended') {
        stats.outstandingMinor += c.balanceMinor
      }
    }
    if (c.status === 'active') stats.active++
    if (c.status === 'partially_redeemed') stats.partiallyRedeemed++
    if (c.status === 'fully_redeemed') stats.fullyRedeemed++
    if (c.status === 'suspended') stats.suspended++
    if (c.status === 'refunded') stats.refunded++
    if (
      c.expiresAt &&
      (c.status === 'active' || c.status === 'partially_redeemed') &&
      new Date(c.expiresAt).getTime() - now < 30 * day &&
      new Date(c.expiresAt).getTime() > now
    ) {
      stats.expiringSoon++
    }
  }
  // failed deliveries — one aggregate query instead of one lookup per card.
  stats.failedDeliveries = await store.countCardsWithFailedDelivery()
  return stats
}

export async function suspendCard(id: string, actor: Actor) {
  return getStore().transitionStatus(id, 'suspended', actor)
}
export async function reactivateCard(id: string, actor: Actor) {
  const card = await getStore().getGiftCardById(id)
  if (!card) return { ok: false, message: 'not found' }
  const to: GiftCardStatus = card.balanceMinor < card.initialAmountMinor ? 'partially_redeemed' : 'active'
  return getStore().transitionStatus(id, to, actor)
}
export async function cancelCard(id: string, actor: Actor) {
  return getStore().transitionStatus(id, 'cancelled', actor)
}

export type ProviderRefundOutcome = 'refunded' | 'failed' | 'not_attempted'

/**
 * Refund: zero the remaining value in the ledger, mark the card refunded, and
 * ask the payment provider to return the money.
 *
 * The provider step is best-effort and its outcome is RETURNED, never assumed:
 * this account runs Grow through Make with no GROW_* API keys, so the provider
 * call fails today and the money has to be returned in Grow by hand. A caller
 * must tell the person which one happened.
 *
 * Only the REMAINING balance goes back to the buyer — what was already spent in
 * the store is not refundable — which is also exactly what the ledger debits.
 */
export async function refundCard(
  id: string,
  actor: Actor,
): Promise<{ ok: boolean; message?: string; provider?: ProviderRefundOutcome; refundedMinor?: Minor }> {
  const store = getStore()
  const card = await store.getGiftCardById(id)
  if (!card) return { ok: false, message: 'not found' }
  // Check first: a debit followed by an illegal transition would leave a
  // zeroed card in its old status.
  if (!canTransition(card.status, 'refunded')) return { ok: false, message: `illegal transition ${card.status} -> refunded` }
  const remaining = card.balanceMinor
  const payment = await store.getPaymentByGiftCard(id)
  // Debit remaining balance to zero in the ledger.
  if (remaining > 0) {
    const adj = await store.applyLedgerAdjustment({
      giftCardId: id,
      type: 'refund_debit',
      magnitudeMinor: remaining,
      reason: actor.reason,
      createdBy: actor.actorId,
      idempotencyKey: `refund:${id}`,
    })
    if (!adj.ok) return { ok: false, message: adj.message }
  }
  const t = await store.transitionStatus(id, 'refunded', actor)
  if (!t.ok) return t

  // A manual activation has no provider charge to refund.
  let provider: ProviderRefundOutcome = 'not_attempted'
  let providerError: string | null = null
  if (remaining > 0 && payment?.providerPaymentId && payment.provider !== 'manual' && !payment.providerPaymentId.startsWith('manual_')) {
    try {
      const r = await getPaymentProvider().refundPayment({
        providerPaymentId: payment.providerPaymentId,
        amountMinor: remaining,
        currency: card.currency,
        reason: actor.reason,
      })
      provider = r.status === 'refunded' ? 'refunded' : 'failed'
    } catch (e) {
      provider = 'failed'
      providerError = e instanceof Error ? e.message : String(e)
    }
  }
  await store.appendAudit({
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    action: 'giftcard.provider_refund',
    entityType: 'gift_card',
    entityId: id,
    reason: actor.reason,
    metadata: { outcome: provider, amountMinor: remaining, error: providerError },
  })
  return { ok: true, provider, refundedMinor: remaining }
}

/** Never say "refunded" when the money did not go back: the provider step is separate. */
export function describeRefund(provider: ProviderRefundOutcome | undefined, refundedMinor: Minor | undefined): string {
  const amount = formatMoney(refundedMinor ?? 0)
  if (provider === 'refunded') return `השובר הוחזר ו-${amount} זוכו לקונה ב-Grow`
  if (!refundedMinor) return 'השובר סומן כמוחזר. לא נותרה יתרה להחזיר'
  return `השובר סומן כמוחזר והיתרה אופסה, אבל ${amount} לא הוחזרו אוטומטית. יש לבצע זיכוי ידני ב-Grow`
}

export async function reissueCard(id: string, actor: Actor): Promise<{ ok: boolean; newCard?: GiftCard; message?: string }> {
  return getStore().reissue(id, generateGiftCardCode(), generatePublicToken(), actor)
}

export async function adjustBalance(
  id: string,
  direction: 'increase' | 'decrease',
  amountMinor: Minor,
  actor: Actor,
  /** Same key twice = one adjustment (a retried request must not move money twice). */
  idempotencyKey?: string,
): Promise<{ ok: boolean; message?: string }> {
  return getStore().applyLedgerAdjustment({
    giftCardId: id,
    type: direction === 'increase' ? 'manual_increase' : 'manual_decrease',
    magnitudeMinor: amountMinor,
    reason: actor.reason,
    createdBy: actor.actorId,
    approvedBy: actor.actorId,
    idempotencyKey: idempotencyKey ?? null,
  })
}
