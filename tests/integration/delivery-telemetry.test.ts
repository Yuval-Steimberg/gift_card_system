import { describe, it, expect, beforeEach } from 'vitest'
import { _resetStore, getStore } from '@/lib/data'
import { _resetPaymentProvider, getPaymentProvider } from '@/lib/payments'
import { MockPaymentProvider } from '@/lib/payments/mock'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'
import { createPurchase } from '@/lib/gift-cards/service'
import { runReconciliation } from '@/lib/gift-cards/reconcile'
import { parseEmailEvents } from '@/lib/delivery/email/events'
import { toMinor } from '@/lib/money'
import type { PurchaseInput } from '@/lib/validation/purchase'

const base: PurchaseInput = {
  amountMinor: toMinor(200), templateId: 'tpl-celebration',
  buyerName: 'דנה כהן', buyerEmail: 'office@1to1landscape.com', buyerPhone: '0501234567',
  buyerCompany: '', buyerTaxId: '', wantsInvoice: false, showBuyerName: true, sendAnonymously: false,
  recipientName: 'יעל לוי', recipientEmail: 'yoav@1to1landscape.com', recipientPhone: '0521234567',
  recipientLanguage: 'he', deliveryChannel: 'email', greeting: 'מזל טוב',
  deliveryTiming: 'immediate', scheduledDeliveryAt: null, senderTimezone: 'Asia/Jerusalem', acceptedTerms: true,
}

async function boughtAndDelivered() {
  const { giftCardId: id } = await createPurchase(base)
  const p = getPaymentProvider() as MockPaymentProvider
  const { body, signature } = p.buildSignedWebhook({
    eventId: 'evt-1', orderRef: id!, providerPaymentId: 'pay-1', status: 'paid',
    amountMinor: toMinor(200), currency: 'ILS',
  })
  await handlePaymentWebhook(new Request('http://internal/api/webhooks/payment', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-mock-signature': signature }, body,
  }))
  const [job] = await getStore().getDeliveryJobs(id!)
  expect(job!.status).toBe('delivered') // our side says success…
  return { id: id!, jobId: job!.id }
}

const bounce = (jobId: string, giftCardId: string) =>
  parseEmailEvents([{
    event: 'bounce', email: 'yoav@1to1landscape.com', timestamp: Math.floor(Date.now() / 1000),
    sg_message_id: 'msg-x.recv', reason: '550 5.7.1 Message rejected by the recipient tenant',
    jobId, giftCardId,
  }])

beforeEach(() => { _resetStore(); _resetPaymentProvider() })

describe('email provider telemetry (the 202-is-not-delivery gap)', () => {
  it('a bounce flips our optimistic "delivered" to a state a human must fix', async () => {
    const { id, jobId } = await boughtAndDelivered()

    const res = await getStore().applyEmailProviderEvents('sendgrid', bounce(jobId, id))
    expect(res).toEqual({ applied: 1, unmatched: 0 })

    const [job] = await getStore().getDeliveryJobs(id)
    // 'cancelled', not 'failed': re-sending to a hard bounce burns reputation.
    expect(job!.status).toBe('cancelled')
    expect(job!.lastError).toContain('550')
  })

  it('a bounced card is NOT silently retried by the delivery sweep', async () => {
    const { id, jobId } = await boughtAndDelivered()
    await getStore().applyEmailProviderEvents('sendgrid', bounce(jobId, id))

    const claimed = await getStore().claimDueDeliveryJobs(new Date(Date.now() + 86_400_000).toISOString(), 50)
    expect(claimed).toHaveLength(0)
  })

  it('a bounced card shows up in the /admin delivery-failure stat', async () => {
    const { id, jobId } = await boughtAndDelivered()
    expect(await getStore().countCardsWithFailedDelivery()).toBe(0)

    await getStore().applyEmailProviderEvents('sendgrid', bounce(jobId, id))
    expect(await getStore().countCardsWithFailedDelivery()).toBe(1)
  })

  it('matches an event by provider message id when custom_args are absent', async () => {
    const { id } = await boughtAndDelivered()
    const [job] = await getStore().getDeliveryJobs(id)
    const events = parseEmailEvents([{
      event: 'bounce', email: 'yoav@1to1landscape.com', timestamp: Math.floor(Date.now() / 1000),
      sg_message_id: `${job!.providerMessageId}.filterdrecv-1`, reason: '550 blocked',
    }])

    expect(await getStore().applyEmailProviderEvents('sendgrid', events)).toEqual({ applied: 1, unmatched: 0 })
  })

  it('reports an event it cannot tie to a job instead of pretending it applied', async () => {
    const events = parseEmailEvents([{ event: 'bounce', email: 'x@y.com', timestamp: 1, sg_message_id: 'unknown.1' }])
    expect(await getStore().applyEmailProviderEvents('sendgrid', events)).toEqual({ applied: 0, unmatched: 1 })
  })
})

describe('daily reconciliation', () => {
  it('stays silent when nothing is wrong', async () => {
    await boughtAndDelivered()
    expect(await runReconciliation()).toEqual({
      unmatchedPayments: 0, paidNotActivated: 0, undelivered: 0,
      untrackedCharges: 0, providerCheckError: null, alerted: false, needsAttention: false,
    })
  })

  it('catches a bounced card and alerts', async () => {
    const { id, jobId } = await boughtAndDelivered()
    await getStore().applyEmailProviderEvents('sendgrid', bounce(jobId, id))

    const result = await runReconciliation()
    expect(result.undelivered).toBe(1)
    expect(result.alerted).toBe(true)
  })

  it('catches a payment that matched no card at all', async () => {
    const p = getPaymentProvider() as MockPaymentProvider
    const { body, signature } = p.buildSignedWebhook({
      eventId: 'evt-orphan', orderRef: '', providerPaymentId: 'pay-o', status: 'paid',
      amountMinor: toMinor(200), currency: 'ILS', customerEmail: 'nobody@example.com',
    })
    await handlePaymentWebhook(new Request('http://internal/api/webhooks/payment', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-mock-signature': signature }, body,
    }))

    const result = await runReconciliation()
    expect(result.unmatchedPayments).toBe(1)
    expect(result.alerted).toBe(true)
  })

  it('does not flag a card that is legitimately scheduled for the future', async () => {
    const future = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()
    const { giftCardId: id } = await createPurchase({ ...base, deliveryTiming: 'scheduled', scheduledDeliveryAt: future })
    const p = getPaymentProvider() as MockPaymentProvider
    const { body, signature } = p.buildSignedWebhook({
      eventId: 'evt-s', orderRef: id!, providerPaymentId: 'pay-s', status: 'paid',
      amountMinor: toMinor(200), currency: 'ILS',
    })
    await handlePaymentWebhook(new Request('http://internal/api/webhooks/payment', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-mock-signature': signature }, body,
    }))

    expect((await runReconciliation()).undelivered).toBe(0)
  })
})

describe('provider-side reconciliation (the charge that never reached us)', () => {
  it('catches a charge the provider took that we have no record of', async () => {
    // The provider charges the customer, but the callback never arrives — a
    // webhook pointed at the wrong URL, a Make scenario that failed, our
    // outage. Our own tables cannot show this: to them, nobody ever bought.
    const p = getPaymentProvider() as MockPaymentProvider
    p.buildSignedWebhook({
      eventId: 'evt-lost', orderRef: '', providerPaymentId: 'grow-tx-999', status: 'paid',
      amountMinor: toMinor(250), currency: 'ILS', customerEmail: 'zahiasa@1to1landscape.com',
    })
    // …and we never call handlePaymentWebhook with it.

    const result = await runReconciliation()
    expect(result.untrackedCharges).toBe(1)
    expect(result.providerCheckError).toBeNull()
    expect(result.alerted).toBe(true)
  })

  it('does not flag a charge whose callback DID reach us', async () => {
    await boughtAndDelivered()
    const result = await runReconciliation()
    expect(result.untrackedCharges).toBe(0)
  })

  it('still counts an unmatched callback as tracked — it reached us, it just found no card', async () => {
    const p = getPaymentProvider() as MockPaymentProvider
    const { body, signature } = p.buildSignedWebhook({
      eventId: 'grow-tx-777', orderRef: '', providerPaymentId: 'grow-tx-777', status: 'paid',
      amountMinor: toMinor(200), currency: 'ILS', customerEmail: 'nobody@example.com',
    })
    await handlePaymentWebhook(new Request('http://internal/api/webhooks/payment', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-mock-signature': signature }, body,
    }))

    const result = await runReconciliation()
    // Reported once, as an unmatched payment — not twice.
    expect(result.unmatchedPayments).toBe(1)
    expect(result.untrackedCharges).toBe(0)
  })
})
