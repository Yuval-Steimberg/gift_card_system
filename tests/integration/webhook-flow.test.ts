import { describe, it, expect, beforeEach } from 'vitest'
import { _resetStore, getStore } from '@/lib/data'
import { _resetPaymentProvider, getPaymentProvider } from '@/lib/payments'
import { MockPaymentProvider } from '@/lib/payments/mock'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'
import { createPurchase, getPublicView } from '@/lib/gift-cards/service'
import { generateGiftCardPdf } from '@/lib/gift-cards/pdf'
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
  greeting: 'מזל טוב יעל!\nמגיע לך משהו יפה מהחנות.\nבאהבה, דנה',
  deliveryTiming: 'immediate',
  scheduledDeliveryAt: null,
  senderTimezone: 'Asia/Jerusalem',
  acceptedTerms: true,
}

function signedWebhook(giftCardId: string, amountMinor: number, eventId: string) {
  const provider = getPaymentProvider() as MockPaymentProvider
  const { body, signature } = provider.buildSignedWebhook({
    eventId,
    orderRef: giftCardId,
    providerPaymentId: `pay-${eventId}`,
    status: 'paid',
    amountMinor,
    currency: 'ILS',
  })
  return new Request('http://internal/api/webhooks/payment', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mock-signature': signature },
    body,
  })
}

beforeEach(() => {
  _resetStore()
  _resetPaymentProvider()
})

describe('purchase -> verified webhook -> activation (end to end via service)', () => {
  it('activates exactly one card and delivers once, idempotently', async () => {
    const res = await createPurchase(baseInput)
    expect(res.ok).toBe(true)
    const id = res.giftCardId!

    // Before payment: draft, no balance.
    let card = await getStore().getGiftCardById(id)
    expect(card?.status).toBe('awaiting_payment')
    expect(card?.balanceMinor).toBe(0)

    // First verified webhook.
    const out1 = await handlePaymentWebhook(signedWebhook(id, toMinor(200), 'evt-1'))
    expect(out1.status).toBe(200)
    card = await getStore().getGiftCardById(id)
    expect(card?.status).toBe('active')
    expect(card?.balanceMinor).toBe(toMinor(200))

    // Duplicate webhook (same event) -> no double credit, no double delivery.
    const out2 = await handlePaymentWebhook(signedWebhook(id, toMinor(200), 'evt-1'))
    expect(out2.status).toBe(200)
    const ledger = await getStore().getLedger(id)
    expect(ledger.filter((e) => e.type === 'initial_credit')).toHaveLength(1)
    const jobs = await getStore().getDeliveryJobs(id)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.status).toBe('delivered')
  })

  it('rejects an unsigned/forged webhook (400, no activation)', async () => {
    const res = await createPurchase(baseInput)
    const id = res.giftCardId!
    const forged = new Request('http://internal/api/webhooks/payment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' }, // no signature
      body: JSON.stringify({ orderRef: id, amountMinor: toMinor(200), status: 'paid', providerPaymentId: 'x', eventId: 'forged' }),
    })
    const out = await handlePaymentWebhook(forged)
    expect(out.status).toBe(400)
    const card = await getStore().getGiftCardById(id)
    expect(card?.status).toBe('awaiting_payment')
    expect(card?.balanceMinor).toBe(0)
  })
})

describe('public view + PDF', () => {
  it('minimizes PII and hides anonymous sender', async () => {
    const res = await createPurchase({ ...baseInput, sendAnonymously: true })
    const id = res.giftCardId!
    await handlePaymentWebhook(signedWebhook(id, toMinor(200), 'evt-anon'))
    const card = await getStore().getGiftCardById(id)
    const view = await getPublicView(card!.publicToken)
    expect(view).not.toBeNull()
    expect(view!.senderName).toBeNull()
    // no buyer email / phone exposed on the public view shape
    expect(Object.keys(view!)).not.toContain('buyerEmail')
  })

  it('generates a valid PDF for Hebrew content without throwing', async () => {
    const res = await createPurchase(baseInput)
    const id = res.giftCardId!
    await handlePaymentWebhook(signedWebhook(id, toMinor(200), 'evt-pdf'))
    const store = getStore()
    const card = await store.getGiftCardById(id)
    const template = await store.getTemplate(card!.templateId)
    const pdf = await generateGiftCardPdf(card!, template!, 'http://localhost:3000')
    expect(pdf.byteLength).toBeGreaterThan(500)
    // %PDF header
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toContain('%PDF')
  })
})
