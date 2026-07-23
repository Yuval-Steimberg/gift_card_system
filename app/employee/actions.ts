'use server'

import { redirect } from 'next/navigation'
import { login, logout, getCurrentUser } from '@/lib/auth/session'
import { assertPermission } from '@/lib/auth/guards'
import { getStore } from '@/lib/data'
import { redeemGiftCard } from '@/lib/gift-cards/service'
import { normalizeGiftCardCode, isValidGiftCardCode } from '@/lib/gift-cards/codes'
import { redeemInputSchema } from '@/lib/validation/redeem'
import { rateLimit } from '@/lib/security/rate-limit'
import { formatMoney } from '@/lib/money'
import { REDEEMABLE_STATUSES } from '@/lib/gift-cards/types'
import { STATUS_LABEL_HE } from '@/lib/gift-cards/status'

export async function loginEmployee(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const res = await login(email, password)
  if (!res.ok) return { error: res.message }
  redirect('/employee')
}

export async function logoutEmployee(): Promise<void> {
  logout()
  redirect('/employee/login')
}

export interface LookupResult {
  found: boolean
  message?: string
  card?: {
    id: string
    code: string
    status: string
    statusLabel: string
    redeemable: boolean
    balanceMinor: number
    balanceLabel: string
    initialLabel: string
    recipientName: string
    expiresAt: string | null
  }
}

/** Look up a card by code or public token for the redemption screen. */
export async function lookupCard(rawCode: string): Promise<LookupResult> {
  const user = await getCurrentUser()
  if (!user) return { found: false, message: 'נדרשת התחברות' }
  // Rate-limit + log repeated invalid attempts per employee.
  const rl = rateLimit(`lookup:${user.id}`, 40, 60_000)
  if (!rl.allowed) return { found: false, message: 'יותר מדי ניסיונות. המתן/י רגע.' }

  const store = getStore()
  const trimmed = rawCode.trim()
  let card = null
  if (isValidGiftCardCode(trimmed)) {
    card = await store.getGiftCardByCode(normalizeGiftCardCode(trimmed))
  }
  if (!card) card = await store.getGiftCardByToken(trimmed) // QR encodes a URL/token
  if (!card) {
    // Try to extract a token from a scanned URL.
    const m = trimmed.match(/\/gift\/([^/?#]+)/)
    if (m) card = await store.getGiftCardByToken(m[1]!)
  }
  if (!card) {
    await store.appendAudit({
      actorId: user.id,
      actorRole: user.role,
      action: 'redemption.lookup_miss',
      entityType: 'gift_card',
      entityId: 'unknown',
      reason: null,
      metadata: { input: trimmed.slice(0, 40) },
    })
    return { found: false, message: 'שובר לא נמצא' }
  }

  const expired = card.expiresAt ? new Date(card.expiresAt).getTime() <= Date.now() : false
  const redeemable = REDEEMABLE_STATUSES.includes(card.status) && !expired
  return {
    found: true,
    card: {
      id: card.id,
      code: card.code,
      status: expired ? 'expired' : card.status,
      statusLabel: expired ? STATUS_LABEL_HE.expired : STATUS_LABEL_HE[card.status],
      redeemable,
      balanceMinor: card.balanceMinor,
      balanceLabel: formatMoney(card.balanceMinor, card.currency),
      initialLabel: formatMoney(card.initialAmountMinor, card.currency),
      recipientName: card.recipientName,
      expiresAt: card.expiresAt,
    },
  }
}

export interface RedeemResponse {
  ok: boolean
  code: string
  message?: string
  balanceLabel?: string
  statusLabel?: string
}

/** Perform an atomic redemption. Idempotency key prevents double-submit. */
export async function performRedemption(input: {
  giftCardId: string
  amountMinor: number
  idempotencyKey: string
  saleReference?: string
  note?: string
}): Promise<RedeemResponse> {
  let user
  try {
    user = await assertPermission('redemption:perform')
  } catch {
    return { ok: false, code: 'forbidden', message: 'אין הרשאה לפדיון' }
  }
  const parsed = redeemInputSchema.safeParse({ ...input, code: undefined })
  if (!parsed.success) {
    return { ok: false, code: 'invalid', message: parsed.error.issues[0]?.message ?? 'קלט לא תקין' }
  }

  const result = await redeemGiftCard({
    giftCardId: input.giftCardId,
    amountMinor: input.amountMinor,
    employeeId: user.id,
    storeLocationId: user.storeLocationId,
    idempotencyKey: input.idempotencyKey,
    saleReference: input.saleReference || null,
    note: input.note || null,
    metadata: { via: 'employee_console' },
  })

  const store = getStore()
  const card = await store.getGiftCardById(input.giftCardId)
  const messages: Record<string, string> = {
    ok: 'הפדיון בוצע בהצלחה',
    duplicate: 'הבקשה כבר עובדה (לא בוצע חיוב כפול)',
    not_found: 'שובר לא נמצא',
    not_redeemable: 'לא ניתן לממש שובר זה',
    expired: 'השובר פג תוקף',
    insufficient_balance: 'אין יתרה מספקת',
    invalid_amount: 'סכום לא תקין',
  }
  return {
    ok: result.code === 'ok' || result.code === 'duplicate',
    code: result.code,
    message: messages[result.code] ?? 'שגיאה',
    balanceLabel: card ? formatMoney(card.balanceMinor, card.currency) : undefined,
    statusLabel: card ? STATUS_LABEL_HE[card.status] : undefined,
  }
}
