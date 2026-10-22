import 'server-only'
import { getStore } from '@/lib/data'
import { processVerifiedPaymentEvent } from './service'

/**
 * Manually activate a card whose payment succeeded at the provider but whose
 * confirmation webhook never arrived (e.g. a Grow callback that didn't reach
 * us). Runs the SAME verified-activation path as a real webhook — atomic
 * activation + initial credit + receipt + delivery — using the card's own
 * authoritative amount, so the ledger invariant and idempotency are preserved.
 * The operator must have confirmed the payment in the Grow dashboard first;
 * the reason is recorded in the audit log.
 *
 * The ONE implementation: /admin's "סימון כשולם והפעלה" and the command
 * center's integration route both call this.
 */
export async function markPaid(
  id: string,
  actor: { actorId: string | null; actorRole: string; reason: string },
): Promise<{ ok: boolean; message?: string }> {
  const store = getStore()
  const card = await store.getGiftCardById(id)
  if (!card) return { ok: false, message: 'שובר לא נמצא' }
  if (['active', 'partially_redeemed', 'fully_redeemed'].includes(card.status)) {
    return { ok: true, message: 'השובר כבר פעיל' }
  }
  if (!['draft', 'awaiting_payment', 'payment_processing', 'failed'].includes(card.status)) {
    return { ok: false, message: `לא ניתן להפעיל שובר בסטטוס ${card.status}` }
  }
  const who = actor.actorId ?? actor.actorRole
  try {
    await processVerifiedPaymentEvent({
      provider: 'manual',
      eventId: `manual_${id}_${Date.now()}`,
      orderRef: id,
      providerPaymentId: `manual_${who}`,
      status: 'paid',
      amountMinor: card.initialAmountMinor,
      currency: card.currency,
      raw: { manual: true, actorId: actor.actorId, actorRole: actor.actorRole, reason: actor.reason || null },
    })
    await store.appendAudit({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: 'giftcard.manual_activate',
      entityType: 'gift_card',
      entityId: id,
      reason: actor.reason?.trim() || 'הפעלה ידנית לאחר אימות תשלום מול הספק',
      metadata: {},
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'שגיאה בהפעלה הידנית' }
  }
}
