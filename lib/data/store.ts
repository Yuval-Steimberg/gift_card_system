import type {
  AuditLogEntry,
  DeliveryStatus,
  GiftCard,
  GiftCardStatus,
  GiftCardTemplate,
  LedgerEntry,
  LedgerEntryType,
  Payment,
  PaymentStatus,
  Redemption,
  RedemptionReversal,
  StoreLocation,
} from '@/lib/gift-cards/types'
import type { Currency, Minor } from '@/lib/money'

/** Result codes returned by the atomic redemption operation. */
export type RedeemOutcomeCode =
  | 'ok'
  | 'not_found'
  | 'not_redeemable'
  | 'expired'
  | 'insufficient_balance'
  | 'invalid_amount'
  | 'duplicate' // idempotency key already processed (returns prior result)

export interface RedeemInput {
  giftCardId: string
  amountMinor: Minor
  employeeId: string
  storeLocationId?: string | null
  idempotencyKey: string
  saleReference?: string | null
  receiptNumber?: string | null
  note?: string | null
  metadata?: Record<string, unknown>
}

export interface RedeemResult {
  code: RedeemOutcomeCode
  redemption?: Redemption
  balanceAfterMinor?: Minor
  status?: GiftCardStatus
  message?: string
}

export interface ActivateFromPaymentInput {
  eventId: string // provider event id (idempotency)
  orderRef: string // gift card id
  providerPaymentId: string
  provider: string
  amountMinor: Minor
  currency: Currency
  rawEvent: Record<string, unknown>
}

export interface ActivateResult {
  code: 'activated' | 'already_processed' | 'amount_mismatch' | 'not_found' | 'not_activatable'
  giftCard?: GiftCard
  message?: string
}

export interface CreateGiftCardInput {
  code: string
  publicToken: string
  currency: Currency
  initialAmountMinor: Minor
  templateId: string
  buyerName: string | null
  buyerEmail: string
  buyerPhone: string | null
  buyerCompany: string | null
  buyerTaxId: string | null
  wantsInvoice: boolean
  isAnonymous: boolean
  recipientName: string
  recipientEmail: string
  recipientPhone: string | null
  recipientLanguage: 'he' | 'en'
  deliveryChannel: 'email' | 'sms' | 'whatsapp'
  greeting: string
  scheduledDeliveryAt: string | null
  senderTimezone: string
  expiresAt: string | null
}

export interface LedgerAdjustmentInput {
  giftCardId: string
  type: LedgerEntryType
  magnitudeMinor: Minor
  reason: string
  createdBy: string
  approvedBy?: string | null
  referenceType?: string | null
  referenceId?: string | null
  idempotencyKey?: string | null
  metadata?: Record<string, unknown>
}

export interface ReversalInput {
  redemptionId: string
  reason: string
  requestedBy: string
  approvedBy: string
}

export interface DeliveryJob {
  id: string
  giftCardId: string
  channel: 'email' | 'sms' | 'whatsapp'
  status: DeliveryStatus
  scheduledFor: string | null
  attempts: number
  lastError: string | null
  providerMessageId: string | null
  createdAt: string
  updatedAt: string
}

export interface GiftCardFilter {
  query?: string
  status?: GiftCardStatus
  paymentStatus?: PaymentStatus
  templateId?: string
  limit?: number
  offset?: number
}

export interface SystemSettings {
  businessName: string
  businessEmail: string
  businessPhone: string
  storeAddress: string
  currency: Currency
  timezone: string
  presetAmountsMinor: Minor[]
  minAmountMinor: Minor
  maxAmountMinor: Minor
  allowCustomAmount: boolean
  expiryMonths: number | null
  allowPartialRedemption: boolean
  greetingMaxLength: number
  termsUrl: string
  defaultLanguage: 'he' | 'en'
}

/**
 * The persistence contract. Two implementations exist:
 *  - MemoryStore (default; seeded; mutex-serialized atomic ops) for offline dev/tests
 *  - SupabaseStore (when configured; atomic redemption via the redeem_gift_card RPC)
 *
 * Balance-mutating operations (`redeem`, `activateFromPayment`, ledger
 * adjustments, reversal) MUST be atomic and idempotent.
 */
export interface GiftCardStore {
  // gift cards
  createGiftCard(input: CreateGiftCardInput): Promise<GiftCard>
  getGiftCardById(id: string): Promise<GiftCard | null>
  getGiftCardByToken(token: string): Promise<GiftCard | null>
  getGiftCardByCode(code: string): Promise<GiftCard | null>
  listGiftCards(filter: GiftCardFilter): Promise<{ items: GiftCard[]; total: number }>
  updateGiftCardFields(
    id: string,
    fields: Partial<
      Pick<
        GiftCard,
        'recipientName' | 'recipientEmail' | 'recipientPhone' | 'scheduledDeliveryAt' | 'expiresAt'
      >
    >,
    audit: { actorId: string; actorRole: string; reason: string },
  ): Promise<GiftCard>

  // payment
  attachPayment(giftCardId: string, payment: Omit<Payment, 'id' | 'createdAt' | 'updatedAt'>): Promise<Payment>
  getPaymentByGiftCard(giftCardId: string): Promise<Payment | null>
  setCheckoutOpened(giftCardId: string, providerCheckoutId: string): Promise<void>
  activateFromPayment(input: ActivateFromPaymentInput): Promise<ActivateResult>

  // ledger + redemption (atomic)
  redeem(input: RedeemInput): Promise<RedeemResult>
  reverseRedemption(input: ReversalInput): Promise<{ ok: boolean; reversal?: RedemptionReversal; message?: string }>
  applyLedgerAdjustment(input: LedgerAdjustmentInput): Promise<{ ok: boolean; balanceAfterMinor?: Minor; message?: string }>
  getLedger(giftCardId: string): Promise<LedgerEntry[]>
  getRedemptions(giftCardId: string): Promise<Redemption[]>

  // lifecycle actions
  transitionStatus(
    giftCardId: string,
    to: GiftCardStatus,
    audit: { actorId: string; actorRole: string; reason: string },
  ): Promise<{ ok: boolean; message?: string }>
  reissue(
    giftCardId: string,
    newCode: string,
    newToken: string,
    audit: { actorId: string; actorRole: string; reason: string },
  ): Promise<{ ok: boolean; newCard?: GiftCard; message?: string }>

  // delivery
  createDeliveryJob(giftCardId: string, channel: 'email' | 'sms' | 'whatsapp', scheduledFor: string | null): Promise<DeliveryJob>
  getDeliveryJobs(giftCardId: string): Promise<DeliveryJob[]>
  /** Count of distinct gift cards that have at least one failed delivery job
   *  (one aggregate query — avoids an N+1 over every card on the dashboard). */
  countCardsWithFailedDelivery(): Promise<number>
  claimDueDeliveryJobs(now: string, limit: number): Promise<DeliveryJob[]>
  markDeliveryResult(jobId: string, status: DeliveryStatus, providerMessageId: string | null, error: string | null): Promise<void>

  // templates + settings + locations
  listTemplates(includeInactive?: boolean): Promise<GiftCardTemplate[]>
  getTemplate(id: string): Promise<GiftCardTemplate | null>
  upsertTemplate(template: GiftCardTemplate): Promise<GiftCardTemplate>
  getSettings(): Promise<SystemSettings>
  updateSettings(patch: Partial<SystemSettings>, audit: { actorId: string; actorRole: string }): Promise<SystemSettings>
  listStoreLocations(): Promise<StoreLocation[]>

  // audit + notes
  appendAudit(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<AuditLogEntry>
  getAudit(entityType: string, entityId: string): Promise<AuditLogEntry[]>
  addNote(giftCardId: string, body: string, authorId: string): Promise<void>
  getNotes(giftCardId: string): Promise<{ id: string; body: string; authorId: string; createdAt: string }[]>
}
