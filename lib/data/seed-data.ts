import type { AuditLogEntry, GiftCard, GiftCardTemplate, LedgerEntry, Payment, Redemption, StoreLocation } from '@/lib/gift-cards/types'
import { toMinor } from '@/lib/money'
import type { DeliveryJob, SystemSettings } from './store'

/**
 * Baseline reference data for a fresh store — real configuration only.
 *
 * NO DEMO/SAMPLE GIFT CARDS, PAYMENTS, LEDGER ENTRIES OR REDEMPTIONS ARE SEEDED.
 * Every number the admin dashboard and reports show is therefore derived from
 * real purchases only; a brand-new install starts at zero. Do not add fake cards
 * here — write an integration test that creates the cards it needs instead.
 */
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

/** The single physical store cards are redeemed at. */
export const STORE_ID = 'store-tlv'

const TEMPLATE_CREATED_AT = '2025-01-01T00:00:00.000Z'

/** Card designs offered in the purchase funnel (real store artwork/colors). */
export const GIFT_CARD_TEMPLATES: GiftCardTemplate[] = [
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
    createdAt: TEMPLATE_CREATED_AT,
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
    createdAt: TEMPLATE_CREATED_AT,
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
    createdAt: TEMPLATE_CREATED_AT,
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
    createdAt: TEMPLATE_CREATED_AT,
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
    createdAt: TEMPLATE_CREATED_AT,
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
    createdAt: TEMPLATE_CREATED_AT,
  },
]

/** The real Just A Second store location. */
export const STORE_LOCATIONS: StoreLocation[] = [
  { id: STORE_ID, name: 'Just A Second · תל אביב', address: 'מנחם בגין 34, תל אביב', timezone: 'Asia/Jerusalem', isActive: true },
]

/**
 * Default system settings — used to seed the store and as a safe fallback when
 * the system_settings row is missing (e.g. seed not yet run).
 *
 * These are the REAL business values (contact details, ₪50 minimum, 4-month
 * expiry as the landing page states). Anywhere a contact detail is shown it
 * comes from here — and the UI hides the phone if it is ever blanked out, so a
 * customer never sees a number that does not answer.
 */
export function defaultSystemSettings(): SystemSettings {
  return {
    businessName: 'Just A Second · ג׳אסט א סקונד',
    businessEmail: 'justasecondil2@gmail.com',
    businessPhone: '058-787-6549',
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

/**
 * Initial contents of an empty MemoryStore: configuration, designs and the
 * store location — and zero gift cards, so every metric starts at a true zero.
 */
export function seedMemoryStore(): SeedBundle {
  return {
    settings: defaultSystemSettings(),
    templates: GIFT_CARD_TEMPLATES.map((t) => ({ ...t })),
    locations: STORE_LOCATIONS.map((l) => ({ ...l })),
    cards: [],
    ledger: [],
    redemptions: [],
    payments: [],
    deliveryJobs: [],
    audit: [],
  }
}
