import { z } from 'zod'

/**
 * Shared purchase validation. Used on the client for UX and re-run on the
 * server for every sensitive action (never trust the client). Amount bounds are
 * additionally checked against system settings server-side.
 */

const emailSchema = z.string().trim().email('כתובת אימייל לא תקינה').max(254)
const nameSchema = z.string().trim().min(2, 'נא להזין שם').max(120)
const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D+/g, ''))
  .refine((v) => v === '' || (v.length >= 9 && v.length <= 12), 'מספר טלפון לא תקין')

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

  buyerName: nameSchema,
  buyerEmail: emailSchema,
  buyerPhone: phoneSchema.optional().default(''),
  buyerCompany: z.string().trim().max(160).optional().default(''),
  buyerTaxId: z.string().trim().max(40).optional().default(''),
  wantsInvoice: z.boolean().default(false),
  showBuyerName: z.boolean().default(true),
  sendAnonymously: z.boolean().default(false),

  recipientName: nameSchema,
  recipientEmail: emailSchema,
  recipientPhone: phoneSchema.optional().default(''),
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
