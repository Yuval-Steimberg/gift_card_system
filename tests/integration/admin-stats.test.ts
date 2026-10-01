import { describe, it, expect, beforeEach } from 'vitest'
import { _resetStore, getStore } from '@/lib/data'
import { _resetPaymentProvider, getPaymentProvider } from '@/lib/payments'
import { MockPaymentProvider } from '@/lib/payments/mock'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'
import { createPurchase } from '@/lib/gift-cards/service'
import { getAdminStats, reissueCard, refundCard } from '@/lib/gift-cards/admin-service'
import { toMinor } from '@/lib/money'
import type { PurchaseInput } from '@/lib/validation/purchase'

const baseInput: PurchaseInput = {
  amountMinor: toMinor(200),
  templateId: 'tpl-celebration',
  buyerName: 'דנה כהן',
  buyerEmail: 'dana@example.com',
  buyerPhone: '',
  buyerCompany: '',
  buyerTaxId: '',
  wantsInvoice: false,
  showBuyerName: true,
  sendAnonymously: false,
  recipientName: 'יעל לוי',
  recipientEmail: 'yael@example.com',
  recipientPhone: '',
  recipientLanguage: 'he',
  deliveryChannel: 'email',
  greeting: '',
  deliveryTiming: 'immediate',
  scheduledDeliveryAt: null,
  senderTimezone: 'Asia/Jerusalem',
  acceptedTerms: true,
}

const actor = { actorId: 'owner', actorRole: 'owner', reason: 'test' }

/** Buy a card through the real checkout + verified-webhook path. */
async function buy(amount: number, eventId: string): Promise<string> {
  const res = await createPurchase({ ...baseInput, amountMinor: toMinor(amount) })
  expect(res.ok).toBe(true)
  const id = res.giftCardId!
  const provider = getPaymentProvider() as MockPaymentProvider
  const { body, signature } = provider.buildSignedWebhook({
    eventId,
    orderRef: id,
    providerPaymentId: `pay-${eventId}`,
    status: 'paid',
    amountMinor: toMinor(amount),
    currency: 'ILS',
  })
  const out = await handlePaymentWebhook(
    new Request('http://internal/api/webhooks/payment', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
      body,
    }),
  )
  expect(out.status).toBe(200)
  return id
}

beforeEach(() => {
  _resetStore()
  _resetPaymentProvider()
})

describe('admin stats follow every purchase', () => {
  it('starts at zero and counts each new paid card in count, amount and windows', async () => {
    let s = await getAdminStats()
    expect(s.soldTotal).toBe(0)
    expect(s.totalSalesMinor).toBe(0)

    await buy(200, 'e1')
    s = await getAdminStats()
    expect(s).toMatchObject({
      soldTotal: 1,
      soldToday: 1,
      soldWeek: 1,
      soldMonth: 1,
      totalSalesMinor: toMinor(200),
      outstandingMinor: toMinor(200),
      redeemedMinor: 0,
      active: 1,
    })

    await buy(350, 'e2')
    s = await getAdminStats()
    expect(s.soldTotal).toBe(2)
    expect(s.soldToday).toBe(2)
    expect(s.totalSalesMinor).toBe(toMinor(550))
    expect(s.outstandingMinor).toBe(toMinor(550))
    expect(s.active).toBe(2)
  })

  it('does not count an unpaid checkout as a sale', async () => {
    await buy(200, 'e1')
    await createPurchase({ ...baseInput, amountMinor: toMinor(500) }) // never paid
    const s = await getAdminStats()
    expect(s.soldTotal).toBe(1)
    expect(s.totalSalesMinor).toBe(toMinor(200))
  })

  it('moves value from outstanding to redeemed on redemption', async () => {
    const id = await buy(200, 'e1')
    await getStore().redeem({ giftCardId: id, amountMinor: toMinor(80), employeeId: 'e', idempotencyKey: 'r1' })
    const s = await getAdminStats()
    expect(s.totalSalesMinor).toBe(toMinor(200))
    expect(s.redeemedMinor).toBe(toMinor(80))
    expect(s.outstandingMinor).toBe(toMinor(120))
    expect(s.partiallyRedeemed).toBe(1)
    expect(s.active).toBe(0)
  })

  it('a reissue is a replacement, not a second sale', async () => {
    const id = await buy(200, 'e1')
    await getStore().redeem({ giftCardId: id, amountMinor: toMinor(50), employeeId: 'e', idempotencyKey: 'r1' })
    const r = await reissueCard(id, actor)
    expect(r.ok).toBe(true)
    const s = await getAdminStats()
    expect(s.soldTotal).toBe(1)
    expect(s.soldToday).toBe(1)
    expect(s.totalSalesMinor).toBe(toMinor(200))
    expect(s.redeemedMinor).toBe(toMinor(50))
    expect(s.outstandingMinor).toBe(toMinor(150))
  })

  it('a refund leaves sales and outstanding', async () => {
    const id = await buy(200, 'e1')
    await buy(100, 'e2')
    expect((await refundCard(id, actor)).ok).toBe(true)
    const s = await getAdminStats()
    expect(s.soldTotal).toBe(1)
    expect(s.totalSalesMinor).toBe(toMinor(100))
    expect(s.outstandingMinor).toBe(toMinor(100))
    expect(s.refunded).toBe(1)
  })
})
