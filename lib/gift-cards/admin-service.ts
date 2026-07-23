import 'server-only'
import { getStore } from '@/lib/data'
import { getPaymentProvider } from '@/lib/payments'
import { generateGiftCardCode, generatePublicToken } from './codes'
import type { GiftCard, GiftCardStatus } from './types'
import type { Minor } from '@/lib/money'

interface Actor {
  actorId: string
  actorRole: string
  reason: string
}

/** Aggregate metrics for the dashboard overview. */
export interface AdminStats {
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

export async function getAdminStats(): Promise<AdminStats> {
  const store = getStore()
  const { items } = await store.listGiftCards({ limit: 100000 })
  const now = Date.now()
  const day = 86400000
  const stats: AdminStats = {
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
  const paidStatuses: GiftCardStatus[] = ['active', 'partially_redeemed', 'fully_redeemed', 'expired', 'suspended']
  for (const c of items) {
    const issued = c.issuedAt ? new Date(c.issuedAt).getTime() : null
    if (paidStatuses.includes(c.status)) {
      stats.totalSalesMinor += c.initialAmountMinor
      stats.redeemedMinor += c.initialAmountMinor - c.balanceMinor
      if (c.status === 'active' || c.status === 'partially_redeemed' || c.status === 'suspended') {
        stats.outstandingMinor += c.balanceMinor
      }
      if (issued) {
        if (now - issued < day) stats.soldToday++
        if (now - issued < 7 * day) stats.soldWeek++
        if (now - issued < 30 * day) stats.soldMonth++
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
  // failed deliveries
  for (const c of items) {
    const jobs = await store.getDeliveryJobs(c.id)
    if (jobs.some((j) => j.status === 'failed')) stats.failedDeliveries++
  }
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

/** Refund: reverse remaining value via provider + ledger + status. */
export async function refundCard(id: string, actor: Actor): Promise<{ ok: boolean; message?: string }> {
  const store = getStore()
  const card = await store.getGiftCardById(id)
  if (!card) return { ok: false, message: 'not found' }
  const payment = await store.getPaymentByGiftCard(id)
  // Debit remaining balance to zero in the ledger.
  if (card.balanceMinor > 0) {
    const adj = await store.applyLedgerAdjustment({
      giftCardId: id,
      type: 'refund_debit',
      magnitudeMinor: card.balanceMinor,
      reason: actor.reason,
      createdBy: actor.actorId,
      idempotencyKey: `refund:${id}`,
    })
    if (!adj.ok) return { ok: false, message: adj.message }
  }
  // Best-effort provider refund.
  try {
    if (payment?.providerPaymentId) {
      await getPaymentProvider().refundPayment({
        providerPaymentId: payment.providerPaymentId,
        amountMinor: card.initialAmountMinor,
        currency: card.currency,
        reason: actor.reason,
      })
    }
  } catch {
    /* logged below via audit; refund status still recorded */
  }
  const t = await store.transitionStatus(id, 'refunded', actor)
  return t
}

export async function reissueCard(id: string, actor: Actor): Promise<{ ok: boolean; newCard?: GiftCard; message?: string }> {
  return getStore().reissue(id, generateGiftCardCode(), generatePublicToken(), actor)
}

export async function adjustBalance(
  id: string,
  direction: 'increase' | 'decrease',
  amountMinor: Minor,
  actor: Actor,
): Promise<{ ok: boolean; message?: string }> {
  return getStore().applyLedgerAdjustment({
    giftCardId: id,
    type: direction === 'increase' ? 'manual_increase' : 'manual_decrease',
    magnitudeMinor: amountMinor,
    reason: actor.reason,
    createdBy: actor.actorId,
    approvedBy: actor.actorId,
  })
}
