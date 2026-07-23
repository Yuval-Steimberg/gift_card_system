import type { LedgerEntry, LedgerEntryType } from './types'
import type { Minor } from '@/lib/money'

/** Sign convention for each ledger entry type (credits +1, debits -1). */
const SIGN: Record<LedgerEntryType, 1 | -1> = {
  initial_credit: 1,
  redemption_debit: -1,
  redemption_reversal_credit: 1,
  refund_debit: -1,
  manual_increase: 1,
  manual_decrease: -1,
  expiration_adjustment: -1,
  cancellation_adjustment: -1,
  reissue_transfer: -1,
}

/** Apply the correct sign to a magnitude for a given entry type. */
export function signedAmount(type: LedgerEntryType, magnitudeMinor: Minor): Minor {
  return SIGN[type] * Math.abs(magnitudeMinor)
}

/** The immutable ledger is the source of truth: balance == sum of entries. */
export function computeBalance(entries: Pick<LedgerEntry, 'amountMinor'>[]): Minor {
  return entries.reduce((acc, e) => acc + e.amountMinor, 0)
}

/**
 * Validate that a proposed ledger operation keeps the balance in [0, ...].
 * Redemptions/debits may not drive the balance negative.
 */
export function wouldOverspend(currentBalance: Minor, signedDelta: Minor): boolean {
  return currentBalance + signedDelta < 0
}
