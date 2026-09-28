import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { _resetStore, getStore } from '@/lib/data'
import { _resetPaymentProvider, getPaymentProvider } from '@/lib/payments'
import { MockPaymentProvider } from '@/lib/payments/mock'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'
import { _resetEmailProvider, getEmailProvider } from '@/lib/delivery/email'
import { parseEmailEvents } from '@/lib/delivery/email/events'
import { createPurchase, deliverDueJobs, resendAllUndelivered, resendGiftCard } from '@/lib/gift-cards/service'
import { runReconciliation } from '@/lib/gift-cards/reconcile'
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

let n = 0
async function buy(recipientEmail = 'yael@example.com'): Promise<string> {
  n++
  const { giftCardId: id } = await createPurchase({ ...base, recipientEmail })
  const p = getPaymentProvider() as MockPaymentProvider
  const { body, signature } = p.buildSignedWebhook({
    eventId: `evt-${n}`, orderRef: id!, providerPaymentId: `pay-${n}`, status: 'paid',
    amountMinor: toMinor(200), currency: 'ILS',
  })
  await handlePaymentWebhook(new Request('http://internal/api/webhooks/payment', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-mock-signature': signature }, body,
  }))
  return id!
}

/** What SendGrid did after the free trial ended: reject every send. */
let providerDown = false
let recipientSends: string[] = []

beforeEach(() => {
  _resetStore(); _resetPaymentProvider(); _resetEmailProvider()
  providerDown = false
  recipientSends = []
  const provider = getEmailProvider()
  const real = provider.send.bind(provider)
  vi.spyOn(provider, 'send').mockImplementation(async (msg) => {
    if (providerDown) throw new Error('SendGrid send failed (401): {"errors":[{"message":"Maximum credits exceeded"}]}')
    if (msg.metadata?.kind === 'recipient') recipientSends.push(msg.to)
    return real(msg)
  })
})
afterEach(() => vi.restoreAllMocks())

describe('recovering from an email-provider outage', () => {
  it('shows the failure, resends everything in one step, and the count goes back to zero', async () => {
    providerDown = true
    const a = await buy()
    const b = await buy('other@example.com')
    // Paid, active, and nothing went out.
    expect((await getStore().getGiftCardById(a))!.status).toBe('active')
    expect(await getStore().countCardsWithFailedDelivery()).toBe(2)

    providerDown = false // owner upgraded the SendGrid plan
    const res = await resendAllUndelivered()
    expect(res).toMatchObject({ queued: 2, delivered: 2, rejected: [] })
    expect(recipientSends.sort()).toEqual(['other@example.com', 'yael@example.com'])
    expect(await getStore().countCardsWithFailedDelivery()).toBe(0)
    expect((await runReconciliation({ notify: false })).needsAttention).toBe(false)
    void b
  })

  it('never emails the recipient twice when the old failed job is retried later', async () => {
    providerDown = true
    const id = await buy()
    providerDown = false
    expect((await resendGiftCard(id)).ok).toBe(true)
    expect(recipientSends).toEqual(['yael@example.com'])

    // The cron runs again: the old failed job (attempts < 5) is still claimable.
    await deliverDueJobs(new Date(Date.now() + 1000).toISOString(), 50)
    await deliverDueJobs(new Date(Date.now() + 2000).toISOString(), 50)
    expect(recipientSends).toEqual(['yael@example.com'])
    expect(await getStore().countCardsWithFailedDelivery()).toBe(0)
  })

  it('a deliberate resend of an already-delivered card still goes out', async () => {
    const id = await buy()
    expect(recipientSends).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 5))
    expect((await resendGiftCard(id)).ok).toBe(true)
    expect(recipientSends).toHaveLength(2)
  })

  it('does not resend to an address the receiving server rejected', async () => {
    const id = await buy()
    const [job] = await getStore().getDeliveryJobs(id)
    await getStore().applyEmailProviderEvents('sendgrid', parseEmailEvents([{
      event: 'bounce', email: 'yael@example.com', timestamp: Math.floor(Date.now() / 1000),
      sg_message_id: 'm.x', reason: '550 no such user', jobId: job!.id, giftCardId: id,
    }]))
    recipientSends = []
    const res = await resendAllUndelivered()
    expect(res.queued).toBe(0)
    expect(res.rejected.map((r) => r.id)).toEqual([id])
    expect(recipientSends).toEqual([])
  })

  it('reports a failed send while the provider is still down, instead of claiming success', async () => {
    providerDown = true
    await buy()
    const res = await resendAllUndelivered()
    expect(res.queued).toBe(1)
    expect(res.delivered).toBe(0)
  })

  it('check-only reconciliation flags the outage without sending an email', async () => {
    providerDown = true
    await buy()
    const send = vi.mocked(getEmailProvider().send)
    send.mockClear()
    const r = await runReconciliation({ notify: false })
    expect(r).toMatchObject({ undelivered: 1, needsAttention: true, alerted: false })
    expect(send).not.toHaveBeenCalled()
  })
})
