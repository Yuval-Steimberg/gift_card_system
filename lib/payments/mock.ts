import { randomUUID } from 'node:crypto'
import { signBody } from '@/lib/security/webhook'
import {
  WebhookVerificationError,
  type CheckoutSession,
  type CreateCheckoutInput,
  type PaymentProvider,
  type ProviderPaymentStatus,
  type RefundPaymentInput,
  type RefundResult,
  type VerifiedPaymentEvent,
} from './types'

/**
 * Mock payment provider for local development and tests. No external calls.
 *
 * The "hosted checkout" is our own /checkout/mock page, which lets the developer
 * approve/decline. On approval it posts a SIGNED webhook to our notify URL —
 * exercising the exact same verified-webhook activation path as production, so
 * the mock is a faithful stand-in (browser redirect is never trusted).
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock'
  constructor(private readonly webhookSecret: string) {}

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const checkoutId = `mock_cs_${randomUUID()}`
    const params = new URLSearchParams({
      cs: checkoutId,
      ref: input.orderRef,
      amount: String(input.amountMinor),
      success: input.successUrl,
      cancel: input.cancelUrl,
      notify: input.notifyUrl,
    })
    return {
      checkoutId,
      provider: this.name,
      redirectUrl: `/checkout/mock?${params.toString()}`,
    }
  }

  /**
   * Build the signed webhook body the mock checkout page posts. Exposed so the
   * mock UI/route can produce a correctly-signed event.
   */
  buildSignedWebhook(event: Omit<VerifiedPaymentEvent, 'provider' | 'raw'>): {
    body: string
    signature: string
  } {
    const raw = { ...event, provider: this.name }
    const body = JSON.stringify(raw)
    return { body, signature: signBody(body, this.webhookSecret) }
  }

  async verifyWebhook(request: Request): Promise<VerifiedPaymentEvent> {
    const rawBody = await request.text()
    const signature = request.headers.get('x-mock-signature')
    const expected = signBody(rawBody, this.webhookSecret)
    if (!signature || signature !== expected) {
      throw new WebhookVerificationError('invalid_signature')
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      throw new WebhookVerificationError('invalid_json')
    }
    return {
      provider: this.name,
      eventId: String(parsed.eventId ?? `mock_evt_${parsed.providerPaymentId}`),
      orderRef: String(parsed.orderRef ?? ''),
      providerPaymentId: String(parsed.providerPaymentId ?? ''),
      status: (parsed.status as VerifiedPaymentEvent['status']) ?? 'paid',
      amountMinor: Number(parsed.amountMinor ?? 0),
      currency: (parsed.currency as VerifiedPaymentEvent['currency']) ?? 'ILS',
      raw: parsed,
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundResult> {
    return { refundId: `mock_re_${randomUUID()}`, status: 'refunded' }
  }

  async getPaymentStatus(_providerPaymentId: string): Promise<ProviderPaymentStatus> {
    // The mock has no server-side ledger of its own; the caller relies on our DB.
    return 'paid'
  }
}
