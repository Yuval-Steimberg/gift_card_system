import { describe, it, expect } from 'vitest'
import { isGiftCardGrowPayment } from '@/lib/payments/grow-scope'
import { GrowPaymentProvider } from '@/lib/payments/grow'

describe('isGiftCardGrowPayment (Grow webhook fires for EVERY sale on the account)', () => {
  it('keeps our gift-card payment links', () => {
    expect(isGiftCardGrowPayment({ paymentDesc: 'Just A Second שובר מתנה 1' })).toBe(true)
    expect(isGiftCardGrowPayment({ paymentDesc: 'Just A Second — שובר מתנה ₪250.00' })).toBe(true)
    expect(isGiftCardGrowPayment({ paymentDesc: 'Just A Second gift card' })).toBe(true)
  })

  it('drops a shop sale that says what it was for', () => {
    expect(isGiftCardGrowPayment({ paymentDesc: 'מכירה בחנות', paymentSum: '14' })).toBe(false)
    expect(isGiftCardGrowPayment({ description: 'הזמנה מהאתר #1234' })).toBe(false)
  })

  it('fails safe: no description, or our order ref, stays a gift-card payment', () => {
    expect(isGiftCardGrowPayment({ paymentSum: '100' })).toBe(true)
    expect(isGiftCardGrowPayment({ paymentDesc: '   ' })).toBe(true)
    expect(isGiftCardGrowPayment({ paymentDesc: 'something else', cField1: 'card-uuid' })).toBe(
      true,
    )
    expect(isGiftCardGrowPayment(null)).toBe(true)
  })

  it('verifyWebhook flags a shop sale as notGiftCard', async () => {
    const provider = new GrowPaymentProvider({
      apiUrl: 'https://x',
      apiKey: 'u',
      apiSecret: 's',
      pageCode: '1',
    })
    const req = (desc: string) =>
      new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transactionCode: 'T1', paymentSum: '22', paymentDesc: desc }),
      })
    expect((await provider.verifyWebhook(req('קפה ומאפה'))).notGiftCard).toBe(true)
    expect((await provider.verifyWebhook(req('Just A Second שובר מתנה 22'))).notGiftCard).toBe(
      false,
    )
  })
})
