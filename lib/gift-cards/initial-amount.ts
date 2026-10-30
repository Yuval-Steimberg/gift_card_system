import { parseMajorToMinor } from '@/lib/money'
import type { SystemSettings } from '@/lib/data/store'

type AmountSettings = Pick<SystemSettings, 'presetAmountsMinor' | 'minAmountMinor' | 'maxAmountMinor' | 'allowCustomAmount'>

/**
 * The amount to preselect from a link such as /gift-cards?amount=200 (shekels),
 * so another site (the JAS website's shop) can link to a specific amount.
 * A preset amount is selected as a preset; any other amount is filled into the
 * custom field, only when custom amounts are on and it is within min–max.
 * Anything else returns null and the wizard keeps its usual default.
 */
export function initialAmountFromParam(
  raw: string | string[] | undefined,
  settings: AmountSettings,
): { amountMinor: number; customAmount: string } | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  if (!value || value.length > 12) return null
  const minor = parseMajorToMinor(value)
  if (minor == null || minor <= 0) return null
  if (settings.presetAmountsMinor.includes(minor)) return { amountMinor: minor, customAmount: '' }
  if (!settings.allowCustomAmount) return null
  if (minor < settings.minAmountMinor || minor > settings.maxAmountMinor) return null
  return { amountMinor: minor, customAmount: value }
}
