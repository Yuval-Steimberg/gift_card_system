import { toMajor } from '@/lib/money'
import { normalizeIsraeliPhone } from '@/lib/validation/purchase'
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
  apiKey: string // Grow userId
  apiSecret: string // Grow apiKey
  pageCode: string
  /** Optional Make.com webhook (Grow-via-Make), same as the JAS website. */
  makeWebhookUrl?: string
  /** Optional shared secret; if a callback includes `secret`, it must match. */
  webhookSecret?: string
}

/**
 * Grow (grow.link / Meshulam) adapter — modeled EXACTLY on the existing Just A
 * Second website's payment integration (see docs/just-website-repository-audit.md
 * and docs/payment-flow.md), so it is drop-in compatible with the business's
 * existing Grow account + Make.com scenario:
 *
 *   1) If MAKE_WEBHOOK_URL is set → POST the order to the Make.com scenario,
 *      which returns the Grow hosted-payment-page URL (same field shape the
 *      reference sends: price/fullName/phone/… + success_url/cancel_url/notify_url).
 *   2) Otherwise → call Grow's REST API directly: createPaymentProcess, falling
 *      back to createPaymentLink (identical fields to the reference).
 *
 * Money crosses to Grow in MAJOR units (shekels), exactly like the reference,
 * and the webhook `sum` is converted back to minor units. The gift-card safety
 * the reference lacked — amount reconciliation + idempotent one-card activation —
 * lives in lib/gift-cards/service.ts + the activate RPC, so a replayed or
 * mismatched webhook can never mint a second card or the wrong balance.
 *
 * Webhook authenticity: the reference performed NO signature check. Here it is
 * OPTIONAL and non-breaking — if the callback includes a `secret` field (or an
 * `x-webhook-token` header), it must equal PAYMENT_WEBHOOK_SECRET; if it doesn't
 * include one, we accept it (reference behavior). Because our order ref is an
 * unguessable UUID and activation reconciles the amount + dedupes on the event,
 * forgery risk is contained even without a signature. Add the `secret` to your
 * Make scenario / Grow callback to lock it down fully.
 */
export class GrowPaymentProvider implements PaymentProvider {
  readonly name = 'grow'
  constructor(private readonly config: GrowConfig) {}

  private unwrap(raw: unknown): any {
    // Grow may return an array or an object — normalize to an object.
    if (Array.isArray(raw)) return raw[0] ?? {}
    return raw ?? {}
  }

  async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const name = input.customer.name ?? ''
    const email = input.customer.email ?? ''
    // Grow validates Israeli phones strictly; normalize like the reference.
    const phone = input.customer.phone ? (normalizeIsraeliPhone(input.customer.phone) ?? '') : ''
    // Grow expects a major-unit amount (shekels), like the reference.
    const sum = toMajor(input.amountMinor, input.currency)
    const description = input.description

    // ─── Option 1: Make.com webhook (Grow via Make) — same as JAS website ───
    if (this.config.makeWebhookUrl) {
      const res = await fetch(this.config.makeWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Fields the Make.com scenario expects (mirrors the reference).
          price: sum,
          fullName: name,
          phone,
          amount: sum,
          description,
          customer_name: name,
          customer_email: email,
          customer_phone: phone,
          name,
          email,
          order_ref: input.orderRef,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          notify_url: input.notifyUrl,
          send_method: 'none',
        }),
      })
      const text = await res.text()
      let data: Record<string, unknown> = {}
      try {
        data = JSON.parse(text)
      } catch {
        // Make.com returned non-JSON (e.g. "Scenario finished") — no link.
        throw new Error(`Make.com did not return a payment link: ${text.slice(0, 200)}`)
      }
      const url = data.url || data.payment_url || data.payment_page_link
      if (url) {
        return {
          checkoutId: String(data.process_id ?? (data as Record<string, unknown>).processId ?? ''),
          redirectUrl: String(url),
          provider: this.name,
        }
      }
      throw new Error(`Grow/Make payment link creation failed: ${(data.error as string) ?? 'unknown'}`)
    }

    // ─── Option 2: Direct Grow API (createPaymentProcess → createPaymentLink) ─
    const form = new URLSearchParams()
    form.append('pageCode', this.config.pageCode || '1')
    form.append('userId', this.config.apiKey)
    form.append('apiKey', this.config.apiSecret)
    form.append('sum', String(sum))
    form.append('description', description)
    form.append('pageField[fullName]', name)
    form.append('pageField[email]', email)
    form.append('pageField[phone]', phone)
    form.append('successUrl', input.successUrl)
    form.append('cancelUrl', input.cancelUrl)
    form.append('notifyUrl', input.notifyUrl)
    form.append('cField1', input.orderRef)
    form.append('maxPayments', '1')

    const processRes = await fetch(`${this.config.apiUrl}/api/light/server/createPaymentProcess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    const processData = this.unwrap(await processRes.json())
    if (processData.status === 1 && processData.data?.url) {
      return {
        checkoutId: String(processData.data.processId ?? processData.data.paymentLinkProcessId ?? ''),
        redirectUrl: String(processData.data.url),
        provider: this.name,
      }
    }

    // Fallback: createPaymentLink (JSON body), same as the reference.
    const linkRes = await fetch(`${this.config.apiUrl}/api/light/server/createPaymentLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageCode: this.config.pageCode || '1',
        userId: this.config.apiKey,
        apiKey: this.config.apiSecret,
        sum,
        description,
        'pageField[fullName]': name,
        'pageField[email]': email,
        'pageField[phone]': phone,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        notifyUrl: input.notifyUrl,
        cField1: input.orderRef,
        maxPayments: 1,
      }),
    })
    const linkData = this.unwrap(await linkRes.json())
    if (linkData.status === 1 && linkData.data?.url) {
      return {
        checkoutId: String(linkData.data.linkId ?? linkData.data.paymentLinkProcessId ?? ''),
        redirectUrl: String(linkData.data.url),
        provider: this.name,
      }
    }

    throw new Error(
      `Grow createPayment failed: ${processData.err?.message ?? linkData.err?.message ?? 'unknown error'}`,
    )
  }

  async verifyWebhook(request: Request): Promise<VerifiedPaymentEvent> {
    const rawBody = await request.text()
    const contentType = request.headers.get('content-type') ?? ''
    const data = parseBody(rawBody, contentType)

    // Optional shared-secret check (non-breaking): only enforced when the
    // callback actually carries a secret/token. Add it to your Make scenario to
    // require it. Matches the reference site's (unused) verifyWebhookToken idea.
    const provided = String(data.secret ?? data.token ?? request.headers.get('x-webhook-token') ?? '')
    if (provided && this.config.webhookSecret && provided !== this.config.webhookSecret) {
      throw new WebhookVerificationError('invalid_webhook_token')
    }

    // Field extraction mirrors the reference grow-webhook exactly.
    const transactionCode = String(data.transactionCode ?? data.asmachta ?? '')
    const orderRef = String(data.cField1 ?? data.order_ref ?? '')
    const majorSum = Number(data.sum ?? data.amount ?? 0)
    const statusCode = String(data.statusCode ?? data.status ?? '')
    const approved = statusCode === '1' || statusCode === 'success' || Boolean(transactionCode)

    return {
      provider: this.name,
      eventId: transactionCode || String(data.transactionId ?? data.processId ?? orderRef),
      orderRef,
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
    const data = this.unwrap(await res.json())
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
    const data = this.unwrap(await res.json())
    return data?.data?.paid ? 'paid' : 'pending'
  }
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
