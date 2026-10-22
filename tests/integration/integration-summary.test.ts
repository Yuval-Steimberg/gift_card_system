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

import { GET } from '@/app/api/integration/v1/summary/route'
import { integrationKeyOk } from '@/lib/integration/summary'

const KEY = 'k'.repeat(40)
const call = (auth?: string) => GET(new Request('http://internal/api/integration/v1/summary', { headers: auth ? { authorization: auth } : {} }))

beforeEach(() => {
  _resetStore()
  _resetPaymentProvider()
  process.env.INTEGRATION_API_KEY = KEY
})
afterEach(() => {
  delete process.env.INTEGRATION_API_KEY
})

describe('GET /api/integration/v1/summary', () => {
  it('is OFF (404) unless a 32+ character key is configured', async () => {
    delete process.env.INTEGRATION_API_KEY
    expect((await call(`Bearer ${KEY}`)).status).toBe(404)
    process.env.INTEGRATION_API_KEY = 'short'
    expect((await call('Bearer short')).status).toBe(404)
  })

  it('rejects a missing or wrong key', async () => {
    expect((await call()).status).toBe(401)
    expect((await call(`Bearer ${KEY}x`)).status).toBe(401)
    expect((await call(KEY)).status).toBe(401) // the scheme is required
  })

  it('returns the same figures as the admin dashboard', async () => {
    const id = await buy(200, 'e1')
    await buy(350, 'e2')
    await createPurchase({ ...baseInput, amountMinor: toMinor(999) }) // unpaid checkout: not a sale
    await getStore().redeem({ giftCardId: id, amountMinor: toMinor(80), employeeId: 'e', idempotencyKey: 'r1' })
    const res = await call(`Bearer ${KEY}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body.version).toBe(1)
    expect(body.stats).toMatchObject({ soldTotal: 2, totalSalesMinor: toMinor(550), redeemedMinor: toMinor(80), outstandingMinor: toMinor(470), partiallyRedeemed: 1 })
    expect(body.deliveryHealth).toMatchObject({ windowDays: 14, unmatchedPayments: 0, paidNotActivated: 0 })
  })

  it('never returns a code, token, name or email address', async () => {
    const id = await buy(200, 'e1')
    const card = await getStore().getGiftCardById(id)
    const text = await (await call(`Bearer ${KEY}`)).text()
    expect(text).not.toContain('@')
    expect(text).not.toContain(card!.code)
    expect(text).not.toContain(card!.publicToken)
    expect(text).not.toContain(baseInput.recipientName)
  })
})

describe('integrationKeyOk', () => {
  it('requires the Bearer scheme and the exact key', () => {
    expect(integrationKeyOk(`Bearer ${KEY}`, KEY)).toBe(true)
    expect(integrationKeyOk(`Bearer ${KEY} `, KEY)).toBe(true) // header whitespace is trimmed
    expect(integrationKeyOk(`bearer ${KEY}`, KEY)).toBe(false)
    expect(integrationKeyOk(null, KEY)).toBe(false)
    expect(integrationKeyOk(`Bearer ${KEY}`, undefined)).toBe(false)
  })
})
