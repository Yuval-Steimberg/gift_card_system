import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Webhook authenticity: every incoming payment webhook MUST be verified with
 * an HMAC-SHA256 signature over the raw request body before we act on it. This
 * is the single most important fix over the reference site, whose webhook
 * accepted any POST (see docs/just-website-repository-audit.md §7).
 */

export interface VerifyResult {
  ok: boolean
  reason?: string
}

/** Compute the hex HMAC-SHA256 signature of a raw body with a secret. */
export function signBody(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

/**
 * Constant-time verification of a provider signature header against the raw
 * body. Accepts an optional `sha256=` prefix (common convention).
 */
export function verifySignature(rawBody: string, signature: string | null, secret: string): VerifyResult {
  if (!signature) return { ok: false, reason: 'missing_signature' }
  if (!secret) return { ok: false, reason: 'missing_secret' }
  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature
  const expected = signBody(rawBody, secret)
  // Length check first — timingSafeEqual throws on unequal lengths.
  if (provided.length !== expected.length) return { ok: false, reason: 'signature_mismatch' }
  const a = Buffer.from(provided, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return { ok: false, reason: 'signature_mismatch' }
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'signature_mismatch' }
}
