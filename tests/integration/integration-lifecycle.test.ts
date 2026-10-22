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

import { POST as lifecycle } from '@/app/api/integration/v1/cards/[id]/lifecycle/route'

const KEY = 'k'.repeat(40)
const auth = { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }
const actor = { email: 'owner@justasecond.co.il', role: 'owner' }
const call = (id: string, body: Record<string, unknown>) =>
  lifecycle(new Request(`http://internal/api/integration/v1/cards/${id}/lifecycle`, { method: 'POST', headers: auth, body: JSON.stringify({ actor, reason: 'checked with the customer', ...body }) }), { params: { id } })

beforeEach(() => {
  _resetStore()
  _resetPaymentProvider()
  process.env.INTEGRATION_API_KEY = KEY
})
afterEach(() => {
  delete process.env.INTEGRATION_API_KEY
  vi.restoreAllMocks()
})

describe('money-moving card actions from the command center', () => {
  it('is behind the key gate and needs an actor and a known op', async () => {
    const id = await buy(200, 'e1')
    const anon = await lifecycle(new Request(`http://internal/x`, { method: 'POST', body: '{}' }), { params: { id } })
    expect(anon.status).toBe(401)
    expect((await call(id, { op: 'delete' })).status).toBe(400)
    expect((await call(id, { op: 'suspend', actor: undefined })).status).toBe(400)
  })

  it('suspends and reactivates through the status machine, and refuses an illegal move', async () => {
    const id = await buy(200, 'e1')
    expect(await (await call(id, { op: 'suspend' })).json()).toMatchObject({ ok: true })
    expect((await getStore().getGiftCardById(id))!.status).toBe('suspended')
    expect(await (await call(id, { op: 'reactivate' })).json()).toMatchObject({ ok: true })
    expect((await getStore().getGiftCardById(id))!.status).toBe('active')
    await call(id, { op: 'cancel' })
    const res = await call(id, { op: 'reactivate' })
    expect(res.status).toBe(422)
    const audit = await getStore().getAudit('gift_card', id)
    expect(audit.find((a) => a.action === 'giftcard.status.suspended')).toMatchObject({ actorRole: 'command_center' })
  })

  it('adjusts the balance once per request id', async () => {
    const id = await buy(200, 'e1')
    const requestId = '11111111-1111-4111-8111-111111111111'
    await call(id, { op: 'adjust', direction: 'decrease', amountMinor: toMinor(50), requestId })
    await call(id, { op: 'adjust', direction: 'decrease', amountMinor: toMinor(50), requestId })
    expect((await getStore().getGiftCardById(id))!.balanceMinor).toBe(toMinor(150))
    const tooMuch = await call(id, { op: 'adjust', direction: 'decrease', amountMinor: toMinor(500), requestId: '22222222-2222-4222-8222-222222222222' })
    expect(tooMuch.status).toBe(422)
    expect((await call(id, { op: 'adjust', direction: 'increase', amountMinor: toMinor(5) })).status).toBe(400) // no request id
  })

  it('refunds only the remaining balance and says whether the provider returned it', async () => {
    const id = await buy(200, 'e1')
    await call(id, { op: 'adjust', direction: 'decrease', amountMinor: toMinor(50), requestId: '33333333-3333-4333-8333-333333333333' })
    const spy = vi.spyOn(getPaymentProvider(), 'refundPayment')
    const body = await (await call(id, { op: 'refund' })).json()
    expect(body).toMatchObject({ ok: true, provider: 'refunded', refundedMinor: toMinor(150) })
    expect(spy.mock.calls[0]![0]).toMatchObject({ amountMinor: toMinor(150) })
    const card = (await getStore().getGiftCardById(id))!
    expect(card).toMatchObject({ status: 'refunded', balanceMinor: 0 })
  })

  it('a failed provider refund is reported, never claimed as done', async () => {
    const id = await buy(200, 'e1')
    vi.spyOn(getPaymentProvider(), 'refundPayment').mockRejectedValue(new Error('no GROW_API_KEY'))
    const body = await (await call(id, { op: 'refund' })).json()
    expect(body).toMatchObject({ ok: true, provider: 'failed' })
    expect(body.message).toMatch(/זיכוי ידני ב-Grow/)
    const audit = await getStore().getAudit('gift_card', id)
    expect(audit.find((a) => a.action === 'giftcard.provider_refund')?.metadata).toMatchObject({ outcome: 'failed', error: 'no GROW_API_KEY' })
  })

  it('refusing an illegal refund leaves the balance untouched', async () => {
    const id = await buy(200, 'e1')
    await call(id, { op: 'cancel' })
    const before = (await getStore().getGiftCardById(id))!.balanceMinor
    expect((await call(id, { op: 'refund' })).status).toBe(422)
    expect((await getStore().getGiftCardById(id))!.balanceMinor).toBe(before)
  })

  it('reissues and returns only the masked code of the new card', async () => {
    const id = await buy(200, 'e1')
    const res = await call(id, { op: 'reissue' })
    const text = await res.text()
    const body = JSON.parse(text)
    expect(body.ok).toBe(true)
    const next = (await getStore().getGiftCardById(body.newCard.id))!
    expect(text).not.toContain(next.code)
    expect(body.newCard.maskedCode).toMatch(/^••••-/)
  })

  it('marks an unpaid card paid through the verified activation path', async () => {
    const res0 = await createPurchase({ ...baseInput })
    const id = res0.giftCardId!
    const body = await (await call(id, { op: 'mark_paid' })).json()
    expect(body).toMatchObject({ ok: true })
    const card = (await getStore().getGiftCardById(id))!
    expect(card.status).toBe('active')
    expect(card.balanceMinor).toBe(toMinor(200))
    const audit = await getStore().getAudit('gift_card', id)
    expect(audit.find((a) => a.action === 'giftcard.manual_activate')).toMatchObject({ actorRole: 'command_center' })
    // Already active: a second click is a no-op, not a second credit.
    expect(await (await call(id, { op: 'mark_paid' })).json()).toMatchObject({ ok: true, message: 'השובר כבר פעיל' })
    expect((await getStore().getGiftCardById(id))!.balanceMinor).toBe(toMinor(200))
  })
})
