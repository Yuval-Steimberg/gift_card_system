import 'server-only'
import { getPaymentProvider } from './index'
import { WebhookVerificationError } from './types'
import { processVerifiedPaymentEvent } from '@/lib/gift-cards/service'
import { reportError } from '@/lib/logging/report'

export interface WebhookOutcome {
  status: number
  body: Record<string, unknown>
}

/**
 * Verify + process a payment webhook. Shared by /api/webhooks/payment and the
 * mock checkout page so both exercise the SAME verified-webhook activation path.
 *
 * - Verification failure -> 400 (never act on unverified input).
 * - Processing is idempotent (repeated events don't double-activate/deliver).
 */
export async function handlePaymentWebhook(request: Request): Promise<WebhookOutcome> {
  const provider = getPaymentProvider()
  let event
  try {
    event = await provider.verifyWebhook(request)
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return { status: 400, body: { ok: false, error: err.message } }
    }
    return { status: 400, body: { ok: false, error: 'invalid_webhook' } }
  }
  try {
    await processVerifiedPaymentEvent(event)
    return { status: 200, body: { ok: true, received: true } }
  } catch (err) {
    // Internal error — return 500 so the provider retries.
    await reportError(err, { scope: 'payment_webhook', eventId: event.eventId, orderRef: event.orderRef })
    return { status: 500, body: { ok: false, error: err instanceof Error ? err.message : 'internal_error' } }
  }
}
