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

import { GET as search } from '@/app/api/integration/v1/cards/route'
import { GET as detail } from '@/app/api/integration/v1/cards/[id]/route'
import { POST as resend } from '@/app/api/integration/v1/cards/[id]/resend/route'
import { POST as recipient } from '@/app/api/integration/v1/cards/[id]/recipient/route'
import { POST as resendAll } from '@/app/api/integration/v1/delivery/resend-undelivered/route'

const KEY = 'k'.repeat(40)
const auth = { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }
const actor = { email: 'owner@justasecond.co.il', role: 'owner' }
const get = (path: string) => new Request(`http://internal${path}`, { headers: auth })
const post = (path: string, body: unknown) => new Request(`http://internal${path}`, { method: 'POST', headers: auth, body: JSON.stringify(body) })

beforeEach(() => {
  _resetStore()
  _resetPaymentProvider()
  process.env.INTEGRATION_API_KEY = KEY
})
afterEach(() => {
  delete process.env.INTEGRATION_API_KEY
})

describe('card search and detail for the command center', () => {
  it('is behind the same key gate as the summary', async () => {
    expect((await search(new Request('http://internal/api/integration/v1/cards'))).status).toBe(401)
    delete process.env.INTEGRATION_API_KEY
    expect((await search(get('/api/integration/v1/cards'))).status).toBe(404)
  })

  it('finds a card by recipient and never returns its full code or token', async () => {
    const id = await buy(200, 'e1')
    const card = (await getStore().getGiftCardById(id))!
    const res = await search(get('/api/integration/v1/cards?q=yael'))
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(JSON.parse(text)).toMatchObject({ total: 1, items: [{ id, status: 'active', balanceMinor: toMinor(200), maskedCode: `••••-${card.code.replace(/[^A-Za-z0-9]/g, '').slice(-4)}` }] })
    expect(text).not.toContain(card.code)
    expect(text).not.toContain(card.publicToken)
  })

  it('returns delivery, ledger and audit for one card, masked', async () => {
    const id = await buy(200, 'e1')
    const card = (await getStore().getGiftCardById(id))!
    const res = await detail(get(`/api/integration/v1/cards/${id}`), { params: { id } })
    const text = await res.text()
    const body = JSON.parse(text)
    expect(body.card.id).toBe(id)
    expect(body.delivery.length).toBeGreaterThan(0)
    expect(body.ledger[0]).toMatchObject({ amountMinor: toMinor(200) })
    expect(text).not.toContain(card.code)
    expect(text).not.toContain(card.publicToken)
    expect((await detail(get('/api/integration/v1/cards/x'), { params: { id: 'x' } })).status).toBe(400)
  })
})

describe('writes from the command center', () => {
  it('edits the recipient with the /admin rules and records who did it', async () => {
    const id = await buy(200, 'e1')
    const bad = await recipient(post(`/api/integration/v1/cards/${id}/recipient`, { actor, reason: 'bounced', fields: { recipientEmail: 'yael@gmial.com' } }), { params: { id } })
    expect(bad.status).toBe(422)
    expect((await bad.json()).message).toMatch(/gmail\.com/)

    const ok = await recipient(post(`/api/integration/v1/cards/${id}/recipient`, { actor, reason: 'bounced', resend: true, fields: { recipientEmail: 'yael.levi@gmail.com', recipientName: '' } }), { params: { id } })
    expect(await ok.json()).toMatchObject({ ok: true, resent: true })
    const card = (await getStore().getGiftCardById(id))!
    expect(card.recipientEmail).toBe('yael.levi@gmail.com')
    expect(card.recipientName).toBe('יעל לוי') // a blank field never wipes
    const audit = await getStore().getAudit('gift_card', id)
    expect(audit.some((a) => a.actorRole === 'command_center' && a.reason?.includes('owner@justasecond.co.il'))).toBe(true)
  })

  it('resends one card and audits it; a body without an actor is refused', async () => {
    const id = await buy(200, 'e1')
    expect((await resend(post(`/api/integration/v1/cards/${id}/resend`, { reason: 'customer asked' }), { params: { id } })).status).toBe(400)
    const res = await resend(post(`/api/integration/v1/cards/${id}/resend`, { actor, reason: 'customer asked' }), { params: { id } })
    expect(await res.json()).toMatchObject({ ok: true })
    const audit = await getStore().getAudit('gift_card', id)
    expect(audit.find((a) => a.action === 'giftcard.resend')).toMatchObject({ actorRole: 'command_center' })
  })

  it('resend-all reports what it did', async () => {
    await buy(200, 'e1')
    const res = await resendAll(post('/api/integration/v1/delivery/resend-undelivered', { actor }))
    expect(await res.json()).toMatchObject({ queued: 0, delivered: 0, rejected: [] })
  })
})
