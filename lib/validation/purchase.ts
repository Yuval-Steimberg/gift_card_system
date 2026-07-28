import { z } from 'zod'
import { checkEmail } from './email'

/**
 * Shared purchase validation. Used on the client for UX and re-run on the
 * server for every sensitive action (never trust the client). Amount bounds are
 * additionally checked against system settings server-side.
 */

// Strict email: syntax + provider-typo detection (see lib/validation/email.ts).
// Domain deliverability (MX/A) is checked async in the purchase action.
const emailSchema = z
  .string()
  .trim()
  .max(254)
  .superRefine((v, ctx) => {
    const r = checkEmail(v)
    if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error ?? 'כתובת אימייל לא תקינה' })
  })

/** Matches a real full name: first + last, Hebrew/Latin letters only (plus
 * space, hyphen, apostrophe, period) — NO digits or symbols. Grow rejects
 * anything else on `pageFieldSettings[fullName]` (HTTP 427). */
const FULL_NAME_RE = /^\p{L}+(?:[\s'’.\-]\p{L}+)+$/u
export function isFullName(v: string): boolean {
  return FULL_NAME_RE.test(v.trim().replace(/\s+/g, ' '))
}

/** Required full name (first + last), used for both buyer and recipient. */
const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'נא להזין שם מלא')
  .max(120)
  .transform((v) => v.replace(/\s+/g, ' '))
  .refine((v) => FULL_NAME_RE.test(v), 'נא להזין שם פרטי ושם משפחה (אותיות בלבד, ללא מספרים)')

/** Required Israeli mobile — normalizes then validates (9–10 digits). */
const requiredIsraeliPhone = z
  .string()
  .trim()
  .min(1, 'נא להזין מספר טלפון')
  .refine((v) => normalizeIsraeliPhone(v) !== null, 'מספר טלפון ישראלי לא תקין (למשל 0501234567)')

/** Israeli phone normalization mirrored from the reference site. */
export function normalizeIsraeliPhone(raw: string): string | null {
  let phone = raw.replace(/\D+/g, '')
  if (phone.startsWith('972')) phone = '0' + phone.slice(3)
  if (phone.length === 9 && !phone.startsWith('0')) phone = '0' + phone
  if (!phone || phone.length < 9 || phone.length > 10) return null
  return phone
}

export const purchaseInputSchema = z.object({
  amountMinor: z.number().int().positive(),
  templateId: z.string().min(1, 'נא לבחור עיצוב'),

  // Full name (first + last, letters only) — Grow rejects anything else (427).
  buyerName: fullNameSchema,
  buyerEmail: emailSchema,
  // Required + valid Israeli number: the Grow payment provider rejects missing/
  // invalid phones (surfaces as a cryptic "Scenario failed to complete").
  buyerPhone: requiredIsraeliPhone,
  buyerCompany: z.string().trim().max(160).optional().default(''),
  buyerTaxId: z.string().trim().max(40).optional().default(''),
  wantsInvoice: z.boolean().default(false),
  showBuyerName: z.boolean().default(true),
  sendAnonymously: z.boolean().default(false),

  recipientName: fullNameSchema,
  recipientEmail: emailSchema,
  // Recipient phone is now REQUIRED (business decision — see purchase-wizard).
  recipientPhone: requiredIsraeliPhone,
  recipientLanguage: z.enum(['he', 'en']).default('he'),
  deliveryChannel: z.enum(['email']).default('email'), // MVP: email only

  greeting: z.string().max(1000).optional().default(''),

  deliveryTiming: z.enum(['immediate', 'scheduled']).default('immediate'),
  scheduledDeliveryAt: z.string().datetime({ offset: true }).nullable().optional(),
  senderTimezone: z.string().default('Asia/Jerusalem'),

  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'יש לאשר את תנאי השימוש' }),
  }),
})

export type PurchaseInput = z.infer<typeof purchaseInputSchema>

/** Server-side amount policy check against settings. */
export function validateAmountAgainstSettings(
  amountMinor: number,
  settings: { minAmountMinor: number; maxAmountMinor: number; presetAmountsMinor: number[]; allowCustomAmount: boolean },
): { ok: true } | { ok: false; message: string } {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return { ok: false, message: 'סכום לא תקין' }
  const isPreset = settings.presetAmountsMinor.includes(amountMinor)
  if (!isPreset && !settings.allowCustomAmount) return { ok: false, message: 'סכום מותאם אישית אינו מותר' }
  if (amountMinor < settings.minAmountMinor) return { ok: false, message: 'הסכום נמוך מהמינימום המותר' }
  if (amountMinor > settings.maxAmountMinor) return { ok: false, message: 'הסכום גבוה מהמקסימום המותר' }
  return { ok: true }
}
