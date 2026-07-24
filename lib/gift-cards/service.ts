import 'server-only'
import { serverEnv } from '@/lib/env'
import { getStore } from '@/lib/data'
import { getPaymentProvider, type VerifiedPaymentEvent } from '@/lib/payments'
import { getEmailProvider } from '@/lib/delivery/email'
import { getReceiptProvider } from '@/lib/accounting'
import { generateGiftCardCode, generatePublicToken } from './codes'
import { renderBuyerConfirmationEmail, renderRecipientEmail } from '@/lib/delivery/render'
import { generateGiftCardPdf } from './pdf'
import { recipientUrl } from './qr'
import { sanitizeGreeting, sanitizeLine } from '@/lib/security/text'
import { validateAmountAgainstSettings, type PurchaseInput } from '@/lib/validation/purchase'
import { formatMoney } from '@/lib/money'
import type { GiftCard } from './types'
import type { RedeemInput, RedeemResult, SystemSettings } from '@/lib/data/store'

export async function getSettings(): Promise<SystemSettings> {
  return getStore().getSettings()
}

/** Compute UTC expiry from settings (or null for no expiry). */
function computeExpiry(settings: SystemSettings): string | null {
  if (settings.expiryMonths == null) return null
  const d = new Date()
  d.setMonth(d.getMonth() + settings.expiryMonths)
  return d.toISOString()
}

export interface CreatePurchaseResult {
  ok: boolean
  message?: string
  giftCardId?: string
  redirectUrl?: string
}

/**
 * Create a gift card in a DRAFT (inactive) state, open a payment checkout, and
 * return the provider redirect URL. The card is NOT active and NOT delivered
 * until a verified webhook confirms payment (see processVerifiedPaymentEvent).
 */
export async function createPurchase(input: PurchaseInput): Promise<CreatePurchaseResult> {
  const store = getStore()
  const env = serverEnv()
  const settings = await store.getSettings()

  // Server-authoritative amount policy check (never trust the client).
  const amountCheck = validateAmountAgainstSettings(input.amountMinor, settings)
  if (!amountCheck.ok) return { ok: false, message: amountCheck.message }

  const template = await store.getTemplate(input.templateId)
  if (!template || !template.isActive) return { ok: false, message: 'עיצוב לא זמין' }

  // Scheduled time must be in the future; UTC stored.
  let scheduledDeliveryAt: string | null = null
  if (input.deliveryTiming === 'scheduled') {
    if (!input.scheduledDeliveryAt) return { ok: false, message: 'נא לבחור מועד משלוח' }
    const when = new Date(input.scheduledDeliveryAt)
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      return { ok: false, message: 'מועד המשלוח חייב להיות בעתיד' }
    }
    scheduledDeliveryAt = when.toISOString()
  }

  const isAnonymous = input.sendAnonymously || !input.showBuyerName
  const card = await store.createGiftCard({
    code: generateGiftCardCode(),
    publicToken: generatePublicToken(),
    currency: settings.currency,
    initialAmountMinor: input.amountMinor,
    templateId: input.templateId,
    buyerName: isAnonymous ? null : sanitizeLine(input.buyerName),
    buyerEmail: input.buyerEmail.trim(),
    buyerPhone: input.buyerPhone || null,
    buyerCompany: input.buyerCompany ? sanitizeLine(input.buyerCompany, 160) : null,
    buyerTaxId: input.buyerTaxId || null,
    wantsInvoice: input.wantsInvoice,
    isAnonymous,
    recipientName: sanitizeLine(input.recipientName),
    recipientEmail: input.recipientEmail.trim(),
    recipientPhone: input.recipientPhone || null,
    recipientLanguage: input.recipientLanguage,
    deliveryChannel: 'email',
    greeting: sanitizeGreeting(input.greeting ?? '', settings.greetingMaxLength),
    scheduledDeliveryAt,
    senderTimezone: input.senderTimezone || settings.timezone,
    expiresAt: computeExpiry(settings),
  })

  await store.attachPayment(card.id, {
    giftCardId: card.id,
    provider: env.PAYMENT_PROVIDER,
    providerPaymentId: null,
    providerCheckoutId: null,
    amountMinor: card.initialAmountMinor,
    currency: card.currency,
    status: 'pending',
  })

  const provider = getPaymentProvider()
  const base = env.APP_BASE_URL
  const session = await provider.createCheckoutSession({
    orderRef: card.id,
    amountMinor: card.initialAmountMinor,
    currency: card.currency,
    description: `${settings.businessName} — שובר מתנה ${formatMoney(card.initialAmountMinor, card.currency)}`,
    customer: { name: input.buyerName, email: input.buyerEmail, phone: input.buyerPhone || null },
    successUrl: `${base}/checkout/confirmation?ref=${card.id}`,
    cancelUrl: `${base}/checkout/cancelled?ref=${card.id}`,
    notifyUrl: `${base}/api/webhooks/payment`,
  })
  await store.setCheckoutOpened(card.id, session.checkoutId)

  await store.appendAudit({
    actorId: null,
    actorRole: 'system',
    action: 'giftcard.purchase_started',
    entityType: 'gift_card',
    entityId: card.id,
    reason: null,
    metadata: { provider: env.PAYMENT_PROVIDER, checkoutId: session.checkoutId },
  })

  return { ok: true, giftCardId: card.id, redirectUrl: session.redirectUrl }
}

/**
 * Idempotently process a VERIFIED payment event: activate exactly one card,
 * insert exactly one initial credit (both handled atomically in the store),
 * then generate a receipt and enqueue delivery. Safe to call repeatedly.
 */
export async function processVerifiedPaymentEvent(event: VerifiedPaymentEvent): Promise<void> {
  const store = getStore()
  if (event.status !== 'paid') {
    // Record non-paid outcomes; do not activate.
    await store.appendAudit({
      actorId: null,
      actorRole: 'system',
      action: 'payment.event',
      entityType: 'gift_card',
      entityId: event.orderRef,
      reason: `status=${event.status}`,
      metadata: { eventId: event.eventId },
    })
    return
  }

  const result = await store.activateFromPayment({
    eventId: event.eventId,
    orderRef: event.orderRef,
    providerPaymentId: event.providerPaymentId,
    provider: event.provider,
    amountMinor: event.amountMinor,
    currency: event.currency,
    rawEvent: event.raw,
  })

  // Only run post-activation side-effects the first time (idempotent).
  if (result.code !== 'activated' || !result.giftCard) return
  const card = result.giftCard

  // Receipt (accounting document). Failure is logged, not fatal.
  try {
    const receipt = await getReceiptProvider().createReceipt({
      orderRef: card.id,
      amountMinor: card.initialAmountMinor,
      currency: card.currency,
      customerName: card.buyerName ?? 'Anonymous',
      customerEmail: card.buyerEmail,
      customerTaxId: card.buyerTaxId,
      wantsInvoice: card.wantsInvoice,
      paymentReference: event.providerPaymentId,
      description: `Gift card ${card.code}`,
    })
    await store.appendAudit({
      actorId: null,
      actorRole: 'system',
      // Providers that catch their own errors return status:'failed' + error
      // (rather than throwing). Record the reason so it's visible in /admin.
      action: receipt.status === 'issued' ? 'receipt.issued' : 'receipt.failed',
      entityType: 'gift_card',
      entityId: card.id,
      reason: receipt.error ?? null,
      metadata: {
        provider: receipt.provider,
        documentNumber: receipt.documentNumber,
        documentType: receipt.documentType,
        status: receipt.status,
        error: receipt.error ?? null,
      },
    })
    // Buyer confirmation email.
    await sendBuyerConfirmation(card, receipt.documentNumber)
  } catch (err) {
    await store.appendAudit({
      actorId: null,
      actorRole: 'system',
      action: 'receipt.failed',
      entityType: 'gift_card',
      entityId: card.id,
      reason: err instanceof Error ? err.message : 'unknown',
      metadata: {},
    })
  }

  // Enqueue recipient delivery (immediate or scheduled).
  await store.createDeliveryJob(card.id, 'email', card.scheduledDeliveryAt)
  if (!card.scheduledDeliveryAt) {
    // Process immediately for a snappy dev experience; safe + idempotent.
    await deliverDueJobs(new Date().toISOString(), 5)
  }
}

async function sendBuyerConfirmation(card: GiftCard, receiptNumber: string | null): Promise<void> {
  const settings = await getStore().getSettings()
  const business = {
    name: settings.businessName,
    address: settings.storeAddress,
    phone: settings.businessPhone,
    email: settings.businessEmail,
  }
  const mail = renderBuyerConfirmationEmail(card, business, receiptNumber)
  await getEmailProvider().send({
    to: card.buyerEmail,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    idempotencyKey: `buyer-confirm:${card.id}`,
  })
}

/** Claim + deliver due delivery jobs. Called on activation and by the cron worker. */
export async function deliverDueJobs(now: string, limit: number): Promise<{ processed: number }> {
  const store = getStore()
  const env = serverEnv()
  const settings = await store.getSettings()
  const business = {
    name: settings.businessName,
    address: settings.storeAddress,
    phone: settings.businessPhone,
    email: settings.businessEmail,
  }
  const jobs = await store.claimDueDeliveryJobs(now, limit)
  let processed = 0
  for (const job of jobs) {
    const card = await store.getGiftCardById(job.giftCardId)
    if (!card) {
      await store.markDeliveryResult(job.id, 'failed', null, 'gift card not found')
      continue
    }
    try {
      if (job.channel !== 'email') {
        await store.markDeliveryResult(job.id, 'failed', null, 'channel not supported in MVP')
        continue
      }
      const mail = renderRecipientEmail(card, env.APP_BASE_URL, business)
      let pdf: Uint8Array | null = null
      try {
        const template = (await store.getTemplate(card.templateId))!
        pdf = await generateGiftCardPdf(card, template, env.APP_BASE_URL)
      } catch {
        pdf = null
      }
      const res = await getEmailProvider().send({
        to: card.recipientEmail,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        idempotencyKey: `recipient:${card.id}`,
        attachments: pdf ? [{ filename: `gift-card-${card.code}.pdf`, content: pdf, contentType: 'application/pdf' }] : undefined,
      })
      await store.markDeliveryResult(job.id, 'delivered', res.providerMessageId, null)
      await store.appendAudit({
        actorId: null,
        actorRole: 'system',
        action: 'delivery.sent',
        entityType: 'gift_card',
        entityId: card.id,
        reason: null,
        metadata: { jobId: job.id, provider: res.provider },
      })
      processed++
    } catch (err) {
      await store.markDeliveryResult(job.id, 'failed', null, err instanceof Error ? err.message : 'unknown')
      await store.appendAudit({
        actorId: null,
        actorRole: 'system',
        action: 'delivery.failed',
        entityType: 'gift_card',
        entityId: card.id,
        reason: err instanceof Error ? err.message : 'unknown',
        metadata: { jobId: job.id, attempts: job.attempts },
      })
    }
  }
  return { processed }
}

/** Manually (re)send a card's recipient email — admin action. */
export async function resendGiftCard(giftCardId: string): Promise<{ ok: boolean; message?: string }> {
  const store = getStore()
  const card = await store.getGiftCardById(giftCardId)
  if (!card) return { ok: false, message: 'gift card not found' }
  await store.createDeliveryJob(giftCardId, 'email', null)
  const { processed } = await deliverDueJobs(new Date().toISOString(), 5)
  return { ok: processed > 0, message: processed > 0 ? undefined : 'no job processed' }
}

export async function redeemGiftCard(input: RedeemInput): Promise<RedeemResult> {
  return getStore().redeem(input)
}

/** Public, PII-minimized view for the recipient page. */
export interface PublicGiftCardView {
  status: GiftCard['status']
  recipientName: string
  senderName: string | null
  greeting: string
  initialAmountMinor: number
  balanceMinor: number
  currency: GiftCard['currency']
  code: string
  publicToken: string
  issuedAt: string | null
  expiresAt: string | null
  language: GiftCard['recipientLanguage']
  templateId: string
  qrUrl: string
}

export async function getPublicView(token: string): Promise<PublicGiftCardView | null> {
  const store = getStore()
  const env = serverEnv()
  const card = await store.getGiftCardByToken(token)
  if (!card) return null
  // Superseded (reissued) cards expose no value.
  return {
    status: card.status,
    recipientName: card.recipientName,
    senderName: card.isAnonymous ? null : card.buyerName,
    greeting: card.greeting,
    initialAmountMinor: card.initialAmountMinor,
    balanceMinor: card.balanceMinor,
    currency: card.currency,
    code: card.code,
    publicToken: card.publicToken,
    issuedAt: card.issuedAt,
    expiresAt: card.expiresAt,
    language: card.recipientLanguage,
    templateId: card.templateId,
    qrUrl: recipientUrl(env.APP_BASE_URL, card.publicToken),
  }
}
