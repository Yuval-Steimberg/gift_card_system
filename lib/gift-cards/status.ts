import type { GiftCardStatus } from './types'

/**
 * Central status-transition authority. The client can never set a status
 * directly; every change goes through `assertTransition`. Transitions not in
 * this map are rejected.
 */
const ALLOWED: Record<GiftCardStatus, GiftCardStatus[]> = {
  draft: ['awaiting_payment', 'active', 'cancelled', 'failed'],
  awaiting_payment: ['payment_processing', 'active', 'paid' as GiftCardStatus, 'failed', 'cancelled'],
  payment_processing: ['active', 'failed', 'cancelled'],
  // `paid` is represented on the card as it moves straight to active; kept for
  // clarity of the payment step. Treat active as the canonical live state.
  active: ['partially_redeemed', 'fully_redeemed', 'suspended', 'cancelled', 'refunded', 'reissued', 'expired'],
  partially_redeemed: ['partially_redeemed', 'fully_redeemed', 'suspended', 'cancelled', 'refunded', 'reissued', 'expired'],
  fully_redeemed: ['refunded', 'reissued'],
  suspended: ['active', 'partially_redeemed', 'cancelled', 'refunded', 'expired'],
  cancelled: [],
  refunded: [],
  reissued: [],
  expired: ['suspended', 'active', 'partially_redeemed', 'reissued'], // extend/reactivate
  failed: ['awaiting_payment', 'cancelled'],
}

// Alias: some flows produce a transient `paid` state before `active`.
const PAID_ALIAS: GiftCardStatus[] = ['active', 'cancelled', 'refunded']

export function canTransition(from: GiftCardStatus, to: GiftCardStatus): boolean {
  if (from === to) return ALLOWED[from]?.includes(to) ?? false
  if ((from as string) === 'paid') return PAID_ALIAS.includes(to)
  return ALLOWED[from]?.includes(to) ?? false
}

export class IllegalStatusTransitionError extends Error {
  constructor(
    public readonly from: GiftCardStatus,
    public readonly to: GiftCardStatus,
  ) {
    super(`Illegal gift-card status transition: ${from} -> ${to}`)
    this.name = 'IllegalStatusTransitionError'
  }
}

export function assertTransition(from: GiftCardStatus, to: GiftCardStatus): void {
  if (!canTransition(from, to)) throw new IllegalStatusTransitionError(from, to)
}

/** Derive the balance-driven status after a redemption/credit. */
export function statusForBalance(
  current: GiftCardStatus,
  balanceMinor: number,
  initialMinor: number,
): GiftCardStatus {
  // Only recompute for live states; suspended/cancelled/etc. are sticky.
  if (current !== 'active' && current !== 'partially_redeemed') return current
  if (balanceMinor <= 0) return 'fully_redeemed'
  if (balanceMinor < initialMinor) return 'partially_redeemed'
  return 'active'
}

/** Human labels (Hebrew) for UI badges. */
export const STATUS_LABEL_HE: Record<GiftCardStatus, string> = {
  draft: 'טיוטה',
  awaiting_payment: 'ממתין לתשלום',
  payment_processing: 'מעבד תשלום',
  active: 'פעיל',
  partially_redeemed: 'נוצל חלקית',
  fully_redeemed: 'נוצל במלואו',
  expired: 'פג תוקף',
  suspended: 'מושהה',
  cancelled: 'בוטל',
  refunded: 'הוחזר',
  reissued: 'הונפק מחדש',
  failed: 'נכשל',
}
