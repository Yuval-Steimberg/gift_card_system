import { describe, it, expect, beforeEach } from 'vitest'
import { _resetStore, getStore } from '@/lib/data'
import { _resetPaymentProvider, getPaymentProvider } from '@/lib/payments'
import { MockPaymentProvider } from '@/lib/payments/mock'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'
import { createPurchase, deliverDueJobs } from '@/lib/gift-cards/service'
import { toMinor } from '@/lib/money'
import type { PurchaseInput } from '@/lib/validation/purchase'

const base: PurchaseInput = {
  amountMinor: toMinor(200), templateId: 'tpl-celebration',
  buyerName: 'דנה כהן', buyerEmail: 'dana@example.com', buyerPhone: '0501234567',
  buyerCompany: '', buyerTaxId: '', wantsInvoice: false, showBuyerName: true, sendAnonymously: false,
  recipientName: 'יעל לוי', recipientEmail: 'yael@example.com', recipientPhone: '0521234567',
  recipientLanguage: 'he', deliveryChannel: 'email', greeting: 'מזל טוב',
  deliveryTiming: 'scheduled', scheduledDeliveryAt: null, senderTimezone: 'Asia/Jerusalem', acceptedTerms: true,
}

function signed(id: string, eventId: string) {
  const p = getPaymentProvider() as MockPaymentProvider
  const { body, signature } = p.buildSignedWebhook({ eventId, orderRef: id, providerPaymentId: `pay-${eventId}`, status: 'paid', amountMinor: toMinor(200), currency: 'ILS' })
  return new Request('http://internal/api/webhooks/payment', { method: 'POST', headers: { 'content-type': 'application/json', 'x-mock-signature': signature }, body })
}

beforeEach(() => { _resetStore(); _resetPaymentProvider() })

describe('scheduled gift-card delivery', () => {
  it('a future schedule is NOT delivered until its time, then delivers via cron', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const res = await createPurchase({ ...base, scheduledDeliveryAt: future })
    const id = res.giftCardId!
    await handlePaymentWebhook(signed(id, 'evt-future'))

    // At activation the job is 'scheduled' and NOT delivered (time not reached).
    let jobs = await getStore().getDeliveryJobs(id)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.status).toBe('scheduled')

    // A cron run BEFORE the scheduled time delivers nothing.
    await deliverDueJobs(new Date().toISOString(), 50)
    jobs = await getStore().getDeliveryJobs(id)
    expect(jobs[0]!.status).toBe('scheduled')

    // A cron run AFTER the scheduled time delivers it.
    await deliverDueJobs(new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), 50)
    jobs = await getStore().getDeliveryJobs(id)
    expect(jobs[0]!.status).toBe('delivered')
  })

  it('a schedule already due at activation delivers immediately (no waiting for cron)', async () => {
    // Buyer scheduled a near time but paid after it passed. createPurchase
    // rejects past times up-front, so simulate by patching the stored card.
    const res = await createPurchase({ ...base, deliveryTiming: 'immediate', scheduledDeliveryAt: null })
    const id = res.giftCardId!
    const past = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    await getStore().updateGiftCardFields(id, { scheduledDeliveryAt: past }, { actorId: 'test', actorRole: 'system', reason: 'test' })

    await handlePaymentWebhook(signed(id, 'evt-due'))

    // The activation sweep must have delivered it — no cron needed.
    const jobs = await getStore().getDeliveryJobs(id)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.status).toBe('delivered')
  })

  it('an immediate card still delivers at activation (unchanged)', async () => {
    const res = await createPurchase({ ...base, deliveryTiming: 'immediate', scheduledDeliveryAt: null })
    const id = res.giftCardId!
    await handlePaymentWebhook(signed(id, 'evt-now'))
    const jobs = await getStore().getDeliveryJobs(id)
    expect(jobs[0]!.status).toBe('delivered')
  })
})
