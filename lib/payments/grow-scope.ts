/**
 * Is this Grow transaction a GIFT-CARD payment at all?
 *
 * Grow's callback is a GLOBAL webhook ("כל העסקאות", gotcha #8c): it fires for
 * EVERY charge on the business's Grow account — the store's card terminal, the
 * JAS website's orders — not only for the payment links this app creates. Those
 * other sales can never match a gift card, so treating them as "unmatched
 * payments" buried the daily sweep under the store's ordinary takings (142
 * false alarms in two weeks, Oct 2026).
 *
 * Every gift-card payment link carries our description ("… שובר מתנה …", see
 * startPurchase / the Make scenario), and Grow echoes it as `paymentDesc`.
 *
 * Deliberately one-sided: a payment is NOT ours only when Grow positively says
 * what it was for and that is not a gift card. A payload with no description at
 * all, or with our order ref, stays ours — mislabelling a real gift-card payment
 * as foreign would drop money silently, while the reverse is only a false alarm.
 */
const GIFT_CARD_MARKER = /שובר\s*מתנה|gift\s*card/i

export function isGiftCardGrowPayment(raw: Record<string, unknown> | null | undefined): boolean {
  if (!raw) return true
  if (raw.cField1 || raw.order_ref || raw.orderRef) return true
  const desc = String(raw.paymentDesc ?? raw.description ?? '').trim()
  if (!desc) return true
  return GIFT_CARD_MARKER.test(desc)
}
