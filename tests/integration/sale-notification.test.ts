import { describe, it, expect, beforeEach } from 'vitest'
import { readdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { _resetStore } from '@/lib/data'
import { _resetPaymentProvider, getPaymentProvider } from '@/lib/payments'
import { MockPaymentProvider } from '@/lib/payments/mock'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'
import { createPurchase } from '@/lib/gift-cards/service'
import { toMinor } from '@/lib/money'
import type { PurchaseInput } from '@/lib/validation/purchase'

// serverEnv() caches per test file, so this must be set before the first call.
process.env.SALE_NOTIFY_EMAILS = 'owner@example.com, manager@example.com'

const MAIL_DIR = path.join(process.cwd(), '.mail')

const base: PurchaseInput = {
  amountMinor: toMinor(250), templateId: 'tpl-celebration',
  buyerName: 'דנה כהן', buyerEmail: 'dana@example.com', buyerPhone: '0501234567',
  buyerCompany: '', buyerTaxId: '', wantsInvoice: false, showBuyerName: true, sendAnonymously: false,
  recipientName: 'יעל לוי', recipientEmail: 'yael@example.com', recipientPhone: '0527654321',
  recipientLanguage: 'he', deliveryChannel: 'email', greeting: 'מזל טוב',
  deliveryTiming: 'immediate', scheduledDeliveryAt: null, senderTimezone: 'Asia/Jerusalem', acceptedTerms: true,
}

function mailsTo(addr: string): string[] {
  if (!existsSync(MAIL_DIR)) return []
  return readdirSync(MAIL_DIR)
    .filter((f) => f.endsWith('.html') && f.includes(addr))
    .map((f) => readFileSync(path.join(MAIL_DIR, f), 'utf8'))
}

async function pay(id: string, eventId: string) {
  const p = getPaymentProvider() as MockPaymentProvider
  const { body, signature } = p.buildSignedWebhook({
    eventId, orderRef: id, providerPaymentId: `pay-${eventId}`, status: 'paid',
    amountMinor: toMinor(250), currency: 'ILS',
  })
  await handlePaymentWebhook(new Request('http://internal/api/webhooks/payment', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-mock-signature': signature }, body,
  }))
}

beforeEach(() => {
  _resetStore()
  _resetPaymentProvider()
  rmSync(MAIL_DIR, { recursive: true, force: true })
})

describe('staff "new card sold" email', () => {
  it('goes to every SALE_NOTIFY_EMAILS address with amount, people and delivery status — never the full code', async () => {
    const { giftCardId } = await createPurchase(base)
    await pay(giftCardId!, 'evt-sale-1')

    for (const addr of ['owner@example.com', 'manager@example.com']) {
      const mails = mailsTo(addr)
      expect(mails).toHaveLength(1)
      const html = mails[0]!
      expect(html).toContain('שובר חדש נמכר')
      expect(html).toContain('₪250')
      expect(html).toContain('dana@example.com')
      expect(html).toContain('yael@example.com')
      expect(html).toContain('נשלח לנמען/ת')
      expect(html).toContain(`/admin/gift-cards/${giftCardId}`)
      expect(html).not.toMatch(/JAS-[A-Z0-9]{4}-[A-Z0-9]{4}/)
    }
  })

  it('a replayed payment callback does not notify twice', async () => {
    const { giftCardId } = await createPurchase(base)
    await pay(giftCardId!, 'evt-sale-2')
    await pay(giftCardId!, 'evt-sale-2')
    expect(mailsTo('owner@example.com')).toHaveLength(1)
  })

  it('an unpaid checkout sends nothing', async () => {
    await createPurchase(base)
    expect(mailsTo('owner@example.com')).toHaveLength(0)
  })
})
