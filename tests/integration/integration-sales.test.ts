import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { _resetStore, getStore } from '@/lib/data'
import { _resetPaymentProvider, getPaymentProvider } from '@/lib/payments'
import { MockPaymentProvider } from '@/lib/payments/mock'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'
import { createPurchase } from '@/lib/gift-cards/service'
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

import { GET } from '@/app/api/integration/v1/sales/route'
import { bucketPeriod, israelDay, previousRange } from '@/lib/integration/sales'
import type { GiftCard } from '@/lib/gift-cards/types'

const KEY = 'k'.repeat(40)
const call = (qs: string, auth: string | null = `Bearer ${KEY}`) =>
  GET(new Request(`http://internal/api/integration/v1/sales?${qs}`, { headers: auth ? { authorization: auth } : {} }))

beforeEach(() => {
  _resetStore()
  _resetPaymentProvider()
  process.env.INTEGRATION_API_KEY = KEY
})
afterEach(() => {
  delete process.env.INTEGRATION_API_KEY
})

describe('GET /api/integration/v1/sales', () => {
  it('uses the same key gate as the summary', async () => {
    expect((await call('from=2026-10-01&to=2026-10-07', null)).status).toBe(401)
    delete process.env.INTEGRATION_API_KEY
    expect((await call('from=2026-10-01&to=2026-10-07')).status).toBe(404)
  })

  it('rejects a bad range', async () => {
    expect((await call('from=2026-10-07&to=2026-10-01')).status).toBe(400)
    expect((await call('from=2026-10-01')).status).toBe(400)
    expect((await call('from=2024-01-01&to=2026-10-01')).status).toBe(400)
    expect((await call('from=yesterday&to=2026-10-01')).status).toBe(400)
  })

  it('reports today’s sales and redemptions with the admin definition of a sale', async () => {
    const id = await buy(200, 'e1')
    await buy(350, 'e2')
    await createPurchase({ ...baseInput, amountMinor: toMinor(999) }) // unpaid checkout: not a sale
    const store = getStore()
    await store.redeem({ giftCardId: id, amountMinor: toMinor(80), employeeId: 'e', idempotencyKey: 'r1' })
    const r2 = await store.redeem({ giftCardId: id, amountMinor: toMinor(20), employeeId: 'e', idempotencyKey: 'r2' })
    await store.reverseRedemption({ redemptionId: r2.redemption!.id, reason: 'mistake', requestedBy: 'e', approvedBy: 'o' })
    const today = israelDay(new Date().toISOString())
    const res = await call(`from=${today}&to=${today}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body.current.totals).toMatchObject({
      cardsSold: 2,
      salesMinor: toMinor(550),
      redemptions: 1,
      redeemedMinor: toMinor(80),
      reversedRedemptions: 1,
      reversedMinor: toMinor(20),
      averageCardMinor: toMinor(275),
    })
    expect(body.current.daily).toHaveLength(1)
    expect(body.previous.totals.cardsSold).toBe(0)
    expect(body.current.byTemplate[0]).toMatchObject({ templateId: 'tpl-celebration', cardsSold: 2 })
  })

  it('never returns a code, token, name or email address', async () => {
    const id = await buy(200, 'e1')
    const card = await getStore().getGiftCardById(id)
    const today = israelDay(new Date().toISOString())
    const text = await (await call(`from=${today}&to=${today}`)).text()
    expect(text).not.toContain('@')
    expect(text).not.toContain(card!.code)
    expect(text).not.toContain(card!.publicToken)
    expect(text).not.toContain(baseInput.recipientName)
  })
})

describe('bucketPeriod', () => {
  const card = (over: Partial<GiftCard>) => ({ id: Math.random().toString(), status: 'active', initialAmountMinor: 10000, balanceMinor: 10000, templateId: 't', issuedAt: null, supersededByCardId: null, ...over }) as GiftCard

  it('buckets by the ISRAEL day, not the UTC day', () => {
    // 22:30 UTC on 1 Oct is 01:30 on 2 Oct in Israel (UTC+3 in October).
    const p = bucketPeriod('2026-10-01', '2026-10-02', [card({ issuedAt: '2026-10-01T22:30:00Z' })], [], new Map())
    expect(p.daily.map((d) => d.cardsSold)).toEqual([0, 1])
  })

  it('counts a reissue once, on the original card', () => {
    const original = card({ id: 'a', status: 'reissued', issuedAt: '2026-10-01T09:00:00Z', supersededByCardId: 'b' })
    const replacement = card({ id: 'b', status: 'active', issuedAt: '2026-10-02T09:00:00Z' })
    const p = bucketPeriod('2026-10-01', '2026-10-02', [original, replacement], [], new Map())
    expect(p.daily.map((d) => d.cardsSold)).toEqual([1, 0])
  })

  it('previousRange is the equally long period right before', () => {
    expect(previousRange('2026-10-01', '2026-10-07')).toEqual({ from: '2026-09-24', to: '2026-09-30' })
  })
})
