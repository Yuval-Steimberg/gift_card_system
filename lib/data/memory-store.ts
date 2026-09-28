import { randomUUID } from 'node:crypto'
import type {
  AuditLogEntry,
  DeliveryStatus,
  GiftCard,
  GiftCardStatus,
  GiftCardTemplate,
  LedgerEntry,
  Payment,
  Redemption,
  RedemptionReversal,
  StoreLocation,
} from '@/lib/gift-cards/types'
import { assertTransition, canTransition, statusForBalance } from '@/lib/gift-cards/status'
import { signedAmount, wouldOverspend } from '@/lib/gift-cards/ledger'
import { REDEEMABLE_STATUSES } from '@/lib/gift-cards/types'
import { toMinor, type Minor } from '@/lib/money'
import { KeyedMutex } from './mutex'
import type {
  ActivateFromPaymentInput,
  ActivateResult,
  CreateGiftCardInput,
  DeliveryJob,
  GiftCardFilter,
  GiftCardStore,
  LedgerAdjustmentInput,
  RedeemInput,
  RedeemResult,
  ReversalInput,
  SystemSettings,
} from './store'
import { PAYMENT_MATCH_WINDOW_DAYS, STALE_CLAIM_MS } from './store'
import type { DeliveryHealthReport } from './store'
import type { EmailProviderEvent } from '@/lib/delivery/email/events'
import { seedMemoryStore } from './seed-data'

/** Single lock guarding "which card does this payment belong to?" — the answer
 *  is not known up front, so it cannot be a per-card lock. Mirrors the
 *  FOR UPDATE SKIP LOCKED claim in 0005_payment_matching.sql. */
const PAYMENT_MATCH_LOCK = '__payment_match__'

interface Note {
  id: string
  giftCardId: string
  body: string
  authorId: string
  createdAt: string
}

/**
 * In-memory implementation of GiftCardStore. Default runtime when Supabase is
 * not configured, and the target of the financial integration tests. Atomicity
 * on a single card is provided by a per-card mutex (mirrors SELECT … FOR UPDATE).
 */
export class MemoryStore implements GiftCardStore {
  private cards = new Map<string, GiftCard>()
  private ledger: LedgerEntry[] = []
  private redemptions: Redemption[] = []
  private reversals: RedemptionReversal[] = []
  private payments = new Map<string, Payment>() // by giftCardId
  private processedEvents = new Map<string, string>() // eventId -> giftCardId (idempotency)
  private unmatchedPayments: DeliveryHealthReport['unmatchedPayments'] = [] // charged, no card
  private knownProviderPaymentIds = new Set<string>() // every charge we were told about
  private processedRedemptionKeys = new Map<string, RedeemResult>() // idempotencyKey -> result
  private processedLedgerKeys = new Set<string>()
  private deliveryJobs = new Map<string, DeliveryJob>()
  private templates = new Map<string, GiftCardTemplate>()
  private locations: StoreLocation[] = []
  private audit: AuditLogEntry[] = []
  private notes: Note[] = []
  private settings: SystemSettings
  private mutex = new KeyedMutex()

  constructor() {
    const seed = seedMemoryStore()
    this.settings = seed.settings
    for (const t of seed.templates) this.templates.set(t.id, t)
    this.locations = seed.locations
    for (const c of seed.cards) this.cards.set(c.id, c)
    this.ledger.push(...seed.ledger)
    this.redemptions.push(...seed.redemptions)
    for (const p of seed.payments) this.payments.set(p.giftCardId, p)
    for (const j of seed.deliveryJobs) this.deliveryJobs.set(j.id, j)
    this.audit.push(...seed.audit)
  }

  private now(): string {
    return new Date().toISOString()
  }

  private touch(card: GiftCard): void {
    card.updatedAt = this.now()
    this.cards.set(card.id, card)
  }

  // ---------------------------------------------------------------- gift cards
  async createGiftCard(input: CreateGiftCardInput): Promise<GiftCard> {
    const id = randomUUID()
    const now = this.now()
    const card: GiftCard = {
      id,
      code: input.code,
      publicToken: input.publicToken,
      status: 'draft',
      currency: input.currency,
      initialAmountMinor: input.initialAmountMinor,
      balanceMinor: 0, // credited on activation
      templateId: input.templateId,
      buyerName: input.buyerName,
      buyerEmail: input.buyerEmail,
      buyerPhone: input.buyerPhone,
      buyerCompany: input.buyerCompany,
      buyerTaxId: input.buyerTaxId,
      wantsInvoice: input.wantsInvoice,
      isAnonymous: input.isAnonymous,
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail,
      recipientPhone: input.recipientPhone,
      recipientLanguage: input.recipientLanguage,
      deliveryChannel: input.deliveryChannel,
      greeting: input.greeting,
      scheduledDeliveryAt: input.scheduledDeliveryAt,
      senderTimezone: input.senderTimezone,
      paymentId: null,
      issuedAt: null,
      expiresAt: input.expiresAt,
      supersededByCardId: null,
      createdAt: now,
      updatedAt: now,
    }
    this.cards.set(id, card)
    return { ...card }
  }

  async getGiftCardById(id: string): Promise<GiftCard | null> {
    const c = this.cards.get(id)
    return c ? { ...c } : null
  }

  async getGiftCardByToken(token: string): Promise<GiftCard | null> {
    for (const c of this.cards.values()) if (c.publicToken === token) return { ...c }
    return null
  }

  async getGiftCardByCode(code: string): Promise<GiftCard | null> {
    for (const c of this.cards.values()) if (c.code === code) return { ...c }
    return null
  }

  async listGiftCards(filter: GiftCardFilter): Promise<{ items: GiftCard[]; total: number }> {
    let items = [...this.cards.values()]
    const q = filter.query?.trim().toLowerCase()
    if (q) {
      items = items.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.recipientName.toLowerCase().includes(q) ||
          (c.buyerName ?? '').toLowerCase().includes(q) ||
          c.buyerEmail.toLowerCase().includes(q) ||
          c.recipientEmail.toLowerCase().includes(q) ||
          (c.buyerPhone ?? '').includes(q) ||
          (c.recipientPhone ?? '').includes(q),
      )
    }
    if (filter.status) items = items.filter((c) => c.status === filter.status)
    if (filter.templateId) items = items.filter((c) => c.templateId === filter.templateId)
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    const total = items.length
    const offset = filter.offset ?? 0
    const limit = filter.limit ?? 50
    return { items: items.slice(offset, offset + limit).map((c) => ({ ...c })), total }
  }

  async updateGiftCardFields(
    id: string,
    fields: Partial<Pick<GiftCard, 'recipientName' | 'recipientEmail' | 'recipientPhone' | 'scheduledDeliveryAt' | 'expiresAt'>>,
    audit: { actorId: string; actorRole: string; reason: string },
  ): Promise<GiftCard> {
    const card = this.cards.get(id)
    if (!card) throw new Error('gift card not found')
    Object.assign(card, fields)
    this.touch(card)
    await this.appendAudit({
      actorId: audit.actorId,
      actorRole: audit.actorRole,
      action: 'giftcard.update_fields',
      entityType: 'gift_card',
      entityId: id,
      reason: audit.reason,
      metadata: { fields },
    })
    return { ...card }
  }

  // ------------------------------------------------------------------ payments
  async attachPayment(
    giftCardId: string,
    payment: Omit<Payment, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Payment> {
    const now = this.now()
    const rec: Payment = { ...payment, id: randomUUID(), createdAt: now, updatedAt: now }
    this.payments.set(giftCardId, rec)
    const card = this.cards.get(giftCardId)
    if (card) {
      card.paymentId = rec.id
      this.touch(card)
    }
    return { ...rec }
  }

  async getPaymentByGiftCard(giftCardId: string): Promise<Payment | null> {
    const p = this.payments.get(giftCardId)
    return p ? { ...p } : null
  }

  async setCheckoutOpened(giftCardId: string, providerCheckoutId: string): Promise<void> {
    await this.mutex.runExclusive(giftCardId, async () => {
      const card = this.cards.get(giftCardId)
      if (card && canTransition(card.status, 'awaiting_payment')) {
        card.status = 'awaiting_payment'
        this.touch(card)
      }
      const payment = this.payments.get(giftCardId)
      if (payment) {
        payment.providerCheckoutId = providerCheckoutId
        payment.status = 'processing'
        payment.updatedAt = this.now()
      }
    })
  }

  /**
   * Resolve which card a provider callback paid for. Mirrors the SQL in
   * 0005_payment_matching.sql: order_ref first, else the newest PENDING card
   * with the exact amount whose buyer OR recipient address is the payer's,
   * within the match window. Case-insensitive equality — never a LIKE pattern.
   * Must only be called while holding PAYMENT_MATCH_LOCK.
   */
  private resolvePaidCardId(input: ActivateFromPaymentInput): string | null {
    if (input.orderRef && this.cards.has(input.orderRef)) return input.orderRef
    const email = input.match?.email?.trim().toLowerCase()
    if (!email) return null
    const notBefore = Date.now() - PAYMENT_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000
    const pending: GiftCard['status'][] = ['draft', 'awaiting_payment', 'payment_processing', 'failed']
    const match = [...this.cards.values()]
      .filter(
        (c) =>
          pending.includes(c.status) &&
          c.initialAmountMinor === input.amountMinor &&
          Date.parse(c.createdAt) > notBefore &&
          ((c.buyerEmail ?? '').trim().toLowerCase() === email ||
            (c.recipientEmail ?? '').trim().toLowerCase() === email),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
    return match ? match.id : null
  }

  async activateFromPayment(input: ActivateFromPaymentInput): Promise<ActivateResult> {
    // Resolve + activate without ever releasing a lock in between, so two
    // callbacks arriving together cannot both claim the same pending card (the
    // production path gets this from FOR UPDATE SKIP LOCKED inside one
    // transaction). The resolve lock is global because the card identity is
    // exactly what is not yet known; the per-card lock below is what actually
    // guards the mutation against a concurrent redemption.
    return this.mutex.runExclusive(PAYMENT_MATCH_LOCK, async () => {
      // Idempotency: a repeated verified webhook must not double-activate.
      if (this.processedEvents.has(input.eventId)) {
        const priorId = this.processedEvents.get(input.eventId)!
        if (!priorId) return { code: 'unmatched', message: 'no gift card matched this payment' }
        const prior = this.cards.get(priorId)
        return { code: 'already_processed', giftCardId: prior?.id, giftCard: prior ? { ...prior } : undefined }
      }
      if (input.providerPaymentId) this.knownProviderPaymentIds.add(input.providerPaymentId)
      const cardId = this.resolvePaidCardId(input)
      if (!cardId) {
        this.processedEvents.set(input.eventId, '')
        this.unmatchedPayments.push({
          provider: input.provider,
          eventId: input.eventId,
          amountMinor: input.amountMinor,
          payerEmail: input.match?.email ?? null,
          createdAt: this.now(),
        })
        await this.appendAudit({
          actorId: null,
          actorRole: 'system',
          action: 'payment.webhook_unmatched',
          entityType: 'payment_event',
          entityId: input.eventId,
          reason: `no card matched (email=${input.match?.email ?? '—'} amount=${input.amountMinor})`,
          metadata: { provider: input.provider, eventId: input.eventId, amountMinor: input.amountMinor },
        })
        return { code: 'unmatched', message: 'no gift card matched this payment' }
      }
      return this.activateResolvedCard(cardId, input)
    })
  }

  private async activateResolvedCard(cardId: string, input: ActivateFromPaymentInput): Promise<ActivateResult> {
    return this.mutex.runExclusive(cardId, async () => {
      const card = this.cards.get(cardId)
      if (!card) return { code: 'not_found' }

      // Reconcile the paid amount against our authoritative stored amount.
      if (input.amountMinor !== card.initialAmountMinor) {
        this.processedEvents.set(input.eventId, card.id)
        const payment = this.payments.get(card.id)
        if (payment) {
          payment.status = 'failed'
          payment.updatedAt = this.now()
        }
        await this.appendAudit({
          actorId: null,
          actorRole: 'system',
          action: 'payment.amount_mismatch',
          entityType: 'gift_card',
          entityId: card.id,
          reason: 'paid amount does not match order amount',
          metadata: { expected: card.initialAmountMinor, received: input.amountMinor },
        })
        return { code: 'amount_mismatch', giftCardId: card.id, message: 'paid amount does not match order' }
      }

      if (card.status === 'active' || card.status === 'partially_redeemed' || card.status === 'fully_redeemed') {
        // Already active from a prior event under a different id — record + noop.
        this.processedEvents.set(input.eventId, card.id)
        return { code: 'already_processed', giftCardId: card.id, giftCard: { ...card } }
      }
      if (!canTransition(card.status, 'active') && (card.status as string) !== 'paid') {
        return { code: 'not_activatable', giftCardId: card.id, message: `cannot activate from ${card.status}` }
      }

      // Mark event processed BEFORE mutation (idempotency barrier within the lock).
      this.processedEvents.set(input.eventId, card.id)

      // Upsert payment as paid.
      const payment = this.payments.get(card.id)
      if (payment) {
        payment.status = 'paid'
        payment.providerPaymentId = input.providerPaymentId
        payment.updatedAt = this.now()
      }

      // Exactly one initial credit.
      card.status = 'active'
      card.balanceMinor = card.initialAmountMinor
      card.issuedAt = this.now()
      this.pushLedger(card, 'initial_credit', card.initialAmountMinor, {
        referenceType: 'payment',
        referenceId: input.providerPaymentId,
        idempotencyKey: `activate:${input.eventId}`,
        reason: 'initial gift card credit',
      })
      this.touch(card)
      await this.appendAudit({
        actorId: null,
        actorRole: 'system',
        action: 'giftcard.activated',
        entityType: 'gift_card',
        entityId: card.id,
        reason: 'verified payment',
        metadata: { provider: input.provider, providerPaymentId: input.providerPaymentId },
      })
      return { code: 'activated', giftCardId: card.id, giftCard: { ...card } }
    })
  }

  private pushLedger(
    card: GiftCard,
    type: LedgerEntry['type'],
    magnitudeMinor: Minor,
    opts: {
      referenceType?: string | null
      referenceId?: string | null
      reason?: string | null
      createdBy?: string | null
      approvedBy?: string | null
      idempotencyKey?: string | null
      metadata?: Record<string, unknown>
    } = {},
  ): LedgerEntry {
    const delta = signedAmount(type, magnitudeMinor)
    const entry: LedgerEntry = {
      id: randomUUID(),
      giftCardId: card.id,
      type,
      amountMinor: delta,
      currency: card.currency,
      balanceAfterMinor: card.balanceMinor,
      referenceType: opts.referenceType ?? null,
      referenceId: opts.referenceId ?? null,
      reason: opts.reason ?? null,
      createdBy: opts.createdBy ?? null,
      approvedBy: opts.approvedBy ?? null,
      idempotencyKey: opts.idempotencyKey ?? null,
      createdAt: this.now(),
      metadata: opts.metadata ?? {},
    }
    this.ledger.push(entry)
    return entry
  }

  // -------------------------------------------------------- redemption (atomic)
  async redeem(input: RedeemInput): Promise<RedeemResult> {
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      return { code: 'invalid_amount', message: 'amount must be a positive integer' }
    }
    return this.mutex.runExclusive(input.giftCardId, async () => {
      // Idempotency: a repeated submit returns the SAME prior result, no re-debit.
      const prior = this.processedRedemptionKeys.get(input.idempotencyKey)
      if (prior) return { ...prior, code: prior.code === 'ok' ? 'duplicate' : prior.code }

      const card = this.cards.get(input.giftCardId)
      if (!card) return this.recordRedeemResult(input.idempotencyKey, { code: 'not_found' })

      if (card.expiresAt && new Date(card.expiresAt).getTime() <= Date.now()) {
        return this.recordRedeemResult(input.idempotencyKey, { code: 'expired' })
      }
      if (!REDEEMABLE_STATUSES.includes(card.status)) {
        return this.recordRedeemResult(input.idempotencyKey, {
          code: 'not_redeemable',
          status: card.status,
          message: `card is ${card.status}`,
        })
      }
      const delta = signedAmount('redemption_debit', input.amountMinor)
      if (wouldOverspend(card.balanceMinor, delta)) {
        return this.recordRedeemResult(input.idempotencyKey, {
          code: 'insufficient_balance',
          balanceAfterMinor: card.balanceMinor,
          status: card.status,
        })
      }

      const balanceBefore = card.balanceMinor
      card.balanceMinor += delta
      const newStatus = statusForBalance(card.status, card.balanceMinor, card.initialAmountMinor)
      card.status = newStatus
      this.pushLedger(card, 'redemption_debit', input.amountMinor, {
        referenceType: 'redemption',
        idempotencyKey: input.idempotencyKey,
        createdBy: input.employeeId,
        reason: 'in-store redemption',
      })
      const redemption: Redemption = {
        id: randomUUID(),
        giftCardId: card.id,
        amountMinor: input.amountMinor,
        balanceBeforeMinor: balanceBefore,
        balanceAfterMinor: card.balanceMinor,
        employeeId: input.employeeId,
        storeLocationId: input.storeLocationId ?? null,
        idempotencyKey: input.idempotencyKey,
        saleReference: input.saleReference ?? null,
        receiptNumber: input.receiptNumber ?? null,
        note: input.note ?? null,
        reversedByReversalId: null,
        createdAt: this.now(),
        metadata: input.metadata ?? {},
      }
      this.redemptions.push(redemption)
      // link ledger reference id
      const lastLedger = this.ledger[this.ledger.length - 1]
      if (lastLedger) lastLedger.referenceId = redemption.id
      this.touch(card)
      await this.appendAudit({
        actorId: input.employeeId,
        actorRole: 'store_employee',
        action: 'redemption.performed',
        entityType: 'gift_card',
        entityId: card.id,
        reason: null,
        metadata: { amountMinor: input.amountMinor, redemptionId: redemption.id, storeLocationId: input.storeLocationId ?? null },
      })
      const result: RedeemResult = {
        code: 'ok',
        redemption: { ...redemption },
        balanceAfterMinor: card.balanceMinor,
        status: card.status,
      }
      return this.recordRedeemResult(input.idempotencyKey, result)
    })
  }

  private recordRedeemResult(key: string, result: RedeemResult): RedeemResult {
    this.processedRedemptionKeys.set(key, result)
    return result
  }

  async reverseRedemption(
    input: ReversalInput,
  ): Promise<{ ok: boolean; reversal?: RedemptionReversal; message?: string }> {
    const redemption = this.redemptions.find((r) => r.id === input.redemptionId)
    if (!redemption) return { ok: false, message: 'redemption not found' }
    return this.mutex.runExclusive(redemption.giftCardId, async () => {
      if (redemption.reversedByReversalId) return { ok: false, message: 'already reversed' }
      const card = this.cards.get(redemption.giftCardId)
      if (!card) return { ok: false, message: 'gift card not found' }
      const reversal: RedemptionReversal = {
        id: randomUUID(),
        redemptionId: redemption.id,
        giftCardId: card.id,
        amountMinor: redemption.amountMinor,
        reason: input.reason,
        requestedBy: input.requestedBy,
        approvedBy: input.approvedBy,
        createdAt: this.now(),
      }
      card.balanceMinor += redemption.amountMinor // compensating credit
      card.status = statusForBalance(
        card.status === 'fully_redeemed' ? 'partially_redeemed' : card.status,
        card.balanceMinor,
        card.initialAmountMinor,
      )
      this.pushLedger(card, 'redemption_reversal_credit', redemption.amountMinor, {
        referenceType: 'redemption_reversal',
        referenceId: reversal.id,
        reason: input.reason,
        createdBy: input.requestedBy,
        approvedBy: input.approvedBy,
      })
      redemption.reversedByReversalId = reversal.id
      this.reversals.push(reversal)
      this.touch(card)
      await this.appendAudit({
        actorId: input.approvedBy,
        actorRole: 'store_manager',
        action: 'redemption.reversed',
        entityType: 'gift_card',
        entityId: card.id,
        reason: input.reason,
        metadata: { redemptionId: redemption.id, reversalId: reversal.id, requestedBy: input.requestedBy },
      })
      return { ok: true, reversal: { ...reversal } }
    })
  }

  async applyLedgerAdjustment(
    input: LedgerAdjustmentInput,
  ): Promise<{ ok: boolean; balanceAfterMinor?: Minor; message?: string }> {
    return this.mutex.runExclusive(input.giftCardId, async () => {
      if (input.idempotencyKey && this.processedLedgerKeys.has(input.idempotencyKey)) {
        const card = this.cards.get(input.giftCardId)
        return { ok: true, balanceAfterMinor: card?.balanceMinor }
      }
      const card = this.cards.get(input.giftCardId)
      if (!card) return { ok: false, message: 'gift card not found' }
      const delta = signedAmount(input.type, input.magnitudeMinor)
      if (wouldOverspend(card.balanceMinor, delta)) return { ok: false, message: 'would drive balance negative' }
      card.balanceMinor += delta
      card.status = statusForBalance(card.status, card.balanceMinor, card.initialAmountMinor)
      this.pushLedger(card, input.type, input.magnitudeMinor, {
        referenceType: input.referenceType ?? 'manual_adjustment',
        referenceId: input.referenceId ?? null,
        reason: input.reason,
        createdBy: input.createdBy,
        approvedBy: input.approvedBy ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        metadata: input.metadata,
      })
      if (input.idempotencyKey) this.processedLedgerKeys.add(input.idempotencyKey)
      this.touch(card)
      await this.appendAudit({
        actorId: input.createdBy,
        actorRole: 'admin',
        action: `ledger.${input.type}`,
        entityType: 'gift_card',
        entityId: card.id,
        reason: input.reason,
        metadata: { magnitudeMinor: input.magnitudeMinor, type: input.type },
      })
      return { ok: true, balanceAfterMinor: card.balanceMinor }
    })
  }

  async getLedger(giftCardId: string): Promise<LedgerEntry[]> {
    return this.ledger.filter((e) => e.giftCardId === giftCardId).map((e) => ({ ...e }))
  }

  async getRedemptions(giftCardId: string): Promise<Redemption[]> {
    return this.redemptions.filter((r) => r.giftCardId === giftCardId).map((r) => ({ ...r }))
  }

  // ---------------------------------------------------------- lifecycle actions
  async transitionStatus(
    giftCardId: string,
    to: GiftCardStatus,
    audit: { actorId: string; actorRole: string; reason: string },
  ): Promise<{ ok: boolean; message?: string }> {
    return this.mutex.runExclusive(giftCardId, async () => {
      const card = this.cards.get(giftCardId)
      if (!card) return { ok: false, message: 'gift card not found' }
      if (!canTransition(card.status, to)) return { ok: false, message: `illegal transition ${card.status} -> ${to}` }
      const from = card.status
      card.status = to
      this.touch(card)
      await this.appendAudit({
        actorId: audit.actorId,
        actorRole: audit.actorRole,
        action: `giftcard.status.${to}`,
        entityType: 'gift_card',
        entityId: giftCardId,
        reason: audit.reason,
        metadata: { from, to },
      })
      return { ok: true }
    })
  }

  async reissue(
    giftCardId: string,
    newCode: string,
    newToken: string,
    audit: { actorId: string; actorRole: string; reason: string },
  ): Promise<{ ok: boolean; newCard?: GiftCard; message?: string }> {
    return this.mutex.runExclusive(giftCardId, async () => {
      const old = this.cards.get(giftCardId)
      if (!old) return { ok: false, message: 'gift card not found' }
      if (!canTransition(old.status, 'reissued')) return { ok: false, message: `cannot reissue from ${old.status}` }
      const remaining = old.balanceMinor
      const now = this.now()
      const newCard: GiftCard = {
        ...old,
        id: randomUUID(),
        code: newCode,
        publicToken: newToken,
        status: remaining > 0 ? statusForBalance('active', remaining, old.initialAmountMinor) : 'active',
        initialAmountMinor: old.initialAmountMinor,
        balanceMinor: remaining,
        issuedAt: now,
        supersededByCardId: null,
        createdAt: now,
        updatedAt: now,
      }
      // Zero out the old card and void it.
      this.pushLedger(old, 'reissue_transfer', remaining, {
        referenceType: 'reissue',
        referenceId: newCard.id,
        reason: audit.reason,
        createdBy: audit.actorId,
      })
      old.balanceMinor = 0
      old.status = 'reissued'
      old.supersededByCardId = newCard.id
      this.touch(old)
      // Seed the new card's balance via an initial credit.
      this.cards.set(newCard.id, newCard)
      newCard.balanceMinor = 0
      this.pushLedger(newCard, 'initial_credit', remaining, {
        referenceType: 'reissue',
        referenceId: old.id,
        reason: 'reissued from ' + old.code,
        createdBy: audit.actorId,
      })
      newCard.balanceMinor = remaining
      this.touch(newCard)
      await this.appendAudit({
        actorId: audit.actorId,
        actorRole: audit.actorRole,
        action: 'giftcard.reissued',
        entityType: 'gift_card',
        entityId: old.id,
        reason: audit.reason,
        metadata: { newCardId: newCard.id, remainingMinor: remaining },
      })
      return { ok: true, newCard: { ...newCard } }
    })
  }

  // ------------------------------------------------------------------- delivery
  async createDeliveryJob(
    giftCardId: string,
    channel: 'email' | 'sms' | 'whatsapp',
    scheduledFor: string | null,
  ): Promise<DeliveryJob> {
    // Duplicate-prevention: reuse an open job for the same card+channel.
    for (const j of this.deliveryJobs.values()) {
      if (j.giftCardId === giftCardId && j.channel === channel && (j.status === 'pending' || j.status === 'scheduled')) {
        return { ...j }
      }
    }
    const now = this.now()
    const job: DeliveryJob = {
      id: randomUUID(),
      giftCardId,
      channel,
      status: scheduledFor ? 'scheduled' : 'pending',
      scheduledFor,
      attempts: 0,
      lastError: null,
      providerMessageId: null,
      createdAt: now,
      updatedAt: now,
    }
    this.deliveryJobs.set(job.id, job)
    return { ...job }
  }

  async getDeliveryJobs(giftCardId: string): Promise<DeliveryJob[]> {
    return [...this.deliveryJobs.values()]
      .filter((j) => j.giftCardId === giftCardId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((j) => ({ ...j }))
  }

  async countCardsWithFailedDelivery(): Promise<number> {
    const staleBefore = Date.now() - STALE_CLAIM_MS
    const failed = new Map<string, string>() // card → createdAt of its latest failed job
    const delivered = new Map<string, string>() // card → updatedAt of its latest success
    for (const j of this.deliveryJobs.values()) {
      // A job abandoned in 'processing' means the email never went out either —
      // count it so /admin shows it instead of silently losing the card.
      if (
        j.status === 'failed' ||
        j.status === 'cancelled' || // the provider rejected it — a human must act
        (j.status === 'processing' && Date.parse(j.updatedAt) < staleBefore)
      ) {
        if ((failed.get(j.giftCardId) ?? '') < j.createdAt) failed.set(j.giftCardId, j.createdAt)
      } else if (j.status === 'delivered' || j.status === 'sent') {
        if ((delivered.get(j.giftCardId) ?? '') < j.updatedAt) delivered.set(j.giftCardId, j.updatedAt)
      }
    }
    // A failure a later send already fixed (a resend after an outage) is history,
    // not a card that still needs someone.
    let n = 0
    for (const [card, failedAt] of failed) {
      const okAt = delivered.get(card)
      if (!okAt || Date.parse(okAt) < Date.parse(failedAt)) n++
    }
    return n
  }

  async claimDueDeliveryJobs(now: string, limit: number): Promise<DeliveryJob[]> {
    const nowMs = new Date(now).getTime()
    const due: DeliveryJob[] = []
    for (const j of this.deliveryJobs.values()) {
      const ready =
        (j.status === 'pending' && (!j.scheduledFor || new Date(j.scheduledFor).getTime() <= nowMs)) ||
        (j.status === 'scheduled' && j.scheduledFor && new Date(j.scheduledFor).getTime() <= nowMs) ||
        (j.status === 'failed' && j.attempts < 5) ||
        // Crashed worker: claimed but never finished (see STALE_CLAIM_MS).
        (j.status === 'processing' && j.attempts < 5 && Date.parse(j.updatedAt) < nowMs - STALE_CLAIM_MS)
      if (ready) {
        j.status = 'processing'
        j.attempts += 1
        j.updatedAt = this.now()
        due.push({ ...j })
      }
      if (due.length >= limit) break
    }
    return due
  }

  async markDeliveryResult(
    jobId: string,
    status: DeliveryStatus,
    providerMessageId: string | null,
    error: string | null,
  ): Promise<void> {
    const job = this.deliveryJobs.get(jobId)
    if (!job) return
    job.status = status
    job.providerMessageId = providerMessageId
    job.lastError = error
    job.updatedAt = this.now()
  }

  async applyEmailProviderEvents(
    provider: string,
    events: EmailProviderEvent[],
  ): Promise<{ applied: number; unmatched: number }> {
    let applied = 0
    let unmatched = 0
    for (const ev of events) {
      if (ev.outcome === 'ignored' || ev.outcome === 'deferred') continue
      const job =
        (ev.jobId ? this.deliveryJobs.get(ev.jobId) : undefined) ??
        (ev.messageId
          ? [...this.deliveryJobs.values()].find((j) => j.providerMessageId === ev.messageId)
          : undefined)
      if (!job) {
        unmatched++
        continue
      }
      if (ev.outcome === 'delivered') {
        // A rejection is the actionable state; never let a late 'delivered'
        // overwrite it.
        if (job.status === 'cancelled') continue
        job.status = 'delivered'
        job.lastError = null
      } else {
        // Permanently refused. 'cancelled' (not 'failed') so the retry sweep
        // leaves it alone — re-sending to an address that hard-bounced only
        // burns sender reputation. A human has to act.
        job.status = 'cancelled'
        job.lastError = `${ev.event}: ${ev.reason ?? 'rejected by the receiving server'}`
      }
      job.updatedAt = this.now()
      applied++
      await this.appendAudit({
        actorId: null,
        actorRole: 'system',
        action: ev.outcome === 'delivered' ? 'delivery.provider_delivered' : 'delivery.provider_rejected',
        entityType: 'gift_card',
        entityId: job.giftCardId,
        reason: job.lastError,
        metadata: { provider, event: ev.event, email: ev.email, occurredAt: ev.occurredAt },
      })
    }
    return { applied, unmatched }
  }

  async getDeliveryHealth(sinceIso: string): Promise<DeliveryHealthReport> {
    const since = Date.parse(sinceIso)
    const staleBefore = Date.now() - STALE_CLAIM_MS
    const report: DeliveryHealthReport = { unmatchedPayments: [], paidNotActivated: [], undelivered: [] }

    report.unmatchedPayments = this.unmatchedPayments.filter((p) => Date.parse(p.createdAt) >= since)

    const preActivation: GiftCard['status'][] = ['draft', 'awaiting_payment', 'payment_processing', 'failed']
    const paidCardIds = new Set([...this.processedEvents.values()].filter(Boolean))
    for (const card of this.cards.values()) {
      if (Date.parse(card.createdAt) < since) continue
      if (preActivation.includes(card.status)) {
        if (!paidCardIds.has(card.id)) continue // never paid — nothing owed
        report.paidNotActivated.push({
          id: card.id,
          code: card.code,
          buyerEmail: card.buyerEmail,
          recipientEmail: card.recipientEmail,
          amountMinor: card.initialAmountMinor,
          createdAt: card.createdAt,
        })
        continue
      }
      if (card.status !== 'active' && card.status !== 'partially_redeemed' && card.status !== 'fully_redeemed') continue
      // Active card: did its email actually go out?
      const jobs = [...this.deliveryJobs.values()].filter((j) => j.giftCardId === card.id)
      if (jobs.some((j) => j.status === 'delivered' || j.status === 'sent')) continue
      // A future-dated scheduled card is not late.
      if (jobs.some((j) => j.status === 'scheduled' && j.scheduledFor && Date.parse(j.scheduledFor) > Date.now())) continue
      const worst =
        jobs.find((j) => j.status === 'cancelled' || j.status === 'failed') ??
        jobs.find((j) => j.status === 'processing' && Date.parse(j.updatedAt) < staleBefore) ??
        jobs[0]
      if (jobs.length > 0 && !worst) continue
      report.undelivered.push({
        id: card.id,
        code: card.code,
        recipientEmail: card.recipientEmail,
        amountMinor: card.initialAmountMinor,
        issuedAt: card.issuedAt,
        deliveryStatus: worst?.status ?? 'none',
        lastError: worst?.lastError ?? null,
      })
    }
    return report
  }

  async findKnownProviderPaymentIds(provider: string, providerPaymentIds: string[]): Promise<Set<string>> {
    const wanted = new Set(providerPaymentIds)
    const known = new Set<string>()
    for (const p of this.payments.values()) {
      if (p.provider === provider && p.providerPaymentId && wanted.has(p.providerPaymentId)) {
        known.add(p.providerPaymentId)
      }
    }
    for (const id of this.knownProviderPaymentIds) if (wanted.has(id)) known.add(id)
    return known
  }

  // -------------------------------------------------------- templates/settings
  async listTemplates(includeInactive = false): Promise<GiftCardTemplate[]> {
    const all = [...this.templates.values()]
    return (includeInactive ? all : all.filter((t) => t.isActive)).map((t) => ({ ...t }))
  }
  async getTemplate(id: string): Promise<GiftCardTemplate | null> {
    const t = this.templates.get(id)
    return t ? { ...t } : null
  }
  async upsertTemplate(template: GiftCardTemplate): Promise<GiftCardTemplate> {
    this.templates.set(template.id, { ...template })
    if (template.isDefault) {
      for (const t of this.templates.values()) if (t.id !== template.id) t.isDefault = false
    }
    return { ...template }
  }
  async getSettings(): Promise<SystemSettings> {
    return { ...this.settings, presetAmountsMinor: [...this.settings.presetAmountsMinor] }
  }
  async updateSettings(patch: Partial<SystemSettings>, audit: { actorId: string; actorRole: string }): Promise<SystemSettings> {
    this.settings = { ...this.settings, ...patch }
    await this.appendAudit({
      actorId: audit.actorId,
      actorRole: audit.actorRole,
      action: 'settings.update',
      entityType: 'settings',
      entityId: 'system',
      reason: null,
      metadata: { keys: Object.keys(patch) },
    })
    return this.getSettings()
  }
  async listStoreLocations(): Promise<StoreLocation[]> {
    return this.locations.map((l) => ({ ...l }))
  }

  // ------------------------------------------------------------- audit + notes
  async appendAudit(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<AuditLogEntry> {
    const rec: AuditLogEntry = { ...entry, id: randomUUID(), createdAt: this.now() }
    this.audit.push(rec)
    return { ...rec }
  }
  async getAudit(entityType: string, entityId: string): Promise<AuditLogEntry[]> {
    return this.audit
      .filter((a) => a.entityType === entityType && a.entityId === entityId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((a) => ({ ...a }))
  }
  async addNote(giftCardId: string, body: string, authorId: string): Promise<void> {
    this.notes.push({ id: randomUUID(), giftCardId, body, authorId, createdAt: this.now() })
    await this.appendAudit({
      actorId: authorId,
      actorRole: 'admin',
      action: 'giftcard.note_added',
      entityType: 'gift_card',
      entityId: giftCardId,
      reason: null,
      metadata: {},
    })
  }
  async getNotes(giftCardId: string): Promise<{ id: string; body: string; authorId: string; createdAt: string }[]> {
    return this.notes
      .filter((n) => n.giftCardId === giftCardId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((n) => ({ id: n.id, body: n.body, authorId: n.authorId, createdAt: n.createdAt }))
  }
}

// Re-export for convenience in tests.
export { toMinor }
