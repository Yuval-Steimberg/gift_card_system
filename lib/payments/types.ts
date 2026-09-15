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
  /** Payer email, when the provider supplies it — used to match the card when
   *  the provider callback omits the order reference (e.g. Grow Payment Links). */
  customerEmail?: string
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

/** One charge as the PROVIDER sees it — the other side of the reconciliation.
 *  Our own database can only show what reached us; this is what was actually
 *  taken from customers. A charge here with no payment_event on our side is
 *  money we never heard about, and the customer is waiting for a card. */
export interface ProviderTransaction {
  providerPaymentId: string
  amountMinor: Minor
  status: ProviderPaymentStatus
  payerEmail: string | null
  createdAt: string
  raw: Record<string, unknown>
}

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
  /**
   * List the provider's own charges in a window, for reconciliation.
   *
   * OPTIONAL: a provider that cannot be queried (or that has no API
   * credentials configured) simply omits it, and the sweep reports that the
   * provider-side check is unavailable rather than silently passing.
   */
  listTransactions?(input: { fromIso: string; toIso: string }): Promise<ProviderTransaction[]>
}
