import { describe, it, expect, beforeEach } from 'vitest'
import { _resetStore, getStore } from '@/lib/data'
import { _resetPaymentProvider, getPaymentProvider } from '@/lib/payments'
import { MockPaymentProvider } from '@/lib/payments/mock'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'
import { createPurchase, deliverDueJobs } from '@/lib/gift-cards/service'
import { STALE_CLAIM_MS } from '@/lib/data/store'
import { toMinor } from '@/lib/money'
import type { PurchaseInput } from '@/lib/validation/purchase'

const base: PurchaseInput = {
  amountMinor: toMinor(200), templateId: 'tpl-celebration',
  buyerName: 'דנה כהן', buyerEmail: 'dana@example.com', buyerPhone: '0501234567',
  buyerCompany: '', buyerTaxId: '', wantsInvoice: false, showBuyerName: true, sendAnonymously: false,
  recipientName: 'יעל לוי', recipientEmail: 'yael@example.com', recipientPhone: '0521234567',
  recipientLanguage: 'he', deliveryChannel: 'email', greeting: 'מזל טוב',
  deliveryTiming: 'immediate', scheduledDeliveryAt: null, senderTimezone: 'Asia/Jerusalem', acceptedTerms: true,
}

function signed(id: string, eventId: string) {
  const p = getPaymentProvider() as MockPaymentProvider
  const { body, signature } = p.buildSignedWebhook({
    eventId, orderRef: id, providerPaymentId: `pay-${eventId}`, status: 'paid',
    amountMinor: toMinor(200), currency: 'ILS',
  })
  return new Request('http://internal/api/webhooks/payment', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
    body,
  })
}

/** Buy + pay for a card, then force its (delivered) job back into the state a
 *  worker leaves behind when it is killed mid-send: 'processing', never
 *  finished. That is exactly what a Vercel function timeout produces. */
async function cardWithAbandonedJob(ageMs: number) {
  const res = await createPurchase(base)
  const id = res.giftCardId!
  await handlePaymentWebhook(signed(id, `evt-${id}`))
  const [job] = await getStore().getDeliveryJobs(id)
  const raw = (getStore() as unknown as { deliveryJobs: Map<string, { status: string; attempts: number; updatedAt: string }> })
    .deliveryJobs.get(job!.id)!
  raw.status = 'processing'
  raw.attempts = 1
  raw.updatedAt = new Date(Date.now() - ageMs).toISOString()
  return id
}

beforeEach(() => { _resetStore(); _resetPaymentProvider() })

describe('delivery recovery (worker died mid-send)', () => {
  it('re-claims and delivers a job abandoned in "processing"', async () => {
    const id = await cardWithAbandonedJob(STALE_CLAIM_MS + 60_000)

    await deliverDueJobs(new Date().toISOString(), 50)

    const jobs = await getStore().getDeliveryJobs(id)
    expect(jobs[0]!.status).toBe('delivered')
  })

  it('does NOT steal a job from a worker that is still running', async () => {
    const id = await cardWithAbandonedJob(60_000) // claimed a minute ago

    await deliverDueJobs(new Date().toISOString(), 50)

    const jobs = await getStore().getDeliveryJobs(id)
    expect(jobs[0]!.status).toBe('processing')
  })

  it('counts an abandoned job in the admin delivery-failure stat', async () => {
    await cardWithAbandonedJob(STALE_CLAIM_MS + 60_000)
    expect(await getStore().countCardsWithFailedDelivery()).toBe(1)
  })

  it('does not count a job that is still being worked on', async () => {
    await cardWithAbandonedJob(60_000)
    expect(await getStore().countCardsWithFailedDelivery()).toBe(0)
  })
})
