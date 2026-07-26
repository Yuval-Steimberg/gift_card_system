import 'server-only'
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
import type { Minor } from '@/lib/money'
import { supabaseAdmin } from './supabase-client'
import { defaultSystemSettings } from './seed-data'
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

/**
 * Production persistence backed by Supabase/Postgres. Atomicity + idempotency
 * for money movement are delegated to the SQL functions created by the
 * migrations in supabase/ (`redeem_gift_card`, `activate_gift_card_from_payment`)
 * which use `SELECT … FOR UPDATE` + unique constraints — never read-modify-write
 * in application code.
 *
 * Row <-> domain mapping is snake_case <-> camelCase. This adapter is enabled
 * automatically when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
 * set; otherwise the MemoryStore is used.
 */
export class SupabaseStore implements GiftCardStore {
  private db = supabaseAdmin()

  // ---- mappers ----
  private toCard(r: Record<string, any>): GiftCard {
    return {
      id: r.id,
      code: r.code,
      publicToken: r.public_token,
      status: r.status,
      currency: r.currency,
      initialAmountMinor: Number(r.initial_amount_minor),
      balanceMinor: Number(r.balance_minor),
      templateId: r.template_id,
      buyerName: r.buyer_name,
      buyerEmail: r.buyer_email,
      buyerPhone: r.buyer_phone,
      buyerCompany: r.buyer_company,
      buyerTaxId: r.buyer_tax_id,
      wantsInvoice: r.wants_invoice,
      isAnonymous: r.is_anonymous,
      recipientName: r.recipient_name,
      recipientEmail: r.recipient_email,
      recipientPhone: r.recipient_phone,
      recipientLanguage: r.recipient_language,
      deliveryChannel: r.delivery_channel,
      greeting: r.greeting ?? '',
      scheduledDeliveryAt: r.scheduled_delivery_at,
      senderTimezone: r.sender_timezone,
      paymentId: r.payment_id,
      issuedAt: r.issued_at,
      expiresAt: r.expires_at,
      supersededByCardId: r.superseded_by_card_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }
  }

  async createGiftCard(input: CreateGiftCardInput): Promise<GiftCard> {
    const { data, error } = await this.db
      .from('gift_cards')
      .insert({
        code: input.code,
        public_token: input.publicToken,
        status: 'draft',
        currency: input.currency,
        initial_amount_minor: input.initialAmountMinor,
        balance_minor: 0,
        template_id: input.templateId,
        buyer_name: input.buyerName,
        buyer_email: input.buyerEmail,
        buyer_phone: input.buyerPhone,
        buyer_company: input.buyerCompany,
        buyer_tax_id: input.buyerTaxId,
        wants_invoice: input.wantsInvoice,
        is_anonymous: input.isAnonymous,
        recipient_name: input.recipientName,
        recipient_email: input.recipientEmail,
        recipient_phone: input.recipientPhone,
        recipient_language: input.recipientLanguage,
        delivery_channel: input.deliveryChannel,
        greeting: input.greeting,
        scheduled_delivery_at: input.scheduledDeliveryAt,
        sender_timezone: input.senderTimezone,
        expires_at: input.expiresAt,
      })
      .select('*')
      .single()
    if (error) throw error
    return this.toCard(data)
  }

  async getGiftCardById(id: string): Promise<GiftCard | null> {
    const { data } = await this.db.from('gift_cards').select('*').eq('id', id).maybeSingle()
    return data ? this.toCard(data) : null
  }

  async findPendingCardIdByEmailAndAmount(email: string, amountMinor: number): Promise<string | null> {
    const { data } = await this.db
      .from('gift_cards')
      .select('id')
      .ilike('buyer_email', email.trim())
      .eq('initial_amount_minor', amountMinor)
      .in('status', ['draft', 'awaiting_payment', 'payment_processing'])
      .order('created_at', { ascending: false })
      .limit(1)
    return data && data[0] ? String(data[0].id) : null
  }
  async getGiftCardByToken(token: string): Promise<GiftCard | null> {
    const { data } = await this.db.from('gift_cards').select('*').eq('public_token', token).maybeSingle()
    return data ? this.toCard(data) : null
  }
  async getGiftCardByCode(code: string): Promise<GiftCard | null> {
    const { data } = await this.db.from('gift_cards').select('*').eq('code', code).maybeSingle()
    return data ? this.toCard(data) : null
  }

  async listGiftCards(filter: GiftCardFilter): Promise<{ items: GiftCard[]; total: number }> {
    let q = this.db.from('gift_cards').select('*', { count: 'exact' })
    if (filter.status) q = q.eq('status', filter.status)
    if (filter.templateId) q = q.eq('template_id', filter.templateId)
    if (filter.query) {
      const term = `%${filter.query}%`
      q = q.or(
        `code.ilike.${term},recipient_name.ilike.${term},buyer_name.ilike.${term},buyer_email.ilike.${term},recipient_email.ilike.${term}`,
      )
    }
    q = q.order('created_at', { ascending: false }).range(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 50) - 1)
    const { data, count, error } = await q
    if (error) throw error
    return { items: (data ?? []).map((r) => this.toCard(r)), total: count ?? 0 }
  }

  async updateGiftCardFields(
    id: string,
    fields: Partial<Pick<GiftCard, 'recipientName' | 'recipientEmail' | 'recipientPhone' | 'scheduledDeliveryAt' | 'expiresAt'>>,
    audit: { actorId: string; actorRole: string; reason: string },
  ): Promise<GiftCard> {
    const patch: Record<string, unknown> = {}
    if (fields.recipientName !== undefined) patch.recipient_name = fields.recipientName
    if (fields.recipientEmail !== undefined) patch.recipient_email = fields.recipientEmail
    if (fields.recipientPhone !== undefined) patch.recipient_phone = fields.recipientPhone
    if (fields.scheduledDeliveryAt !== undefined) patch.scheduled_delivery_at = fields.scheduledDeliveryAt
    if (fields.expiresAt !== undefined) patch.expires_at = fields.expiresAt
    const { data, error } = await this.db.from('gift_cards').update(patch).eq('id', id).select('*').single()
    if (error) throw error
    await this.appendAudit({
      actorId: audit.actorId,
      actorRole: audit.actorRole,
      action: 'giftcard.update_fields',
      entityType: 'gift_card',
      entityId: id,
      reason: audit.reason,
      metadata: { fields },
    })
    return this.toCard(data)
  }

  async attachPayment(giftCardId: string, payment: Omit<Payment, 'id' | 'createdAt' | 'updatedAt'>): Promise<Payment> {
    const { data, error } = await this.db
      .from('payments')
      .insert({
        gift_card_id: giftCardId,
        provider: payment.provider,
        provider_payment_id: payment.providerPaymentId,
        provider_checkout_id: payment.providerCheckoutId,
        amount_minor: payment.amountMinor,
        currency: payment.currency,
        status: payment.status,
      })
      .select('*')
      .single()
    if (error) throw error
    await this.db.from('gift_cards').update({ payment_id: data.id }).eq('id', giftCardId)
    return this.toPayment(data)
  }

  private toPayment(r: Record<string, any>): Payment {
    return {
      id: r.id,
      giftCardId: r.gift_card_id,
      provider: r.provider,
      providerPaymentId: r.provider_payment_id,
      providerCheckoutId: r.provider_checkout_id,
      amountMinor: Number(r.amount_minor),
      currency: r.currency,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }
  }

  async getPaymentByGiftCard(giftCardId: string): Promise<Payment | null> {
    const { data } = await this.db.from('payments').select('*').eq('gift_card_id', giftCardId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    return data ? this.toPayment(data) : null
  }

  async setCheckoutOpened(giftCardId: string, providerCheckoutId: string): Promise<void> {
    await this.db.from('payments').update({ provider_checkout_id: providerCheckoutId, status: 'processing' }).eq('gift_card_id', giftCardId)
    await this.db.from('gift_cards').update({ status: 'awaiting_payment' }).eq('id', giftCardId).eq('status', 'draft')
  }

  async activateFromPayment(input: ActivateFromPaymentInput): Promise<ActivateResult> {
    const { data, error } = await this.db.rpc('activate_gift_card_from_payment', {
      p_gift_card_id: input.orderRef,
      p_provider: input.provider,
      p_event_id: input.eventId,
      p_provider_payment_id: input.providerPaymentId,
      p_amount_minor: input.amountMinor,
      p_currency: input.currency,
      p_raw_event: input.rawEvent,
    })
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    const code = (row?.out_code ?? 'not_found') as ActivateResult['code']
    const card = code === 'activated' || code === 'already_processed' ? await this.getGiftCardById(input.orderRef) : null
    return { code, giftCard: card ?? undefined, message: row?.out_message }
  }

  async redeem(input: RedeemInput): Promise<RedeemResult> {
    const { data, error } = await this.db.rpc('redeem_gift_card', {
      p_gift_card_id: input.giftCardId,
      p_amount_minor: input.amountMinor,
      p_employee_id: input.employeeId,
      p_store_location_id: input.storeLocationId ?? null,
      p_idempotency_key: input.idempotencyKey,
      p_sale_reference: input.saleReference ?? null,
      p_receipt_number: input.receiptNumber ?? null,
      p_note: input.note ?? null,
    })
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    const code = (row?.out_code ?? 'not_found') as RedeemResult['code']
    let redemption: Redemption | undefined
    if (row?.out_redemption_id) {
      const { data: rd } = await this.db.from('gift_card_redemptions').select('*').eq('id', row.out_redemption_id).maybeSingle()
      if (rd) redemption = this.toRedemption(rd)
    }
    return {
      code,
      redemption,
      balanceAfterMinor: row?.out_balance_after != null ? Number(row.out_balance_after) : undefined,
      status: row?.out_status as GiftCardStatus | undefined,
    }
  }

  private toRedemption(r: Record<string, any>): Redemption {
    return {
      id: r.id,
      giftCardId: r.gift_card_id,
      amountMinor: Number(r.amount_minor),
      balanceBeforeMinor: Number(r.balance_before_minor),
      balanceAfterMinor: Number(r.balance_after_minor),
      employeeId: r.employee_id,
      storeLocationId: r.store_location_id,
      idempotencyKey: r.idempotency_key,
      saleReference: r.sale_reference,
      receiptNumber: r.receipt_number,
      note: r.note,
      reversedByReversalId: r.reversed_by_reversal_id,
      createdAt: r.created_at,
      metadata: r.metadata ?? {},
    }
  }

  async reverseRedemption(input: ReversalInput): Promise<{ ok: boolean; reversal?: RedemptionReversal; message?: string }> {
    const { data, error } = await this.db.rpc('reverse_redemption', {
      p_redemption_id: input.redemptionId,
      p_reason: input.reason,
      p_requested_by: input.requestedBy,
      p_approved_by: input.approvedBy,
    })
    if (error) return { ok: false, message: error.message }
    const row = Array.isArray(data) ? data[0] : data
    return { ok: row?.out_code === 'ok', message: row?.out_message }
  }

  async applyLedgerAdjustment(input: LedgerAdjustmentInput): Promise<{ ok: boolean; balanceAfterMinor?: Minor; message?: string }> {
    const { data, error } = await this.db.rpc('apply_ledger_adjustment', {
      p_gift_card_id: input.giftCardId,
      p_type: input.type,
      p_magnitude_minor: input.magnitudeMinor,
      p_reason: input.reason,
      p_created_by: input.createdBy,
      p_approved_by: input.approvedBy ?? null,
      p_idempotency_key: input.idempotencyKey ?? null,
    })
    if (error) return { ok: false, message: error.message }
    const row = Array.isArray(data) ? data[0] : data
    return { ok: row?.out_code === 'ok', balanceAfterMinor: row?.out_balance_after != null ? Number(row.out_balance_after) : undefined, message: row?.out_message }
  }

  async getLedger(giftCardId: string): Promise<LedgerEntry[]> {
    const { data } = await this.db.from('gift_card_ledger_entries').select('*').eq('gift_card_id', giftCardId).order('created_at', { ascending: true })
    return (data ?? []).map((r) => this.toLedger(r))
  }
  private toLedger(r: Record<string, any>): LedgerEntry {
    return {
      id: r.id,
      giftCardId: r.gift_card_id,
      type: r.type,
      amountMinor: Number(r.amount_minor),
      currency: r.currency,
      balanceAfterMinor: Number(r.balance_after_minor),
      referenceType: r.reference_type,
      referenceId: r.reference_id,
      reason: r.reason,
      createdBy: r.created_by,
      approvedBy: r.approved_by,
      idempotencyKey: r.idempotency_key,
      createdAt: r.created_at,
      metadata: r.metadata ?? {},
    }
  }

  async getRedemptions(giftCardId: string): Promise<Redemption[]> {
    const { data } = await this.db.from('gift_card_redemptions').select('*').eq('gift_card_id', giftCardId).order('created_at', { ascending: false })
    return (data ?? []).map((r) => this.toRedemption(r))
  }

  async transitionStatus(
    giftCardId: string,
    to: GiftCardStatus,
    audit: { actorId: string; actorRole: string; reason: string },
  ): Promise<{ ok: boolean; message?: string }> {
    const { data, error } = await this.db.rpc('transition_gift_card_status', {
      p_gift_card_id: giftCardId,
      p_to: to,
      p_actor_id: audit.actorId,
      p_actor_role: audit.actorRole,
      p_reason: audit.reason,
    })
    if (error) return { ok: false, message: error.message }
    const row = Array.isArray(data) ? data[0] : data
    return { ok: row?.out_code === 'ok', message: row?.out_message }
  }

  async reissue(
    giftCardId: string,
    newCode: string,
    newToken: string,
    audit: { actorId: string; actorRole: string; reason: string },
  ): Promise<{ ok: boolean; newCard?: GiftCard; message?: string }> {
    const { data, error } = await this.db.rpc('reissue_gift_card', {
      p_gift_card_id: giftCardId,
      p_new_code: newCode,
      p_new_token: newToken,
      p_actor_id: audit.actorId,
      p_actor_role: audit.actorRole,
      p_reason: audit.reason,
    })
    if (error) return { ok: false, message: error.message }
    const row = Array.isArray(data) ? data[0] : data
    const newCard = row?.out_new_card_id ? await this.getGiftCardById(row.out_new_card_id) : null
    return { ok: row?.out_code === 'ok', newCard: newCard ?? undefined, message: row?.out_message }
  }

  private toJob(r: Record<string, any>): DeliveryJob {
    return {
      id: r.id,
      giftCardId: r.gift_card_id,
      channel: r.channel,
      status: r.status,
      scheduledFor: r.scheduled_for,
      attempts: r.attempts,
      lastError: r.last_error,
      providerMessageId: r.provider_message_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }
  }

  async createDeliveryJob(giftCardId: string, channel: 'email' | 'sms' | 'whatsapp', scheduledFor: string | null): Promise<DeliveryJob> {
    const { data: existing } = await this.db
      .from('delivery_jobs')
      .select('*')
      .eq('gift_card_id', giftCardId)
      .eq('channel', channel)
      .in('status', ['pending', 'scheduled'])
      .maybeSingle()
    if (existing) return this.toJob(existing)
    const { data, error } = await this.db
      .from('delivery_jobs')
      .insert({ gift_card_id: giftCardId, channel, status: scheduledFor ? 'scheduled' : 'pending', scheduled_for: scheduledFor, attempts: 0 })
      .select('*')
      .single()
    if (error) throw error
    return this.toJob(data)
  }

  async getDeliveryJobs(giftCardId: string): Promise<DeliveryJob[]> {
    const { data } = await this.db.from('delivery_jobs').select('*').eq('gift_card_id', giftCardId).order('created_at', { ascending: false })
    return (data ?? []).map((r) => this.toJob(r))
  }

  async countCardsWithFailedDelivery(): Promise<number> {
    // One query: distinct gift cards with a failed delivery job.
    const { data } = await this.db.from('delivery_jobs').select('gift_card_id').eq('status', 'failed')
    return new Set((data ?? []).map((r) => r.gift_card_id)).size
  }

  async claimDueDeliveryJobs(now: string, limit: number): Promise<DeliveryJob[]> {
    const { data, error } = await this.db.rpc('claim_due_delivery_jobs', { p_now: now, p_limit: limit })
    if (error) throw error
    return (data ?? []).map((r: Record<string, any>) => this.toJob(r))
  }

  async markDeliveryResult(jobId: string, status: DeliveryStatus, providerMessageId: string | null, error: string | null): Promise<void> {
    await this.db.from('delivery_jobs').update({ status, provider_message_id: providerMessageId, last_error: error }).eq('id', jobId)
    await this.db.from('delivery_attempts').insert({ delivery_job_id: jobId, status, provider_message_id: providerMessageId, error })
  }

  private toTemplate(r: Record<string, any>): GiftCardTemplate {
    return {
      id: r.id,
      name: r.name,
      occasion: r.occasion,
      language: r.language,
      coverImageUrl: r.cover_image_url,
      backgroundColor: r.background_color,
      textColor: r.text_color,
      accentColor: r.accent_color,
      isActive: r.is_active,
      isDefault: r.is_default,
      createdAt: r.created_at,
    }
  }
  async listTemplates(includeInactive = false): Promise<GiftCardTemplate[]> {
    let q = this.db.from('gift_card_templates').select('*').order('created_at', { ascending: true })
    if (!includeInactive) q = q.eq('is_active', true)
    const { data } = await q
    return (data ?? []).map((r) => this.toTemplate(r))
  }
  async getTemplate(id: string): Promise<GiftCardTemplate | null> {
    const { data } = await this.db.from('gift_card_templates').select('*').eq('id', id).maybeSingle()
    return data ? this.toTemplate(data) : null
  }
  async upsertTemplate(t: GiftCardTemplate): Promise<GiftCardTemplate> {
    const { data, error } = await this.db
      .from('gift_card_templates')
      .upsert({
        id: t.id,
        name: t.name,
        occasion: t.occasion,
        language: t.language,
        cover_image_url: t.coverImageUrl,
        background_color: t.backgroundColor,
        text_color: t.textColor,
        accent_color: t.accentColor,
        is_active: t.isActive,
        is_default: t.isDefault,
      })
      .select('*')
      .single()
    if (error) throw error
    if (t.isDefault) await this.db.from('gift_card_templates').update({ is_default: false }).neq('id', t.id)
    return this.toTemplate(data)
  }

  async getSettings(): Promise<SystemSettings> {
    const { data } = await this.db.from('system_settings').select('*').limit(1).maybeSingle()
    if (!data) {
      // Row missing (seed not run yet, or table just created). Don't crash the
      // read-only pages — fall back to safe defaults. Admin can persist real
      // values later, and /api/health flags that the seed still needs running.
      // eslint-disable-next-line no-console
      console.warn('[data] system_settings row not found — using default settings (run supabase/seed.sql)')
      return defaultSystemSettings()
    }
    return {
      businessName: data.business_name,
      businessEmail: data.business_email,
      businessPhone: data.business_phone,
      storeAddress: data.store_address,
      currency: data.currency,
      timezone: data.timezone,
      presetAmountsMinor: (data.preset_amounts_minor ?? []).map((n: string | number) => Number(n)),
      minAmountMinor: Number(data.min_amount_minor),
      maxAmountMinor: Number(data.max_amount_minor),
      allowCustomAmount: data.allow_custom_amount,
      expiryMonths: data.expiry_months,
      allowPartialRedemption: data.allow_partial_redemption,
      greetingMaxLength: data.greeting_max_length,
      termsUrl: data.terms_url,
      defaultLanguage: data.default_language,
    }
  }

  async updateSettings(patch: Partial<SystemSettings>, audit: { actorId: string; actorRole: string }): Promise<SystemSettings> {
    const map: Record<string, unknown> = {}
    if (patch.businessName !== undefined) map.business_name = patch.businessName
    if (patch.businessEmail !== undefined) map.business_email = patch.businessEmail
    if (patch.businessPhone !== undefined) map.business_phone = patch.businessPhone
    if (patch.storeAddress !== undefined) map.store_address = patch.storeAddress
    if (patch.presetAmountsMinor !== undefined) map.preset_amounts_minor = patch.presetAmountsMinor
    if (patch.minAmountMinor !== undefined) map.min_amount_minor = patch.minAmountMinor
    if (patch.maxAmountMinor !== undefined) map.max_amount_minor = patch.maxAmountMinor
    if (patch.allowCustomAmount !== undefined) map.allow_custom_amount = patch.allowCustomAmount
    if (patch.expiryMonths !== undefined) map.expiry_months = patch.expiryMonths
    if (patch.allowPartialRedemption !== undefined) map.allow_partial_redemption = patch.allowPartialRedemption
    if (patch.greetingMaxLength !== undefined) map.greeting_max_length = patch.greetingMaxLength
    if (patch.termsUrl !== undefined) map.terms_url = patch.termsUrl
    if (patch.defaultLanguage !== undefined) map.default_language = patch.defaultLanguage
    const { data: existing } = await this.db.from('system_settings').select('id').limit(1).maybeSingle()
    // Surface write failures instead of silently reporting success (a swallowed
    // error here meant "settings saved" showed but nothing changed).
    if (existing) {
      const { error } = await this.db.from('system_settings').update(map).eq('id', existing.id)
      if (error) throw new Error(`system_settings update failed: ${error.message}`)
    } else {
      const { error } = await this.db.from('system_settings').insert({ id: 1, ...map })
      if (error) throw new Error(`system_settings insert failed: ${error.message}`)
    }
    await this.appendAudit({ actorId: audit.actorId, actorRole: audit.actorRole, action: 'settings.update', entityType: 'settings', entityId: 'system', reason: null, metadata: { keys: Object.keys(patch) } })
    return this.getSettings()
  }

  async listStoreLocations(): Promise<StoreLocation[]> {
    const { data } = await this.db.from('store_locations').select('*').order('name')
    return (data ?? []).map((r) => ({ id: r.id, name: r.name, address: r.address, timezone: r.timezone, isActive: r.is_active }))
  }

  async appendAudit(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>): Promise<AuditLogEntry> {
    const { data, error } = await this.db
      .from('audit_logs')
      .insert({
        actor_id: entry.actorId,
        actor_role: entry.actorRole,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        reason: entry.reason,
        metadata: entry.metadata,
      })
      .select('*')
      .single()
    if (error) throw error
    return {
      id: data.id,
      actorId: data.actor_id,
      actorRole: data.actor_role,
      action: data.action,
      entityType: data.entity_type,
      entityId: data.entity_id,
      reason: data.reason,
      metadata: data.metadata ?? {},
      createdAt: data.created_at,
    }
  }

  async getAudit(entityType: string, entityId: string): Promise<AuditLogEntry[]> {
    const { data } = await this.db.from('audit_logs').select('*').eq('entity_type', entityType).eq('entity_id', entityId).order('created_at', { ascending: false })
    return (data ?? []).map((d) => ({
      id: d.id,
      actorId: d.actor_id,
      actorRole: d.actor_role,
      action: d.action,
      entityType: d.entity_type,
      entityId: d.entity_id,
      reason: d.reason,
      metadata: d.metadata ?? {},
      createdAt: d.created_at,
    }))
  }

  async addNote(giftCardId: string, body: string, authorId: string): Promise<void> {
    await this.db.from('internal_notes').insert({ gift_card_id: giftCardId, body, author_id: authorId })
    await this.appendAudit({ actorId: authorId, actorRole: 'admin', action: 'giftcard.note_added', entityType: 'gift_card', entityId: giftCardId, reason: null, metadata: {} })
  }

  async getNotes(giftCardId: string): Promise<{ id: string; body: string; authorId: string; createdAt: string }[]> {
    const { data } = await this.db.from('internal_notes').select('*').eq('gift_card_id', giftCardId).order('created_at', { ascending: false })
    return (data ?? []).map((n) => ({ id: n.id, body: n.body, authorId: n.author_id, createdAt: n.created_at }))
  }
}
