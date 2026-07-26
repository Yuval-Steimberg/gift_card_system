import { describe, it, expect, vi, afterEach } from 'vitest'
import { GrowPaymentProvider } from '@/lib/payments/grow'
import type { CreateCheckoutInput } from '@/lib/payments/types'
import { toMinor } from '@/lib/money'

const baseInput: CreateCheckoutInput = {
  orderRef: 'card-uuid-123',
  amountMinor: toMinor(250), // ₪250
  currency: 'ILS',
  description: 'שובר מתנה ₪250',
  customer: { name: 'דנה כהן', email: 'dana@example.com', phone: '050-123-4567' },
  successUrl: 'https://gift.example.com/checkout/confirmation?ref=card-uuid-123',
  cancelUrl: 'https://gift.example.com/checkout/cancelled?ref=card-uuid-123',
  notifyUrl: 'https://gift.example.com/api/webhooks/payment',
}

afterEach(() => vi.restoreAllMocks())

describe('GrowPaymentProvider — Make.com path (matches JAS website)', () => {
  it('POSTs the reference field shape and returns the Grow payment URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://pay.grow.link/abc', process_id: 'proc_1' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const provider = new GrowPaymentProvider({
      apiUrl: 'https://restapi.grow.link',
      apiKey: 'user',
      apiSecret: 'secret',
      pageCode: '1',
      makeWebhookUrl: 'https://hook.make.com/xyz',
    })
    const session = await provider.createCheckoutSession(baseInput)

    expect(session.redirectUrl).toBe('https://pay.grow.link/abc')
    expect(session.provider).toBe('grow')

    // Verify the Make.com body mirrors the reference site's payload.
    const [url, opts] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://hook.make.com/xyz')
    const body = JSON.parse((opts as RequestInit).body as string)
    expect(body.price).toBe(250) // major units (shekels), like the reference
    expect(body.amount).toBe(250)
    expect(body.order_ref).toBe('card-uuid-123')
    expect(body.notify_url).toBe(baseInput.notifyUrl)
    expect(body.success_url).toBe(baseInput.successUrl)
    expect(body.send_method).toBe('none')
    // Israeli phone normalized to a bare 10-digit local number.
    expect(body.phone).toBe('0501234567')
  })
})

describe('GrowPaymentProvider — direct Grow API path', () => {
  it('calls createPaymentProcess with the reference fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 1, data: { url: 'https://pay.grow.link/direct', processId: 'p9' } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const provider = new GrowPaymentProvider({
      apiUrl: 'https://restapi.grow.link',
      apiKey: 'user',
      apiSecret: 'secret',
      pageCode: '7',
    })
    const session = await provider.createCheckoutSession(baseInput)
    expect(session.redirectUrl).toBe('https://pay.grow.link/direct')

    const [url, opts] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://restapi.grow.link/api/light/server/createPaymentProcess')
    const form = new URLSearchParams((opts as RequestInit).body as string)
    expect(form.get('sum')).toBe('250')
    expect(form.get('pageCode')).toBe('7')
    expect(form.get('userId')).toBe('user')
    expect(form.get('apiKey')).toBe('secret')
    expect(form.get('cField1')).toBe('card-uuid-123')
    expect(form.get('maxPayments')).toBe('1')
    expect(form.get('pageField[phone]')).toBe('0501234567')
  })
})

describe('GrowPaymentProvider — webhook parsing (matches reference grow-webhook)', () => {
  const provider = new GrowPaymentProvider({
    apiUrl: 'https://restapi.grow.link',
    apiKey: 'user',
    apiSecret: 'secret',
    pageCode: '1',
    webhookSecret: 'shared-secret',
  })

  it('parses a form-encoded approved Grow callback into a normalized event', async () => {
    const body = new URLSearchParams({ transactionCode: 'TX999', cField1: 'card-uuid-123', sum: '250', statusCode: '1' })
    const req = new Request('http://x/api/webhooks/payment', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const event = await provider.verifyWebhook(req)
    expect(event.status).toBe('paid')
    expect(event.orderRef).toBe('card-uuid-123')
    expect(event.providerPaymentId).toBe('TX999')
    expect(event.amountMinor).toBe(25000) // 250 major -> minor
  })

  it('treats presence of a transactionCode as approved (reference behavior)', async () => {
    const body = new URLSearchParams({ asmachta: 'A123', order_ref: 'c2', sum: '100' })
    const req = new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() })
    const event = await provider.verifyWebhook(req)
    expect(event.status).toBe('paid')
    expect(event.providerPaymentId).toBe('A123')
  })

  it('parses the live Grow "Payment Links" webhook (paymentSum, payerEmail, no order_ref)', async () => {
    // Exact field shape captured from a real Grow server webhook.
    const body = JSON.stringify({
      transactionCode: 'fB7vk2eftq7CuDXgtBmDAQ==',
      asmachta: '503074682',
      paymentSum: '1',
      payerEmail: 'yuvalste13@gmail.com',
      paymentDesc: 'Just A Second שובר מתנה 1',
      paymentSource: 'Payment Links',
    })
    const req = new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    const event = await provider.verifyWebhook(req)
    expect(event.status).toBe('paid')
    expect(event.amountMinor).toBe(100) // ₪1 from paymentSum
    expect(event.orderRef).toBe('') // Grow omits it — matched later by email+amount
    expect(event.customerEmail).toBe('yuvalste13@gmail.com')
    expect(event.providerPaymentId).toBe('fB7vk2eftq7CuDXgtBmDAQ==')
  })

  it('rejects a callback that carries a mismatched secret', async () => {
    const body = JSON.stringify({ transactionCode: 'TX', cField1: 'c', sum: '100', secret: 'WRONG' })
    const req = new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    await expect(provider.verifyWebhook(req)).rejects.toThrow(/token/i)
  })

  it('accepts a callback with no secret (reference-compatible)', async () => {
    const body = JSON.stringify({ transactionCode: 'TX', cField1: 'c', sum: '100' })
    const req = new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    const event = await provider.verifyWebhook(req)
    expect(event.status).toBe('paid')
  })
})
