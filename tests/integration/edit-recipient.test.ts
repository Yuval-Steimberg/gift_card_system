import { describe, it, expect, beforeEach } from 'vitest'
import { readdirSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { _resetStore, getStore } from '@/lib/data'
import { _resetPaymentProvider, getPaymentProvider } from '@/lib/payments'
import { MockPaymentProvider } from '@/lib/payments/mock'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'
import { createPurchase, resendGiftCard } from '@/lib/gift-cards/service'
import { toMinor } from '@/lib/money'
import type { PurchaseInput } from '@/lib/validation/purchase'

const MAIL_DIR = path.join(process.cwd(), '.mail')

const base: PurchaseInput = {
  amountMinor: toMinor(450), templateId: 'tpl-celebration',
  buyerName: 'חבי כהן', buyerEmail: 'havi@1to1landscape.com', buyerPhone: '0501234567',
  buyerCompany: '', buyerTaxId: '', wantsInvoice: false, showBuyerName: true, sendAnonymously: false,
  recipientName: 'יואב לוי', recipientEmail: 'yoav@1to1landscape.com', recipientPhone: '0521234567',
  recipientLanguage: 'he', deliveryChannel: 'email', greeting: 'מזל טוב',
  deliveryTiming: 'immediate', scheduledDeliveryAt: null, senderTimezone: 'Asia/Jerusalem', acceptedTerms: true,
}

/** The log email adapter names each preview file after the address it sent to,
 *  so the filesystem is the honest record of where the card actually went. */
function mailSentTo(): string[] {
  if (!existsSync(MAIL_DIR)) return []
  return readdirSync(MAIL_DIR).filter((f) => f.endsWith('.html'))
}

async function activeCard() {
  const { giftCardId: id } = await createPurchase(base)
  const p = getPaymentProvider() as MockPaymentProvider
  const { body, signature } = p.buildSignedWebhook({
    eventId: 'evt-1', orderRef: id!, providerPaymentId: 'pay-1', status: 'paid',
    amountMinor: toMinor(450), currency: 'ILS',
  })
  await handlePaymentWebhook(new Request('http://internal/api/webhooks/payment', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-mock-signature': signature }, body,
  }))
  return id!
}

beforeEach(() => {
  _resetStore()
  _resetPaymentProvider()
  rmSync(MAIL_DIR, { recursive: true, force: true })
})

describe('changing a recipient address and resending', () => {
  it('delivers the card to the NEW address, not the one that failed', async () => {
    const id = await activeCard()
    expect(mailSentTo().some((f) => f.includes('yoav@1to1landscape.com'))).toBe(true)

    await getStore().updateGiftCardFields(
      id,
      { recipientEmail: 'yoav.levi@gmail.com' },
      { actorId: 'admin-1', actorRole: 'owner', reason: 'התחום החוסם את הדואר שלנו' },
    )
    rmSync(MAIL_DIR, { recursive: true, force: true })

    const res = await resendGiftCard(id)

    expect(res.ok).toBe(true)
    const sent = mailSentTo()
    expect(sent.some((f) => f.includes('yoav.levi@gmail.com'))).toBe(true)
    expect(sent.some((f) => f.includes('yoav@1to1landscape.com'))).toBe(false)
  })

  it('records the change in the audit log with the reason', async () => {
    const id = await activeCard()
    await getStore().updateGiftCardFields(
      id,
      { recipientEmail: 'yoav.levi@gmail.com' },
      { actorId: 'admin-1', actorRole: 'owner', reason: 'כתובת חסומה' },
    )

    const audit = await getStore().getAudit('gift_card', id)
    const entry = audit.find((a) => a.action === 'giftcard.update_fields')
    expect(entry?.reason).toBe('כתובת חסומה')
  })

  it('resends even though the previous job already reported delivered', async () => {
    // The old job is 'delivered' and createDeliveryJob only reuses open jobs,
    // so a resend must mint a new one rather than silently no-op.
    const id = await activeCard()
    const before = await getStore().getDeliveryJobs(id)
    expect(before).toHaveLength(1)

    await resendGiftCard(id)

    const after = await getStore().getDeliveryJobs(id)
    expect(after.length).toBeGreaterThan(before.length)
    expect(after.every((j) => j.status === 'delivered')).toBe(true)
  })
})
