/**
 * Money is ALWAYS represented as an integer number of minor units (agorot for
 * ILS). ₪100 -> 10000, ₪249.90 -> 24990. Never use floating point for money.
 *
 * A `Money` is a branded integer to make it hard to accidentally pass a major
 * unit (e.g. 100) where minor units (10000) are expected.
 */
export type Currency = 'ILS'

export const DEFAULT_CURRENCY: Currency = 'ILS'
const MINOR_PER_MAJOR: Record<Currency, number> = { ILS: 100 }
const CURRENCY_SYMBOL: Record<Currency, string> = { ILS: '₪' }

export type Minor = number // integer minor units

/** Convert a major-unit amount (₪) to integer minor units (agorot). */
export function toMinor(major: number, currency: Currency = DEFAULT_CURRENCY): Minor {
  if (!Number.isFinite(major)) throw new Error('Amount is not a finite number')
  const factor = MINOR_PER_MAJOR[currency]
  // Round to the nearest minor unit to absorb binary-float noise (e.g. 24990.000001).
  return Math.round(major * factor)
}

/** Parse a user-entered string like "249.90" or "₪1,000" into minor units. */
export function parseMajorToMinor(
  input: string,
  currency: Currency = DEFAULT_CURRENCY,
): Minor | null {
  const cleaned = input.replace(/[^\d.,-]/g, '').replace(/,/g, '')
  if (cleaned === '' || cleaned === '.' || cleaned === '-') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return toMinor(value, currency)
}

/** Convert integer minor units back to a major-unit number (for display only). */
export function toMajor(minor: Minor, currency: Currency = DEFAULT_CURRENCY): number {
  return minor / MINOR_PER_MAJOR[currency]
}

/** True if a value is a valid, non-negative integer minor amount. */
export function isValidMinor(minor: unknown): minor is Minor {
  return typeof minor === 'number' && Number.isInteger(minor) && minor >= 0
}

/** Assert that an amount is a positive integer minor value. */
export function assertPositiveMinor(minor: Minor, label = 'amount'): void {
  if (!Number.isInteger(minor)) throw new Error(`${label} must be an integer (minor units)`)
  if (minor <= 0) throw new Error(`${label} must be greater than zero`)
}

/**
 * Format minor units for display. RTL-safe: the returned string should be
 * wrapped with dir="ltr"/unicode-bidi:embed in RTL contexts so it is not
 * reordered. Uses he-IL grouping.
 */
export function formatMoney(minor: Minor, currency: Currency = DEFAULT_CURRENCY): string {
  const major = toMajor(minor, currency)
  const hasFraction = minor % MINOR_PER_MAJOR[currency] !== 0
  const formatted = new Intl.NumberFormat('he-IL', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(major)
  return `${CURRENCY_SYMBOL[currency]}${formatted}`
}

export function sumMinor(values: Minor[]): Minor {
  return values.reduce((acc, v) => acc + v, 0)
}
