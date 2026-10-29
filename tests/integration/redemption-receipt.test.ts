import { describe, it, expect, beforeEach } from 'vitest'
import { readdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { _resetStore, getStore } from '@/lib/data'
import { _resetPaymentProvider, getPaymentProvider } from '@/lib/payments'
import { MockPaymentProvider } from '@/lib/payments/mock'
import { handlePaymentWebhook } from '@/lib/payments/webhook-handler'
import { createPurchase, redeemGiftCard } from '@/lib/gift-cards/service'
import { toMinor } from '@/lib/money'
import type { PurchaseInput } from '@/lib/validation/purchase'

const MAIL_DIR = path.join(process.cwd(), '.mail')

const base: PurchaseInput = {
  amountMinor: toMinor(30), templateId: 'tpl-celebration',
  buyerName: 'דני אורן', buyerEmail: 'dani@example.com', buyerPhone: '0501234567',
  buyerCompany: '', buyerTaxId: '', wantsInvoice: false, showBuyerName: true, sendAnonymously: false,
  recipientName: 'ליאת אורן', recipientEmail: 'liat@example.com', recipientPhone: '0521234567',
  recipientLanguage: 'he', deliveryChannel: 'email', greeting: 'מזל טוב',
  deliveryTiming: 'immediate', scheduledDeliveryAt: null, senderTimezone: 'Asia/Jerusalem', acceptedTerms: true,
}

/** HTML of every mail the log adapter wrote to the recipient. */
function mailsTo(addr: string): string[] {
  if (!existsSync(MAIL_DIR)) return []
  return readdirSync(MAIL_DIR)
    .filter((f) => f.endsWith('.html') && f.includes(addr))
    .map((f) => readFileSync(path.join(MAIL_DIR, f), 'utf8'))
}

async function activeCard() {
  await getStore().updateSettings({ minAmountMinor: 100 }, { actorId: 'test', actorRole: 'owner' })
  const { giftCardId: id } = await createPurchase(base)
  const p = getPaymentProvider() as MockPaymentProvider
  const { body, signature } = p.buildSignedWebhook({
    eventId: 'evt-1', orderRef: id!, providerPaymentId: 'pay-1', status: 'paid',
    amountMinor: toMinor(30), currency: 'ILS',
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

describe('partial redemption tells the recipient what is left', () => {
  it('₪20 off a ₪30 card leaves ₪10, partially redeemed, and emails the balance', async () => {
    const id = await activeCard()
    const before = mailsTo('liat@example.com').length

    const res = await redeemGiftCard({
      giftCardId: id, amountMinor: toMinor(20), employeeId: 'emp-1', storeLocationId: null,
      idempotencyKey: 'redeem-key-1', saleReference: null, note: null, metadata: {},
    })
    expect(res.code).toBe('ok')
    const card = await getStore().getGiftCardById(id)
    expect(card!.balanceMinor).toBe(toMinor(10))
    expect(card!.status).toBe('partially_redeemed')

    const mails = mailsTo('liat@example.com')
    expect(mails.length).toBe(before + 1)
    const receipt = mails.find((h) => h.includes('מומשו'))!
    expect(receipt).toContain('₪20')
    expect(receipt).toContain('₪10')
  })

  it('a replayed redemption (same key) neither debits nor emails again', async () => {
    const id = await activeCard()
    const input = {
      giftCardId: id, amountMinor: toMinor(20), employeeId: 'emp-1', storeLocationId: null,
      idempotencyKey: 'redeem-key-2', saleReference: null, note: null, metadata: {},
    }
    await redeemGiftCard(input)
    const after = mailsTo('liat@example.com').length
    const replay = await redeemGiftCard(input)
    expect(replay.code).toBe('duplicate')
    expect((await getStore().getGiftCardById(id))!.balanceMinor).toBe(toMinor(10))
    expect(mailsTo('liat@example.com').length).toBe(after)
  })

  it('spending the rest says the card is fully used', async () => {
    const id = await activeCard()
    await redeemGiftCard({
      giftCardId: id, amountMinor: toMinor(30), employeeId: 'emp-1', storeLocationId: null,
      idempotencyKey: 'redeem-key-3', saleReference: null, note: null, metadata: {},
    })
    expect(mailsTo('liat@example.com').some((h) => h.includes('השובר מומש במלואו'))).toBe(true)
  })
})
