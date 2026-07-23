import type { Currency, Minor } from '@/lib/money'

/** Lifecycle status of a gift card. See docs/database.md for the transition map. */
export type GiftCardStatus =
  | 'draft' // created, not yet paid
  | 'awaiting_payment' // checkout session opened
  | 'payment_processing' // webhook arriving / provider settling
  | 'active' // paid + activated, full or partial balance remains
  | 'partially_redeemed' // some balance spent, some remains
  | 'fully_redeemed' // balance == 0
  | 'expired'
  | 'suspended'
  | 'cancelled'
  | 'refunded'
  | 'reissued' // superseded by a new card; old token/code void
  | 'failed' // payment failed

/** Statuses in which a card can be presented/redeemed by an employee. */
export const REDEEMABLE_STATUSES: GiftCardStatus[] = ['active', 'partially_redeemed']

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'partially_refunded'

export type DeliveryStatus =
  | 'pending'
  | 'scheduled'
  | 'processing'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'cancelled'

export type DeliveryChannel = 'email' | 'sms' | 'whatsapp'
export type Language = 'he' | 'en'

/** Signed ledger entry types. Sum of `amount_minor` == cached balance. */
export type LedgerEntryType =
  | 'initial_credit'
  | 'redemption_debit'
  | 'redemption_reversal_credit'
  | 'refund_debit'
  | 'manual_increase'
  | 'manual_decrease'
  | 'expiration_adjustment'
  | 'cancellation_adjustment'
  | 'reissue_transfer'

export interface GiftCardTemplate {
  id: string
  name: string
  occasion: 'birthday' | 'holiday' | 'celebration' | 'general'
  language: Language
  coverImageUrl: string | null
  backgroundColor: string
  textColor: string
  accentColor: string
  isActive: boolean
  isDefault: boolean
  createdAt: string
}

export interface GiftCard {
  id: string
  code: string // human-readable, checksum-protected
  publicToken: string // long random token for links/QR (revocable)
  status: GiftCardStatus
  currency: Currency
  initialAmountMinor: Minor
  balanceMinor: Minor // cached; equals SUM(ledger.amount_minor)
  templateId: string

  buyerName: string | null // null when anonymous on the card
  buyerEmail: string
  buyerPhone: string | null
  buyerCompany: string | null
  buyerTaxId: string | null
  wantsInvoice: boolean
  isAnonymous: boolean

  recipientName: string
  recipientEmail: string
  recipientPhone: string | null
  recipientLanguage: Language
  deliveryChannel: DeliveryChannel

  greeting: string // safe plain text (line breaks preserved)

  scheduledDeliveryAt: string | null // UTC ISO; null = immediate
  senderTimezone: string

  paymentId: string | null
  issuedAt: string | null // set on activation
  expiresAt: string | null // UTC ISO; null = no expiry
  supersededByCardId: string | null // set when reissued

  createdAt: string
  updatedAt: string
}

export interface LedgerEntry {
  id: string
  giftCardId: string
  type: LedgerEntryType
  amountMinor: Minor // signed: credits positive, debits negative
  currency: Currency
  balanceAfterMinor: Minor
  referenceType: string | null
  referenceId: string | null
  reason: string | null
  createdBy: string | null
  approvedBy: string | null
  idempotencyKey: string | null
  createdAt: string
  metadata: Record<string, unknown>
}

export interface Redemption {
  id: string
  giftCardId: string
  amountMinor: Minor // positive amount redeemed
  balanceBeforeMinor: Minor
  balanceAfterMinor: Minor
  employeeId: string
  storeLocationId: string | null
  idempotencyKey: string
  saleReference: string | null
  receiptNumber: string | null
  note: string | null
  reversedByReversalId: string | null
  createdAt: string
  metadata: Record<string, unknown>
}

export interface RedemptionReversal {
  id: string
  redemptionId: string
  giftCardId: string
  amountMinor: Minor // positive amount credited back
  reason: string
  requestedBy: string
  approvedBy: string
  createdAt: string
}

export interface Payment {
  id: string
  giftCardId: string
  provider: string
  providerPaymentId: string | null
  providerCheckoutId: string | null
  amountMinor: Minor
  currency: Currency
  status: PaymentStatus
  createdAt: string
  updatedAt: string
}

export interface AuditLogEntry {
  id: string
  actorId: string | null
  actorRole: string | null
  action: string
  entityType: string
  entityId: string
  reason: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface StoreLocation {
  id: string
  name: string
  address: string
  timezone: string
  isActive: boolean
}
