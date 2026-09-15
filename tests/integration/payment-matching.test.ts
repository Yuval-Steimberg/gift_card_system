import { describe, it, expect, beforeEach } from 'vitest'
import { _resetStore, getStore } from '@/lib/data'
import { _resetPaymentProvider, getPaymentProvider } from '@/lib/payments'
import { MockPaymentProvider } from '@/lib/payments/mock'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'
import { createPurchase } from '@/lib/gift-cards/service'
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

/** A Grow-shaped callback: NO order_ref, identified only by payer email + amount. */
function callback(opts: { eventId: string; email?: string; amountMinor?: number; orderRef?: string }) {
  const p = getPaymentProvider() as MockPaymentProvider
  const { body, signature } = p.buildSignedWebhook({
    eventId: opts.eventId,
    orderRef: opts.orderRef ?? '',
    providerPaymentId: `pay-${opts.eventId}`,
    status: 'paid',
    amountMinor: opts.amountMinor ?? toMinor(200),
    currency: 'ILS',
    customerEmail: opts.email,
  })
  return new Request('http://internal/api/webhooks/payment', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
    body,
  })
}

const statusOf = async (id: string) => (await getStore().getGiftCardById(id))!.status

beforeEach(() => { _resetStore(); _resetPaymentProvider() })

describe('payment webhook matching (no order_ref, Grow Payment Links)', () => {
  it('matches on the payer = buyer address', async () => {
    const { giftCardId: id } = await createPurchase(base)
    await handlePaymentWebhook(callback({ eventId: 'e1', email: 'office@1to1landscape.com' }))
    expect(await statusOf(id!)).toBe('active')
  })

  it('matches on the payer = RECIPIENT address (bought for a colleague)', async () => {
    const { giftCardId: id } = await createPurchase(base)
    await handlePaymentWebhook(callback({ eventId: 'e1', email: 'yoav@1to1landscape.com' }))
    expect(await statusOf(id!)).toBe('active')
  })

  it('is case-insensitive about the payer address', async () => {
    const { giftCardId: id } = await createPurchase(base)
    await handlePaymentWebhook(callback({ eventId: 'e1', email: 'Office@1to1Landscape.COM ' }))
    expect(await statusOf(id!)).toBe('active')
  })

  it('activates EVERY card when one buyer pays for several identical ones', async () => {
    // The company case: same buyer, same amount, three colleagues. Each callback
    // must land on its own card — the old code could resolve two callbacks to the
    // same pending card, leaving a paid card unactivated and undelivered.
    const a = (await createPurchase({ ...base, recipientEmail: 'zahiasa@1to1landscape.com' })).giftCardId!
    const b = (await createPurchase({ ...base, recipientEmail: 'jorden@1to1landscape.com' })).giftCardId!
    const c = (await createPurchase({ ...base, recipientEmail: 'yoav@1to1landscape.com' })).giftCardId!

    await Promise.all([
      handlePaymentWebhook(callback({ eventId: 'e1', email: 'office@1to1landscape.com' })),
      handlePaymentWebhook(callback({ eventId: 'e2', email: 'office@1to1landscape.com' })),
      handlePaymentWebhook(callback({ eventId: 'e3', email: 'office@1to1landscape.com' })),
    ])

    expect([await statusOf(a), await statusOf(b), await statusOf(c)]).toEqual(['active', 'active', 'active'])
  })

  it('never matches a card for a different amount', async () => {
    const { giftCardId: id } = await createPurchase(base)
    await handlePaymentWebhook(callback({ eventId: 'e1', email: 'office@1to1landscape.com', amountMinor: toMinor(150) }))
    expect(await statusOf(id!)).toBe('awaiting_payment')
  })

  it('records an unmatched callback instead of silently dropping it', async () => {
    await createPurchase(base)
    const res = await handlePaymentWebhook(callback({ eventId: 'e1', email: 'stranger@example.com' }))
    expect(res.status).toBe(200) // never make the provider retry forever

    const audit = await getStore().getAudit('payment_event', 'e1')
    expect(audit.map((a) => a.action)).toContain('payment.webhook_unmatched')
  })

  it('is idempotent: the same callback twice activates once', async () => {
    const { giftCardId: id } = await createPurchase(base)
    await handlePaymentWebhook(callback({ eventId: 'e1', email: 'office@1to1landscape.com' }))
    await handlePaymentWebhook(callback({ eventId: 'e1', email: 'office@1to1landscape.com' }))

    const ledger = await getStore().getLedger(id!)
    expect(ledger.filter((l) => l.type === 'initial_credit')).toHaveLength(1)
  })

  it('still prefers an explicit order_ref when the provider sends one', async () => {
    const a = (await createPurchase(base)).giftCardId!
    const b = (await createPurchase(base)).giftCardId! // newer, same email+amount
    await handlePaymentWebhook(callback({ eventId: 'e1', email: 'office@1to1landscape.com', orderRef: a }))

    expect(await statusOf(a)).toBe('active')
    expect(await statusOf(b)).toBe('awaiting_payment')
  })
})
