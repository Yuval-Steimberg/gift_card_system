'use server'

import { getPaymentProvider } from '@/lib/payments'
import { MockPaymentProvider } from '@/lib/payments/mock'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'
import { createPurchase } from '@/lib/gift-cards/service'
import { getStore } from '@/lib/data'
import { purchaseInputSchema } from '@/lib/validation/purchase'

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
  const result = await createPurchase(parsed.data)
  if (!result.ok) return { ok: false, message: result.message }
  return { ok: true, redirectUrl: result.redirectUrl }
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
}): Promise<MockPaymentResponse> {
  const provider = getPaymentProvider()
  if (!(provider instanceof MockPaymentProvider)) {
    return { ok: false, redirectTo: `/checkout/cancelled?ref=${input.giftCardId}` }
  }
  if (!input.approve) {
    return { ok: true, redirectTo: `/checkout/cancelled?ref=${input.giftCardId}` }
  }
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
  return { ok: true, redirectTo: `/checkout/confirmation?ref=${input.giftCardId}` }
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
