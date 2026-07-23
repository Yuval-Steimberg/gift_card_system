import type { Currency, Minor } from '@/lib/money'

export interface CreateCheckoutInput {
  /** Our internal reference (gift card id / order ref). Round-trips back to us. */
  orderRef: string
  amountMinor: Minor
  currency: Currency
  description: string
  customer: {
    name: string
    email: string
    phone?: string | null
  }
  successUrl: string
  cancelUrl: string
  /** Server webhook URL the provider should notify. */
  notifyUrl: string
}

export interface CheckoutSession {
  /** Provider-side checkout id. */
  checkoutId: string
  /** Hosted payment page URL to redirect the customer to. */
  redirectUrl: string
  provider: string
}

/** Normalized payment event after webhook verification. */
export interface VerifiedPaymentEvent {
  provider: string
  /** Stable event id used for idempotency (provider-supplied when available). */
  eventId: string
  orderRef: string
  providerPaymentId: string
  status: 'paid' | 'failed' | 'refunded' | 'pending'
  amountMinor: Minor
  currency: Currency
  /** The raw verified payload, stored for audit/reconciliation. */
  raw: Record<string, unknown>
}

export interface RefundPaymentInput {
  providerPaymentId: string
  amountMinor: Minor
  currency: Currency
  reason?: string
}

export interface RefundResult {
  refundId: string
  status: 'refunded' | 'pending' | 'failed'
}

export type ProviderPaymentStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'refunded'

export class WebhookVerificationError extends Error {
  constructor(reason: string) {
    super(`Webhook verification failed: ${reason}`)
    this.name = 'WebhookVerificationError'
  }
}

export interface PaymentProvider {
  readonly name: string
  createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession>
  verifyWebhook(request: Request): Promise<VerifiedPaymentEvent>
  refundPayment(input: RefundPaymentInput): Promise<RefundResult>
  getPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentStatus>
}
