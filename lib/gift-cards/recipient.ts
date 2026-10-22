import 'server-only'
import { getStore } from '@/lib/data'
import { resendGiftCard } from '@/lib/gift-cards/service'
import { checkEmail } from '@/lib/validation/email'
import { isFullName, normalizeIsraeliPhone } from '@/lib/validation/purchase'

export interface RecipientFields {
  recipientName?: string
  recipientEmail?: string
  recipientPhone?: string
  scheduledDeliveryAt?: string | null
}

export interface EditRecipientResult {
  ok: boolean
  message?: string
  resent?: boolean
}

/**
 * Change who a card is delivered to, then (optionally) resend. The ONE
 * implementation behind /admin's "עריכת פרטי נמען/ת" and the JAS Command
 * Center's integration endpoint, so both run the same rules.
 *
 * Validated with the same rules as checkout. Blank fields are ignored rather
 * than written, so a partially filled form cannot wipe a recipient's details.
 * The caller has already checked who is allowed to do this.
 */
export async function editRecipient(
  id: string,
  fields: RecipientFields,
  actor: { actorId: string | null; actorRole: string; reason: string },
  options: { resend?: boolean } = {},
): Promise<EditRecipientResult> {
  if (actor.reason.trim().length < 3) return { ok: false, message: 'נא לפרט סיבה (נשמרת ביומן הביקורת)' }

  const patch: RecipientFields = {}

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
    // actorId is a profiles uuid or null (the command center is not a profile).
    await getStore().updateGiftCardFields(id, patch, actor)
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'שגיאה בעדכון פרטי הנמען/ת' }
  }

  // Resend AFTER the update committed, so the card goes to the new address.
  if (!options.resend) return { ok: true, resent: false }
  const res = await resendGiftCard(id)
  return res.ok ? { ok: true, resent: true } : { ok: true, resent: false, message: res.message ?? 'הפרטים עודכנו, אך השליחה נכשלה' }
}
