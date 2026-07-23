import { z } from 'zod'

export const redeemInputSchema = z.object({
  code: z.string().trim().min(3).optional(),
  giftCardId: z.string().min(1).optional(),
  amountMinor: z.number().int().positive('סכום המימוש חייב להיות חיובי'),
  idempotencyKey: z.string().min(8),
  storeLocationId: z.string().nullable().optional(),
  saleReference: z.string().trim().max(80).optional(),
  receiptNumber: z.string().trim().max(80).optional(),
  note: z.string().trim().max(400).optional(),
})

export type RedeemFormInput = z.infer<typeof redeemInputSchema>

export const reversalInputSchema = z.object({
  redemptionId: z.string().min(1),
  reason: z.string().trim().min(3, 'נא לפרט סיבה'),
})

export const adjustmentInputSchema = z.object({
  giftCardId: z.string().min(1),
  direction: z.enum(['increase', 'decrease']),
  amountMinor: z.number().int().positive(),
  reason: z.string().trim().min(3, 'נא לפרט סיבה'),
})
