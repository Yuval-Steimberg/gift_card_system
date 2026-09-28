'use server'

import { revalidatePath } from 'next/cache'
import { assertPermission } from '@/lib/auth/guards'
import { getStore } from '@/lib/data'
import { resendGiftCard, resendAllUndelivered, processVerifiedPaymentEvent } from '@/lib/gift-cards/service'
import {
  adjustBalance,
  cancelCard,
  reactivateCard,
  refundCard,
  reissueCard,
  suspendCard,
} from '@/lib/gift-cards/admin-service'
import { parseMajorToMinor } from '@/lib/money'
import { checkEmail } from '@/lib/validation/email'
import { isFullName, normalizeIsraeliPhone } from '@/lib/validation/purchase'

type ActionResult = { ok: boolean; message?: string }

function revalidate(id: string) {
  revalidatePath(`/admin/gift-cards/${id}`)
  revalidatePath('/admin/gift-cards')
  revalidatePath('/admin')
}

/** All sensitive actions require a reason and create an audit entry (in the store). */
export async function adminSuspend(id: string, reason: string): Promise<ActionResult> {
  const user = await assertPermission('giftcard:suspend')
  const res = await suspendCard(id, { actorId: user.id, actorRole: user.role, reason })
  revalidate(id)
  return res
}

export async function adminReactivate(id: string, reason: string): Promise<ActionResult> {
  const user = await assertPermission('giftcard:suspend')
  const res = await reactivateCard(id, { actorId: user.id, actorRole: user.role, reason })
  revalidate(id)
  return res
}

export async function adminCancel(id: string, reason: string): Promise<ActionResult> {
  const user = await assertPermission('giftcard:cancel')
  const res = await cancelCard(id, { actorId: user.id, actorRole: user.role, reason })
  revalidate(id)
  return res
}

export async function adminRefund(id: string, reason: string): Promise<ActionResult> {
  const user = await assertPermission('giftcard:refund')
  const res = await refundCard(id, { actorId: user.id, actorRole: user.role, reason })
  revalidate(id)
  return res
}

export async function adminReissue(id: string, reason: string): Promise<ActionResult & { newCardId?: string }> {
  const user = await assertPermission('giftcard:reissue')
  const res = await reissueCard(id, { actorId: user.id, actorRole: user.role, reason })
  revalidate(id)
  return { ok: res.ok, message: res.message, newCardId: res.newCard?.id }
}

export async function adminAdjust(
  id: string,
  direction: 'increase' | 'decrease',
  amount: string,
  reason: string,
): Promise<ActionResult> {
  const user = await assertPermission('giftcard:adjust_balance')
  const amountMinor = parseMajorToMinor(amount)
  if (amountMinor == null || amountMinor <= 0) return { ok: false, message: 'סכום לא תקין' }
  if (reason.trim().length < 3) return { ok: false, message: 'נא לפרט סיבה' }
  const res = await adjustBalance(id, direction, amountMinor, { actorId: user.id, actorRole: user.role, reason })
  revalidate(id)
  return res
}

/**
 * Manually activate a card whose payment succeeded at the provider but whose
 * confirmation webhook never arrived (e.g. a Grow callback that didn't reach
 * us). Runs the SAME verified-activation path as a real webhook — atomic
 * activation + initial credit + receipt + delivery — using the card's own
 * authoritative amount, so the ledger invariant and idempotency are preserved.
 * Owner/finance only. Requires the operator to have confirmed the payment in
 * the Grow dashboard first; the reason is recorded in the audit log.
 */
export async function adminMarkPaid(id: string, reason: string): Promise<ActionResult> {
  const user = await assertPermission('giftcard:adjust_balance')
  const store = getStore()
  const card = await store.getGiftCardById(id)
  if (!card) return { ok: false, message: 'שובר לא נמצא' }
  if (['active', 'partially_redeemed', 'fully_redeemed'].includes(card.status)) {
    return { ok: true, message: 'השובר כבר פעיל' }
  }
  if (!['draft', 'awaiting_payment', 'payment_processing', 'failed'].includes(card.status)) {
    return { ok: false, message: `לא ניתן להפעיל שובר בסטטוס ${card.status}` }
  }
  try {
    await processVerifiedPaymentEvent({
      provider: 'manual',
      eventId: `manual_${id}_${Date.now()}`,
      orderRef: id,
      providerPaymentId: `manual_${user.id}`,
      status: 'paid',
      amountMinor: card.initialAmountMinor,
      currency: card.currency,
      raw: { manual: true, actorId: user.id, actorRole: user.role, reason: reason || null },
    })
    await store.appendAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'giftcard.manual_activate',
      entityType: 'gift_card',
      entityId: id,
      reason: reason?.trim() || 'הפעלה ידנית לאחר אימות תשלום מול הספק',
      metadata: {},
    })
    revalidate(id)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'שגיאה בהפעלה הידנית' }
  }
}

export async function adminResend(id: string): Promise<ActionResult> {
  await assertPermission('giftcard:resend')
  const res = await resendGiftCard(id)
  revalidate(id)
  return res
}

/**
 * Resend every paid card whose email never went out — one click after an
 * email-provider outage instead of opening each card. Cards the recipient's
 * server rejected are listed back, not resent (see resendAllUndelivered).
 */
export async function adminResendAllFailed(): Promise<
  ActionResult & { queued?: number; delivered?: number; rejected?: { id: string; code: string; recipientEmail: string }[] }
> {
  const user = await assertPermission('giftcard:resend')
  try {
    const res = await resendAllUndelivered()
    await getStore().appendAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'delivery.resend_all',
      entityType: 'system',
      entityId: 'delivery',
      reason: `resent ${res.delivered}/${res.queued}`,
      metadata: { queued: res.queued, delivered: res.delivered, rejected: res.rejected.length },
    })
    revalidatePath('/admin')
    revalidatePath('/admin/gift-cards')
    if (res.queued > 0 && res.delivered < res.queued) {
      return {
        ok: false,
        ...res,
        message: `נשלחו ${res.delivered} מתוך ${res.queued}. ספק המייל עדיין דוחה שליחה — בדקו את חשבון SendGrid.`,
      }
    }
    return { ok: true, ...res }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'שגיאה בשליחה החוזרת' }
  }
}

/**
 * Change who a card is delivered to, then (optionally) resend.
 *
 * This is the manual repair path when a recipient address turns out to be
 * wrong or unreachable — a corporate tenant blocking us, a typo, someone who
 * left the company. Without it the only lever is "resend", which retries the
 * exact address that just failed.
 *
 * Validated SERVER-SIDE with the same rules as checkout: the client form is a
 * convenience, never the gate. Blank fields are ignored rather than written, so
 * a partially filled form cannot wipe a recipient's details.
 */
export async function adminEditRecipient(
  id: string,
  fields: { recipientName?: string; recipientEmail?: string; recipientPhone?: string; scheduledDeliveryAt?: string | null },
  reason: string,
  options: { resend?: boolean } = {},
): Promise<ActionResult & { resent?: boolean }> {
  const user = await assertPermission('giftcard:edit_recipient')
  if (reason.trim().length < 3) return { ok: false, message: 'נא לפרט סיבה (נשמרת ביומן הביקורת)' }

  const patch: typeof fields = {}

  const name = fields.recipientName?.trim()
  if (name) {
    if (!isFullName(name)) return { ok: false, message: 'שם הנמען/ת חייב להיות שם מלא (שם פרטי ומשפחה)' }
    patch.recipientName = name
  }

  const email = fields.recipientEmail?.trim()
  if (email) {
    // Same 2 client-safe layers the checkout wizard uses (syntax + typo). The
    // DNS layer is deliberately not run here: an admin fixing a bounced address
    // should not be blocked by a transient lookup.
    const check = checkEmail(email)
    if (!check.ok) return { ok: false, message: check.error ?? 'כתובת אימייל לא תקינה' }
    patch.recipientEmail = email
  }

  const phone = fields.recipientPhone?.trim()
  if (phone) {
    const normalized = normalizeIsraeliPhone(phone)
    if (!normalized) return { ok: false, message: 'מספר טלפון נייד לא תקין' }
    patch.recipientPhone = normalized
  }

  if (fields.scheduledDeliveryAt !== undefined) patch.scheduledDeliveryAt = fields.scheduledDeliveryAt
  if (Object.keys(patch).length === 0) return { ok: false, message: 'לא הוזנו שינויים' }

  try {
    await getStore().updateGiftCardFields(id, patch, { actorId: user.id, actorRole: user.role, reason })
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'שגיאה בעדכון פרטי הנמען/ת' }
  }

  // Resend AFTER the update committed, so the card goes to the new address.
  let resent = false
  if (options.resend) {
    const res = await resendGiftCard(id)
    resent = res.ok
    if (!res.ok) {
      revalidate(id)
      return { ok: true, resent: false, message: res.message ?? 'הפרטים עודכנו, אך השליחה נכשלה' }
    }
  }
  revalidate(id)
  return { ok: true, resent }
}

export async function adminReverseRedemption(
  giftCardId: string,
  redemptionId: string,
  reason: string,
): Promise<ActionResult> {
  const user = await assertPermission('redemption:reverse')
  if (reason.trim().length < 3) return { ok: false, message: 'נא לפרט סיבה' }
  const res = await getStore().reverseRedemption({
    redemptionId,
    reason,
    requestedBy: user.id,
    approvedBy: user.id,
  })
  revalidate(giftCardId)
  return { ok: res.ok, message: res.message }
}

export async function adminAddNote(id: string, body: string): Promise<ActionResult> {
  const user = await assertPermission('giftcard:add_note')
  if (body.trim().length < 1) return { ok: false, message: 'הערה ריקה' }
  await getStore().addNote(id, body.trim(), user.id)
  revalidate(id)
  return { ok: true }
}

export async function adminUpdateSettings(patch: Record<string, unknown>): Promise<ActionResult> {
  const user = await assertPermission('settings:manage')
  const clean: Record<string, unknown> = {}
  if (typeof patch.businessName === 'string') clean.businessName = patch.businessName
  if (typeof patch.businessEmail === 'string') clean.businessEmail = patch.businessEmail
  if (typeof patch.businessPhone === 'string') clean.businessPhone = patch.businessPhone
  if (typeof patch.storeAddress === 'string') clean.storeAddress = patch.storeAddress
  if (typeof patch.allowCustomAmount === 'boolean') clean.allowCustomAmount = patch.allowCustomAmount
  if (typeof patch.allowPartialRedemption === 'boolean') clean.allowPartialRedemption = patch.allowPartialRedemption
  if (Array.isArray(patch.presetAmountsMinor)) clean.presetAmountsMinor = patch.presetAmountsMinor
  if (typeof patch.minAmountMinor === 'number') clean.minAmountMinor = patch.minAmountMinor
  if (typeof patch.maxAmountMinor === 'number') clean.maxAmountMinor = patch.maxAmountMinor
  if (patch.expiryMonths === null || typeof patch.expiryMonths === 'number') clean.expiryMonths = patch.expiryMonths
  try {
    await getStore().updateSettings(clean, { actorId: user.id, actorRole: user.role })
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'שמירת ההגדרות נכשלה' }
  }
  revalidatePath('/admin/settings')
  // Also refresh the public funnel + landing so amount limits/presets take effect there.
  revalidatePath('/gift-cards')
  revalidatePath('/')
  return { ok: true }
}

export async function adminUpsertTemplate(template: {
  id?: string
  name: string
  occasion: 'birthday' | 'holiday' | 'celebration' | 'general'
  language: 'he' | 'en'
  backgroundColor: string
  textColor: string
  accentColor: string
  isActive: boolean
  isDefault: boolean
}): Promise<ActionResult> {
  await assertPermission('template:manage')
  const store = getStore()
  const id = template.id ?? `tpl-${Date.now().toString(36)}`
  const existing = template.id ? await store.getTemplate(template.id) : null
  await store.upsertTemplate({
    id,
    name: template.name,
    occasion: template.occasion,
    language: template.language,
    coverImageUrl: existing?.coverImageUrl ?? null,
    backgroundColor: template.backgroundColor,
    textColor: template.textColor,
    accentColor: template.accentColor,
    isActive: template.isActive,
    isDefault: template.isDefault,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  })
  revalidatePath('/admin/templates')
  revalidatePath('/gift-cards')
  return { ok: true }
}
