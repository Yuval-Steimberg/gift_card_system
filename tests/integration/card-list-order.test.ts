import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

async function checkout(): Promise<string> {
  const res = await createPurchase(baseInput)
  expect(res.ok).toBe(true)
  return res.giftCardId!
}

async function pay(id: string, eventId: string): Promise<void> {
  const provider = getPaymentProvider() as MockPaymentProvider
  const { body, signature } = provider.buildSignedWebhook({
    eventId,
    orderRef: id,
    providerPaymentId: `pay-${eventId}`,
    status: 'paid',
    amountMinor: baseInput.amountMinor,
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
}

let clock = Date.parse('2026-11-01T08:00:00Z')
const tick = () => vi.setSystemTime((clock += 60_000))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  tick()
  _resetStore()
  _resetPaymentProvider()
})
afterEach(() => vi.useRealTimers())

describe('admin card list order', () => {
  it('shows a card paid today first even if its checkout started before newer cards', async () => {
    const early = await checkout() // checkout opened first…
    tick()
    const paidEarlier = await checkout()
    tick()
    const unpaid = await checkout()
    tick()
    await pay(paidEarlier, 'evt-1')
    tick()
    await pay(early, 'evt-2') // …but paid last → newest sale

    const { items } = await getStore().listGiftCards({ limit: 50 })
    expect(items.map((c) => c.id)).toEqual([early, paidEarlier, unpaid])
  })
})
