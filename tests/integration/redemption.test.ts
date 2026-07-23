import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStore } from '@/lib/data/memory-store'
import type { GiftCardStore } from '@/lib/data/store'
import { toMinor } from '@/lib/money'
import { generateGiftCardCode, generatePublicToken } from '@/lib/gift-cards/codes'

let store: GiftCardStore

async function makeCard(amountMinor: number, opts: { expiresAt?: string | null } = {}) {
  const card = await store.createGiftCard({
    code: generateGiftCardCode(),
    publicToken: generatePublicToken(),
    currency: 'ILS',
    initialAmountMinor: amountMinor,
    templateId: 'tpl-celebration',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    buyerPhone: null,
    buyerCompany: null,
    buyerTaxId: null,
    wantsInvoice: false,
    isAnonymous: false,
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    recipientPhone: null,
    recipientLanguage: 'he',
    deliveryChannel: 'email',
    greeting: '',
    scheduledDeliveryAt: null,
    senderTimezone: 'Asia/Jerusalem',
    expiresAt: opts.expiresAt ?? null,
  })
  await store.attachPayment(card.id, {
    giftCardId: card.id,
    provider: 'mock',
    providerPaymentId: null,
    providerCheckoutId: null,
    amountMinor,
    currency: 'ILS',
    status: 'pending',
  })
  return card
}

async function activate(cardId: string, amountMinor: number, eventId = `evt-${cardId}`) {
  return store.activateFromPayment({
    eventId,
    orderRef: cardId,
    providerPaymentId: `pay-${cardId}`,
    provider: 'mock',
    amountMinor,
    currency: 'ILS',
    rawEvent: {},
  })
}

beforeEach(() => {
  store = new MemoryStore()
})

describe('payment activation (idempotent)', () => {
  it('activates exactly one card with exactly one initial credit', async () => {
    const card = await makeCard(toMinor(300))
    const r = await activate(card.id, toMinor(300))
    expect(r.code).toBe('activated')
    const fresh = await store.getGiftCardById(card.id)
    expect(fresh?.status).toBe('active')
    expect(fresh?.balanceMinor).toBe(toMinor(300))
    const ledger = await store.getLedger(card.id)
    expect(ledger.filter((e) => e.type === 'initial_credit')).toHaveLength(1)
  })

  it('is idempotent on repeated webhook (same event id)', async () => {
    const card = await makeCard(toMinor(300))
    await activate(card.id, toMinor(300))
    const again = await activate(card.id, toMinor(300))
    expect(again.code).toBe('already_processed')
    const ledger = await store.getLedger(card.id)
    expect(ledger.filter((e) => e.type === 'initial_credit')).toHaveLength(1)
    const fresh = await store.getGiftCardById(card.id)
    expect(fresh?.balanceMinor).toBe(toMinor(300))
  })

  it('does not add a second credit for a different event on an already-active card', async () => {
    const card = await makeCard(toMinor(300))
    await activate(card.id, toMinor(300), 'evt-a')
    const other = await activate(card.id, toMinor(300), 'evt-b')
    expect(other.code).toBe('already_processed')
    const ledger = await store.getLedger(card.id)
    expect(ledger.filter((e) => e.type === 'initial_credit')).toHaveLength(1)
  })

  it('rejects an amount mismatch and does not activate', async () => {
    const card = await makeCard(toMinor(300))
    const r = await activate(card.id, toMinor(250))
    expect(r.code).toBe('amount_mismatch')
    const fresh = await store.getGiftCardById(card.id)
    expect(fresh?.status).toBe('draft')
    expect(fresh?.balanceMinor).toBe(0)
  })
})

describe('redemption', () => {
  it('supports partial then final redemption (500 -> 180 -> 320 -> 200 -> 120)', async () => {
    const card = await makeCard(toMinor(500))
    await activate(card.id, toMinor(500))

    const r1 = await store.redeem({ giftCardId: card.id, amountMinor: toMinor(180), employeeId: 'emp1', idempotencyKey: 'k1' })
    expect(r1.code).toBe('ok')
    expect(r1.balanceAfterMinor).toBe(toMinor(320))
    expect(r1.status).toBe('partially_redeemed')

    const r2 = await store.redeem({ giftCardId: card.id, amountMinor: toMinor(200), employeeId: 'emp1', idempotencyKey: 'k2' })
    expect(r2.code).toBe('ok')
    expect(r2.balanceAfterMinor).toBe(toMinor(120))
    expect(r2.status).toBe('partially_redeemed')

    const ledger = await store.getLedger(card.id)
    const balance = ledger.reduce((s, e) => s + e.amountMinor, 0)
    expect(balance).toBe(toMinor(120))
  })

  it('marks fully_redeemed at zero balance', async () => {
    const card = await makeCard(toMinor(100))
    await activate(card.id, toMinor(100))
    const r = await store.redeem({ giftCardId: card.id, amountMinor: toMinor(100), employeeId: 'e', idempotencyKey: 'z' })
    expect(r.status).toBe('fully_redeemed')
    expect(r.balanceAfterMinor).toBe(0)
  })

  it('rejects overspend, zero, and negative amounts', async () => {
    const card = await makeCard(toMinor(100))
    await activate(card.id, toMinor(100))
    expect((await store.redeem({ giftCardId: card.id, amountMinor: toMinor(150), employeeId: 'e', idempotencyKey: 'a' })).code).toBe('insufficient_balance')
    expect((await store.redeem({ giftCardId: card.id, amountMinor: 0, employeeId: 'e', idempotencyKey: 'b' })).code).toBe('invalid_amount')
    expect((await store.redeem({ giftCardId: card.id, amountMinor: -100, employeeId: 'e', idempotencyKey: 'c' })).code).toBe('invalid_amount')
  })

  it('is idempotent on a duplicate idempotency key (no double charge)', async () => {
    const card = await makeCard(toMinor(200))
    await activate(card.id, toMinor(200))
    const first = await store.redeem({ giftCardId: card.id, amountMinor: toMinor(50), employeeId: 'e', idempotencyKey: 'dup' })
    const second = await store.redeem({ giftCardId: card.id, amountMinor: toMinor(50), employeeId: 'e', idempotencyKey: 'dup' })
    expect(first.code).toBe('ok')
    expect(second.code).toBe('duplicate')
    const fresh = await store.getGiftCardById(card.id)
    expect(fresh?.balanceMinor).toBe(toMinor(150)) // charged once
    expect((await store.getRedemptions(card.id)).length).toBe(1)
  })

  it('prevents overspend under concurrent redemptions', async () => {
    const card = await makeCard(toMinor(150))
    await activate(card.id, toMinor(150))
    const [a, b] = await Promise.all([
      store.redeem({ giftCardId: card.id, amountMinor: toMinor(100), employeeId: 'e1', idempotencyKey: 'c1' }),
      store.redeem({ giftCardId: card.id, amountMinor: toMinor(100), employeeId: 'e2', idempotencyKey: 'c2' }),
    ])
    const codes = [a.code, b.code].sort()
    expect(codes).toEqual(['insufficient_balance', 'ok'])
    const fresh = await store.getGiftCardById(card.id)
    expect(fresh?.balanceMinor).toBe(toMinor(50))
    // exactly one debit
    const debits = (await store.getLedger(card.id)).filter((e) => e.type === 'redemption_debit')
    expect(debits).toHaveLength(1)
  })

  it('rejects expired and suspended cards', async () => {
    const expired = await makeCard(toMinor(100), { expiresAt: new Date(Date.now() - 1000).toISOString() })
    await activate(expired.id, toMinor(100))
    expect((await store.redeem({ giftCardId: expired.id, amountMinor: toMinor(10), employeeId: 'e', idempotencyKey: 'e1' })).code).toBe('expired')

    const card = await makeCard(toMinor(100))
    await activate(card.id, toMinor(100))
    await store.transitionStatus(card.id, 'suspended', { actorId: 'admin', actorRole: 'admin', reason: 'test' })
    expect((await store.redeem({ giftCardId: card.id, amountMinor: toMinor(10), employeeId: 'e', idempotencyKey: 's1' })).code).toBe('not_redeemable')
  })
})

describe('reversal, adjustment, reissue', () => {
  it('reverses a redemption and restores balance', async () => {
    const card = await makeCard(toMinor(200))
    await activate(card.id, toMinor(200))
    const red = await store.redeem({ giftCardId: card.id, amountMinor: toMinor(80), employeeId: 'e', idempotencyKey: 'r' })
    const rev = await store.reverseRedemption({ redemptionId: red.redemption!.id, reason: 'manager fix', requestedBy: 'e', approvedBy: 'mgr' })
    expect(rev.ok).toBe(true)
    const fresh = await store.getGiftCardById(card.id)
    expect(fresh?.balanceMinor).toBe(toMinor(200))
    // double reversal blocked
    const again = await store.reverseRedemption({ redemptionId: red.redemption!.id, reason: 'x', requestedBy: 'e', approvedBy: 'mgr' })
    expect(again.ok).toBe(false)
  })

  it('applies manual balance adjustments', async () => {
    const card = await makeCard(toMinor(100))
    await activate(card.id, toMinor(100))
    const inc = await store.applyLedgerAdjustment({ giftCardId: card.id, type: 'manual_increase', magnitudeMinor: toMinor(50), reason: 'goodwill', createdBy: 'admin' })
    expect(inc.ok).toBe(true)
    expect(inc.balanceAfterMinor).toBe(toMinor(150))
    const dec = await store.applyLedgerAdjustment({ giftCardId: card.id, type: 'manual_decrease', magnitudeMinor: toMinor(200), reason: 'too much', createdBy: 'admin' })
    expect(dec.ok).toBe(false) // would go negative
  })

  it('reissues: old card voided, new carries remaining balance', async () => {
    const card = await makeCard(toMinor(300))
    await activate(card.id, toMinor(300))
    await store.redeem({ giftCardId: card.id, amountMinor: toMinor(100), employeeId: 'e', idempotencyKey: 'x' })
    const res = await store.reissue(card.id, generateGiftCardCode(), generatePublicToken(), { actorId: 'admin', actorRole: 'admin', reason: 'lost' })
    expect(res.ok).toBe(true)
    const old = await store.getGiftCardById(card.id)
    expect(old?.status).toBe('reissued')
    expect(old?.balanceMinor).toBe(0)
    expect(old?.supersededByCardId).toBe(res.newCard!.id)
    expect(res.newCard!.balanceMinor).toBe(toMinor(200))
    // old token can no longer be redeemed
    expect((await store.redeem({ giftCardId: card.id, amountMinor: toMinor(10), employeeId: 'e', idempotencyKey: 'y' })).code).toBe('not_redeemable')
  })
})
