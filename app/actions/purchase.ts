'use server'

import { getPaymentProvider } from '@/lib/payments'
import { MockPaymentProvider } from '@/lib/payments/mock'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'
import { createPurchase } from '@/lib/gift-cards/service'
import { getStore } from '@/lib/data'
import { purchaseInputSchema } from '@/lib/validation/purchase'
import { domainCanReceiveMail } from '@/lib/validation/email-deliverability'

export interface StartPurchaseResponse {
  ok: boolean
  message?: string
  redirectUrl?: string
  fieldErrors?: Record<string, string>
}

/** Validate (server-side) + create an inactive card + open checkout. */
export async function startPurchase(raw: unknown): Promise<StartPurchaseResponse> {
  const parsed = purchaseInputSchema.safeParse(raw)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.')
      if (!fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { ok: false, message: 'יש לתקן את השדות המסומנים', fieldErrors }
  }

  // Deliverability: the domain must actually accept mail (real MX/A record).
  // This catches real-looking-but-dead domains (e.g. gmail typo'd to a domain
  // that passes syntax). Fails OPEN on transient DNS errors so a real customer
  // is never blocked by a hiccup — only a definitively non-existent domain is
  // rejected. Both emails are checked in parallel.
  const { buyerEmail, recipientEmail } = parsed.data
  const [buyerReachable, recipientReachable] = await Promise.all([
    domainCanReceiveMail(buyerEmail),
    domainCanReceiveMail(recipientEmail),
  ])
  const deliverabilityErrors: Record<string, string> = {}
  if (!buyerReachable) deliverabilityErrors.buyerEmail = 'לא נמצא שרת דואר לכתובת זו — בדקו את הדומיין'
  if (!recipientReachable) deliverabilityErrors.recipientEmail = 'לא נמצא שרת דואר לכתובת זו — בדקו את הדומיין'
  if (Object.keys(deliverabilityErrors).length > 0) {
    return { ok: false, message: 'כתובת אימייל לא ניתנת למשלוח', fieldErrors: deliverabilityErrors }
  }

  try {
    const result = await createPurchase(parsed.data)
    if (!result.ok) return { ok: false, message: result.message }
    return { ok: true, redirectUrl: result.redirectUrl }
  } catch (err) {
    // Never let a server error hang the checkout button — surface the reason.
    return { ok: false, message: err instanceof Error ? err.message : 'שגיאת שרת בעת יצירת התשלום' }
  }
}

export interface MockPaymentResponse {
  ok: boolean
  redirectTo: string
}

/**
 * Mock hosted-checkout outcome. On approval, POSTs a correctly-SIGNED webhook
 * through the exact production verification+activation path (never trusts the
 * browser). On decline, marks nothing paid.
 */
export async function completeMockPayment(input: {
  checkoutId: string
  giftCardId: string
  amountMinor: number
  approve: boolean
  /** The exact success/cancel URLs the checkout was created with (as Grow uses). */
  successUrl?: string
  cancelUrl?: string
}): Promise<MockPaymentResponse> {
  // Fall back to the canonical paths only if the hosted page didn't carry them.
  const successUrl = input.successUrl || `/checkout/confirmation?ref=${input.giftCardId}`
  const cancelUrl = input.cancelUrl || `/checkout/cancelled?ref=${input.giftCardId}`

  const provider = getPaymentProvider()
  if (!(provider instanceof MockPaymentProvider)) {
    return { ok: false, redirectTo: cancelUrl }
  }
  // Decline → return the browser to the cancel URL (no webhook), like Grow.
  if (!input.approve) {
    return { ok: true, redirectTo: cancelUrl }
  }
  // Approve → Grow POSTs a signed webhook server-to-server (notify_url) AND
  // redirects the browser to success_url. We do the same: fire the verified
  // webhook here, then hand the browser to the configured success URL. The
  // confirmation page polls for the paid state (which handles a lagging webhook).
  const { body, signature } = provider.buildSignedWebhook({
    eventId: `mock_evt_${input.checkoutId}`,
    orderRef: input.giftCardId,
    providerPaymentId: `mock_pay_${input.checkoutId}`,
    status: 'paid',
    amountMinor: input.amountMinor,
    currency: 'ILS',
  })
  const req = new Request('http://internal/api/webhooks/payment', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
    body,
  })
  await handlePaymentWebhook(req)
  return { ok: true, redirectTo: successUrl }
}

export interface PurchaseStatus {
  found: boolean
  status?: string
  paid?: boolean
  code?: string
  publicToken?: string
}

/** Safe polling endpoint for the confirmation page (no PII). */
export async function getPurchaseStatus(giftCardId: string): Promise<PurchaseStatus> {
  const card = await getStore().getGiftCardById(giftCardId)
  if (!card) return { found: false }
  const paid = ['active', 'partially_redeemed', 'fully_redeemed'].includes(card.status)
  return {
    found: true,
    status: card.status,
    paid,
    code: paid ? card.code : undefined,
    publicToken: paid ? card.publicToken : undefined,
  }
}
