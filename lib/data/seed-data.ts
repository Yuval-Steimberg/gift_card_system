import { randomUUID } from 'node:crypto'
import type {
  AuditLogEntry,
  GiftCard,
  GiftCardTemplate,
  LedgerEntry,
  Payment,
  Redemption,
  StoreLocation,
} from '@/lib/gift-cards/types'
import { toMinor } from '@/lib/money'
import type { DeliveryJob, SystemSettings } from './store'

export interface SeedBundle {
  settings: SystemSettings
  templates: GiftCardTemplate[]
  locations: StoreLocation[]
  cards: GiftCard[]
  ledger: LedgerEntry[]
  redemptions: Redemption[]
  payments: Payment[]
  deliveryJobs: DeliveryJob[]
  audit: AuditLogEntry[]
}

const iso = (daysFromNow: number): string => new Date(Date.now() + daysFromNow * 86400000).toISOString()

/** Deterministic demo user ids referenced by seed data + demo auth. */
export const DEMO_USERS = {
  owner: 'user-owner',
  admin: 'user-admin',
  manager: 'user-manager',
  employee1: 'user-employee-1',
  employee2: 'user-employee-2',
  finance: 'user-finance',
} as const

const STORE_ID = 'store-tlv'

export const DEMO_TEMPLATES: GiftCardTemplate[] = [
  {
    id: 'tpl-celebration',
    name: 'חגיגה',
    occasion: 'celebration',
    language: 'he',
    coverImageUrl: null,
    backgroundColor: '#333D36', // forest
    textColor: '#FFFCF5', // cream
    accentColor: '#E88225', // orange
    isActive: true,
    isDefault: true,
    createdAt: iso(-120),
  },
  {
    id: 'tpl-birthday',
    name: 'יום הולדת',
    occasion: 'birthday',
    language: 'he',
    coverImageUrl: null,
    backgroundColor: '#B5C9AD', // sage
    textColor: '#333D36', // forest
    accentColor: '#C96A17', // pressed orange
    isActive: true,
    isDefault: false,
    createdAt: iso(-120),
  },
  {
    id: 'tpl-holiday',
    name: 'חג שמח',
    occasion: 'holiday',
    language: 'he',
    coverImageUrl: null,
    backgroundColor: '#8FA688', // sage-3 (deeper green)
    textColor: '#FFFCF5', // cream
    accentColor: '#F4A866', // soft orange
    isActive: true,
    isDefault: false,
    createdAt: iso(-120),
  },
  {
    id: 'tpl-thankyou',
    name: 'תודה',
    occasion: 'general',
    language: 'he',
    coverImageUrl: null,
    backgroundColor: '#F6F1E4', // warm paper
    textColor: '#333D36', // forest
    accentColor: '#E88225', // orange
    isActive: true,
    isDefault: false,
    createdAt: iso(-120),
  },
  {
    id: 'tpl-love',
    name: 'מכל הלב',
    occasion: 'celebration',
    language: 'he',
    coverImageUrl: null,
    backgroundColor: '#4A524D', // deep slate
    textColor: '#FFFCF5', // cream
    accentColor: '#F4A866', // soft orange
    isActive: true,
    isDefault: false,
    createdAt: iso(-120),
  },
  {
    id: 'tpl-general-en',
    name: 'With Love',
    occasion: 'general',
    language: 'en',
    coverImageUrl: null,
    backgroundColor: '#FFFCF5', // cream
    textColor: '#333D36', // forest
    accentColor: '#E88225', // orange
    isActive: true,
    isDefault: false,
    createdAt: iso(-120),
  },
]

/** Default system settings — used to seed the store and as a safe fallback
 *  when the system_settings row is missing (e.g. seed not yet run). */
export function defaultSystemSettings(): SystemSettings {
  return {
    businessName: 'Just A Second · ג׳אסט א סקונד',
    businessEmail: 'hello@justasecond.example',
    businessPhone: '03-5555555',
    storeAddress: 'מנחם בגין 34, תל אביב',
    currency: 'ILS',
    timezone: 'Asia/Jerusalem',
    presetAmountsMinor: [toMinor(100), toMinor(250), toMinor(500), toMinor(1000)],
    minAmountMinor: toMinor(50),
    maxAmountMinor: toMinor(5000),
    allowCustomAmount: true,
    expiryMonths: 12,
    allowPartialRedemption: true,
    greetingMaxLength: 500,
    termsUrl: '/terms',
    defaultLanguage: 'he',
  }
}

interface Ctx {
  ledger: LedgerEntry[]
  redemptions: Redemption[]
  payments: Payment[]
  deliveryJobs: DeliveryJob[]
  audit: AuditLogEntry[]
}

function ledgerEntry(card: GiftCard, type: LedgerEntry['type'], signedMinor: number, balanceAfter: number, extra: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: randomUUID(),
    giftCardId: card.id,
    type,
    amountMinor: signedMinor,
    currency: card.currency,
    balanceAfterMinor: balanceAfter,
    referenceType: extra.referenceType ?? null,
    referenceId: extra.referenceId ?? null,
    reason: extra.reason ?? null,
    createdBy: extra.createdBy ?? null,
    approvedBy: extra.approvedBy ?? null,
    idempotencyKey: extra.idempotencyKey ?? null,
    createdAt: extra.createdAt ?? card.issuedAt ?? card.createdAt,
    metadata: extra.metadata ?? {},
  }
}

function baseCard(overrides: Partial<GiftCard> & Pick<GiftCard, 'id' | 'code' | 'publicToken' | 'initialAmountMinor'>): GiftCard {
  const now = iso(-10)
  return {
    status: 'active',
    currency: 'ILS',
    balanceMinor: overrides.initialAmountMinor,
    templateId: 'tpl-celebration',
    buyerName: 'דנה כהן',
    buyerEmail: 'dana.buyer@example.com',
    buyerPhone: '0501234567',
    buyerCompany: null,
    buyerTaxId: null,
    wantsInvoice: false,
    isAnonymous: false,
    recipientName: 'יעל לוי',
    recipientEmail: 'yael.recipient@example.com',
    recipientPhone: '0527654321',
    recipientLanguage: 'he',
    deliveryChannel: 'email',
    greeting: 'מזל טוב יעל!\nמגיע לך משהו יפה מהחנות.\nבאהבה, דנה',
    scheduledDeliveryAt: null,
    senderTimezone: 'Asia/Jerusalem',
    paymentId: null,
    issuedAt: now,
    expiresAt: iso(355),
    supersededByCardId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function seedMemoryStore(): SeedBundle {
  const ctx: Ctx = { ledger: [], redemptions: [], payments: [], deliveryJobs: [], audit: [] }
  const cards: GiftCard[] = []

  const addActivation = (card: GiftCard) => {
    const payId = randomUUID()
    card.paymentId = payId
    ctx.payments.push({
      id: payId,
      giftCardId: card.id,
      provider: 'mock',
      providerPaymentId: `mock_pay_${card.code}`,
      providerCheckoutId: `mock_cs_${card.code}`,
      amountMinor: card.initialAmountMinor,
      currency: card.currency,
      status: 'paid',
      createdAt: card.createdAt,
      updatedAt: card.issuedAt ?? card.createdAt,
    })
    ctx.ledger.push(
      ledgerEntry(card, 'initial_credit', card.initialAmountMinor, card.initialAmountMinor, {
        referenceType: 'payment',
        referenceId: payId,
        reason: 'initial gift card credit',
      }),
    )
    ctx.deliveryJobs.push({
      id: randomUUID(),
      giftCardId: card.id,
      channel: 'email',
      status: 'delivered',
      scheduledFor: null,
      attempts: 1,
      lastError: null,
      providerMessageId: `log_${card.code}`,
      createdAt: card.createdAt,
      updatedAt: card.issuedAt ?? card.createdAt,
    })
    ctx.audit.push({
      id: randomUUID(),
      actorId: null,
      actorRole: 'system',
      action: 'giftcard.activated',
      entityType: 'gift_card',
      entityId: card.id,
      reason: 'verified payment',
      metadata: {},
      createdAt: card.issuedAt ?? card.createdAt,
    })
  }

  const addRedemption = (card: GiftCard, amountMinor: number, employeeId: string, before: number) => {
    const after = before - amountMinor
    const redemption: Redemption = {
      id: randomUUID(),
      giftCardId: card.id,
      amountMinor,
      balanceBeforeMinor: before,
      balanceAfterMinor: after,
      employeeId,
      storeLocationId: STORE_ID,
      idempotencyKey: `seed-${card.code}-${ctx.redemptions.length}`,
      saleReference: `SALE-${1000 + ctx.redemptions.length}`,
      receiptNumber: null,
      note: null,
      reversedByReversalId: null,
      createdAt: iso(-3),
      metadata: {},
    }
    ctx.redemptions.push(redemption)
    ctx.ledger.push(
      ledgerEntry(card, 'redemption_debit', -amountMinor, after, {
        referenceType: 'redemption',
        referenceId: redemption.id,
        createdBy: employeeId,
        reason: 'in-store redemption',
        createdAt: redemption.createdAt,
      }),
    )
    return after
  }

  // 1) Active, full balance
  const active = baseCard({ id: 'card-active', code: 'JAS-7F3K-QP2M-9', publicToken: 'demo-token-active-2f8a9c1e5b7d3a4f6e0c', initialAmountMinor: toMinor(300), status: 'active' })
  addActivation(active)
  cards.push(active)

  // 2) Partially redeemed (₪500 -> 180 -> 320 remaining)
  const partial = baseCard({
    id: 'card-partial',
    code: 'JAS-3M9T-XK4P-2',
    publicToken: 'demo-token-partial-6b1d8e2f4a9c3e7b5d0f',
    initialAmountMinor: toMinor(500),
    status: 'partially_redeemed',
    recipientName: 'נועם ברק',
    templateId: 'tpl-birthday',
  })
  addActivation(partial)
  let bal = addRedemption(partial, toMinor(180), DEMO_USERS.employee1, toMinor(500))
  partial.balanceMinor = bal
  cards.push(partial)

  // 3) Fully redeemed (₪100 -> 100)
  const full = baseCard({
    id: 'card-full',
    code: 'JAS-8P2W-RT6N-5',
    publicToken: 'demo-token-full-1a2b3c4d5e6f7a8b9c0d',
    initialAmountMinor: toMinor(100),
    status: 'fully_redeemed',
    templateId: 'tpl-holiday',
  })
  addActivation(full)
  bal = addRedemption(full, toMinor(100), DEMO_USERS.employee2, toMinor(100))
  full.balanceMinor = bal
  cards.push(full)

  // 4) Expired (unused)
  const expired = baseCard({
    id: 'card-expired',
    code: 'JAS-QW1E-AS2D-7',
    publicToken: 'demo-token-expired-9f8e7d6c5b4a3f2e1d0c',
    initialAmountMinor: toMinor(200),
    status: 'expired',
    expiresAt: iso(-5),
    issuedAt: iso(-400),
    createdAt: iso(-400),
  })
  addActivation(expired)
  cards.push(expired)

  // 5) Suspended
  const suspended = baseCard({
    id: 'card-suspended',
    code: 'JAS-ZX3C-VB4N-8',
    publicToken: 'demo-token-suspended-3c2b1a0f9e8d7c6b5a4f',
    initialAmountMinor: toMinor(250),
    status: 'suspended',
  })
  addActivation(suspended)
  cards.push(suspended)

  // 6) Failed delivery (still active, awaiting resend)
  const failedDelivery = baseCard({
    id: 'card-faildelivery',
    code: 'JAS-KJ5H-GF6D-1',
    publicToken: 'demo-token-faildelivery-7a6b5c4d3e2f1a0b9c8d',
    initialAmountMinor: toMinor(150),
    status: 'active',
    recipientEmail: 'bounce@invalid.invalid',
  })
  addActivation(failedDelivery)
  // overwrite delivery job to failed
  const dj = ctx.deliveryJobs.find((j) => j.giftCardId === failedDelivery.id)
  if (dj) {
    dj.status = 'failed'
    dj.attempts = 3
    dj.lastError = 'recipient address rejected'
    dj.providerMessageId = null
  }
  cards.push(failedDelivery)

  // 7) Scheduled for future delivery, awaiting payment (draft-ish demo of pipeline)
  const scheduled = baseCard({
    id: 'card-scheduled',
    code: 'JAS-LP7O-IU8Y-3',
    publicToken: 'demo-token-scheduled-2d3c4b5a6f7e8d9c0b1a',
    initialAmountMinor: toMinor(400),
    status: 'active',
    scheduledDeliveryAt: iso(2),
  })
  addActivation(scheduled)
  const sdj = ctx.deliveryJobs.find((j) => j.giftCardId === scheduled.id)
  if (sdj) {
    sdj.status = 'scheduled'
    sdj.scheduledFor = iso(2)
  }
  cards.push(scheduled)

  const locations: StoreLocation[] = [
    { id: STORE_ID, name: 'Just A Second · תל אביב', address: 'מנחם בגין 34, תל אביב', timezone: 'Asia/Jerusalem', isActive: true },
  ]

  return {
    settings: defaultSystemSettings(),
    templates: DEMO_TEMPLATES.map((t) => ({ ...t })),
    locations,
    cards,
    ledger: ctx.ledger,
    redemptions: ctx.redemptions,
    payments: ctx.payments,
    deliveryJobs: ctx.deliveryJobs,
    audit: ctx.audit,
  }
}
