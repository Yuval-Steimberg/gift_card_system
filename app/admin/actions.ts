'use server'

import { revalidatePath } from 'next/cache'
import { assertPermission } from '@/lib/auth/guards'
import { getStore } from '@/lib/data'
import { resendGiftCard } from '@/lib/gift-cards/service'
import {
  adjustBalance,
  cancelCard,
  reactivateCard,
  refundCard,
  reissueCard,
  suspendCard,
} from '@/lib/gift-cards/admin-service'
import { parseMajorToMinor } from '@/lib/money'

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

export async function adminResend(id: string): Promise<ActionResult> {
  await assertPermission('giftcard:resend')
  const res = await resendGiftCard(id)
  revalidate(id)
  return res
}

export async function adminEditRecipient(
  id: string,
  fields: { recipientName?: string; recipientEmail?: string; recipientPhone?: string; scheduledDeliveryAt?: string | null },
  reason: string,
): Promise<ActionResult> {
  const user = await assertPermission('giftcard:edit_recipient')
  try {
    await getStore().updateGiftCardFields(id, fields, { actorId: user.id, actorRole: user.role, reason })
    revalidate(id)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'error' }
  }
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
  await getStore().updateSettings(clean, { actorId: user.id, actorRole: user.role })
  revalidatePath('/admin/settings')
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
