import { randomUUID } from 'node:crypto'
import { signBody } from '@/lib/security/webhook'
import {
  WebhookVerificationError,
  type CheckoutSession,
  type CreateCheckoutInput,
  type PaymentProvider,
  type ProviderPaymentStatus,
  type ProviderTransaction,
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
  /** Charges this provider has "taken" — the stand-in for the real provider's
   *  transaction list, so the reconciliation sweep can be exercised offline. */
  private readonly charges: ProviderTransaction[] = []
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
    // Building the webhook IS the charge in the mock flow (the mock checkout
    // page posts it on approval), so record it on the provider side. Whether
    // that POST ever reaches us is exactly what reconciliation checks.
    if (event.status === 'paid' && event.providerPaymentId) {
      this.charges.push({
        providerPaymentId: event.providerPaymentId,
        amountMinor: event.amountMinor,
        status: 'paid',
        payerEmail: event.customerEmail ?? null,
        createdAt: new Date().toISOString(),
        raw,
      })
    }
    const body = JSON.stringify(raw)
    return { body, signature: signBody(body, this.webhookSecret) }
  }

  async listTransactions(input: { fromIso: string; toIso: string }): Promise<ProviderTransaction[]> {
    const from = Date.parse(input.fromIso)
    const to = Date.parse(input.toIso)
    return this.charges.filter((c) => {
      const at = Date.parse(c.createdAt)
      return at >= from && at <= to
    })
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
      // Carried through so the mock can exercise the order_ref-less fallback
      // matching that the real Grow callback forces on us (gotcha #8d).
      customerEmail: parsed.customerEmail ? String(parsed.customerEmail) : undefined,
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
