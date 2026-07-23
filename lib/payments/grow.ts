import { toMajor } from '@/lib/money'
import { verifySignature } from '@/lib/security/webhook'
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

export interface GrowConfig {
  apiUrl: string
  apiKey: string
  apiSecret: string
  pageCode: string
  webhookSecret: string
}

/**
 * Grow (grow.link / Meshulam) adapter — the intended Israeli production
 * provider (reference-repo compatible: Israeli cards, Bit, Apple/Google Pay via
 * Grow's hosted page). It is HARDENED relative to the reference site:
 *
 *  - Webhooks are HMAC-verified (the reference verified nothing).
 *  - Amounts are reconciled against our stored order before activation
 *    (done by the caller in lib/gift-cards/service.ts).
 *  - Money crosses the boundary in minor units; Grow's major-unit `sum` is
 *    converted explicitly.
 *
 * NOTE: This adapter is written to Grow's documented shapes but is UNVERIFIED
 * against a live account. Confirm field names + the exact webhook signature
 * scheme with Grow before going live (see docs/payment-flow.md). Until then the
 * default provider is `mock`.
 */
export class GrowPaymentProvider implements PaymentProvider {
  readonly name = 'grow'
  constructor(private readonly config: GrowConfig) {}

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const form = new URLSearchParams()
    form.set('pageCode', this.config.pageCode)
    form.set('userId', this.config.apiKey)
    form.set('apiKey', this.config.apiSecret)
    // Grow expects a major-unit amount; convert from our minor units.
    form.set('sum', String(toMajor(input.amountMinor, input.currency)))
    form.set('description', input.description)
    form.set('pageField[fullName]', input.customer.name)
    form.set('pageField[email]', input.customer.email)
    if (input.customer.phone) form.set('pageField[phone]', input.customer.phone)
    form.set('successUrl', input.successUrl)
    form.set('cancelUrl', input.cancelUrl)
    form.set('notifyUrl', input.notifyUrl)
    form.set('cField1', input.orderRef)
    form.set('maxPayments', '1')

    const res = await fetch(`${this.config.apiUrl}/api/light/server/createPaymentProcess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    const data = unwrap(await res.json())
    if (data?.status === 1 && data?.data?.url) {
      return {
        checkoutId: String(data.data.processId ?? data.data.paymentLinkProcessId ?? ''),
        redirectUrl: String(data.data.url),
        provider: this.name,
      }
    }
    throw new Error(`Grow createPaymentProcess failed: ${data?.err?.message ?? 'unknown error'}`)
  }

  async verifyWebhook(request: Request): Promise<VerifiedPaymentEvent> {
    const rawBody = await request.text()
    // Grow signs the callback; the exact header must be confirmed with Grow.
    const signature = request.headers.get('x-grow-signature') ?? request.headers.get('x-signature')
    const verdict = verifySignature(rawBody, signature, this.config.webhookSecret)
    if (!verdict.ok) throw new WebhookVerificationError(verdict.reason ?? 'invalid_signature')

    const data = parseBody(rawBody, request.headers.get('content-type') ?? '')
    const transactionCode = String(data.transactionCode ?? data.asmachta ?? '')
    const statusCode = String(data.statusCode ?? data.status ?? '')
    const approved = statusCode === '1' || statusCode === 'success' || Boolean(transactionCode)
    const majorSum = Number(data.sum ?? data.amount ?? 0)

    return {
      provider: this.name,
      eventId: transactionCode || String(data.transactionId ?? data.processId ?? ''),
      orderRef: String(data.cField1 ?? data.order_ref ?? ''),
      providerPaymentId: transactionCode,
      status: approved ? 'paid' : 'failed',
      amountMinor: Math.round(majorSum * 100),
      currency: 'ILS',
      raw: data,
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundResult> {
    const form = new URLSearchParams()
    form.set('userId', this.config.apiKey)
    form.set('apiKey', this.config.apiSecret)
    form.set('transactionId', input.providerPaymentId)
    form.set('sum', String(toMajor(input.amountMinor, input.currency)))
    const res = await fetch(`${this.config.apiUrl}/api/light/server/refundTransaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    const data = unwrap(await res.json())
    return {
      refundId: String(data?.data?.refundId ?? input.providerPaymentId),
      status: data?.status === 1 ? 'refunded' : 'failed',
    }
  }

  async getPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentStatus> {
    const form = new URLSearchParams()
    form.set('userId', this.config.apiKey)
    form.set('apiKey', this.config.apiSecret)
    form.set('transactionId', providerPaymentId)
    const res = await fetch(`${this.config.apiUrl}/api/light/server/getTransactionDetails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    const data = unwrap(await res.json())
    return data?.data?.paid ? 'paid' : 'pending'
  }
}

// Grow may return an array or object; normalize to an object.
function unwrap(raw: unknown): any {
  if (Array.isArray(raw)) return raw[0] ?? {}
  return raw ?? {}
}

function parseBody(rawBody: string, contentType: string): Record<string, string> {
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawBody)
    } catch {
      return {}
    }
  }
  const params = new URLSearchParams(rawBody)
  const out: Record<string, string> = {}
  for (const [k, v] of params.entries()) out[k] = v
  return out
}
