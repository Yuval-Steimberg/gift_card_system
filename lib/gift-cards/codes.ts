import { randomBytes, randomInt } from 'node:crypto'

/**
 * Two independent identifiers per card:
 *  - a human-readable `code` for manual entry (Crockford base32, checksum,
 *    non-sequential, ambiguity-free), and
 *  - a long cryptographically-random `public_token` for links/QR (opaque).
 *
 * Neither encodes DB ids, balance, or PII. The token is revocable and rotated
 * on reissue.
 */

// Crockford base32 alphabet: no I, L, O, U (ambiguous / accidental words).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_PREFIX = 'JAS'
const GROUP_LEN = 4
const GROUPS = 2 // 8 random symbols + 1 check symbol

function randomSymbols(n: number): string {
  let out = ''
  for (let i = 0; i < n; i++) out += ALPHABET[randomInt(0, ALPHABET.length)]
  return out
}

/** Mod-37 style checksum over base32 symbols, mapped back into the alphabet. */
function checksumSymbol(symbols: string): string {
  let sum = 0
  for (const ch of symbols) {
    const v = ALPHABET.indexOf(ch)
    sum = (sum * 3 + v + 7) % ALPHABET.length
  }
  return ALPHABET[sum] as string
}

/** Generate a fresh gift card code, e.g. `JAS-7F3K-QP2M-9`. */
export function generateGiftCardCode(): string {
  const body = randomSymbols(GROUP_LEN * GROUPS)
  const check = checksumSymbol(body)
  const groups: string[] = []
  for (let i = 0; i < GROUPS; i++) groups.push(body.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN))
  return `${CODE_PREFIX}-${groups.join('-')}-${check}`
}

/**
 * Normalize user input for lookup: uppercase, map ambiguous chars
 * (O->0, I/L->1), strip anything not in the alphabet or the prefix.
 */
export function normalizeGiftCardCode(input: string): string {
  const up = input
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^0-9A-Z-]/g, '')
    .replace(/-/g, '')
  // Re-attach canonical formatting when it looks like our code.
  const withoutPrefix = up.startsWith(CODE_PREFIX) ? up.slice(CODE_PREFIX.length) : up
  const symbols = withoutPrefix.split('').filter((c) => ALPHABET.includes(c))
  if (symbols.length !== GROUP_LEN * GROUPS + 1) return input.trim().toUpperCase()
  const body = symbols.slice(0, GROUP_LEN * GROUPS).join('')
  const check = symbols[GROUP_LEN * GROUPS]
  const groups: string[] = []
  for (let i = 0; i < GROUPS; i++) groups.push(body.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN))
  return `${CODE_PREFIX}-${groups.join('-')}-${check}`
}

/** Validate a code's structure + checksum (cheap pre-filter before DB lookup). */
export function isValidGiftCardCode(code: string): boolean {
  const normalized = normalizeGiftCardCode(code)
  const parts = normalized.split('-')
  if (parts.length !== GROUPS + 2) return false
  if (parts[0] !== CODE_PREFIX) return false
  const body = parts.slice(1, 1 + GROUPS).join('')
  const check = parts[parts.length - 1]
  if (body.length !== GROUP_LEN * GROUPS) return false
  if (![...body].every((c) => ALPHABET.includes(c))) return false
  return checksumSymbol(body) === check
}

/**
 * Cryptographically-secure, URL-safe public token (~256 bits). Used in the
 * recipient link and QR payload. Long enough to resist guessing/enumeration.
 */
export function generatePublicToken(): string {
  return randomBytes(32).toString('base64url')
}
