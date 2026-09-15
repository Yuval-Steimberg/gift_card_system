import 'server-only'
import { createPublicKey, createVerify, timingSafeEqual } from 'node:crypto'

/**
 * Verify SendGrid's Signed Event Webhook (ECDSA P-256 over
 * `timestamp + rawBody`, DER signature, base64 SPKI public key).
 *
 * Same principle as the payment webhook: anything that changes our records has
 * to be proven, not assumed. A forged bounce would let anyone mark a real
 * customer's card as undelivered.
 */
export const SENDGRID_SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature'
export const SENDGRID_TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp'

/** Reject a replayed payload older than this (SendGrid retries within minutes). */
const MAX_SKEW_MS = 10 * 60 * 1000

export function verifySendGridSignature(args: {
  publicKeyBase64: string
  signatureBase64: string | null
  timestamp: string | null
  rawBody: string
  now?: number
}): { ok: true } | { ok: false; reason: string } {
  const { publicKeyBase64, signatureBase64, timestamp, rawBody } = args
  if (!signatureBase64 || !timestamp) return { ok: false, reason: 'missing_signature_headers' }

  const tsSeconds = Number(timestamp)
  if (!Number.isFinite(tsSeconds)) return { ok: false, reason: 'bad_timestamp' }
  const skew = Math.abs((args.now ?? Date.now()) - tsSeconds * 1000)
  if (skew > MAX_SKEW_MS) return { ok: false, reason: 'stale_timestamp' }

  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    })
    const verifier = createVerify('sha256')
    verifier.update(timestamp + rawBody)
    verifier.end()
    const signature = Buffer.from(signatureBase64, 'base64')
    if (signature.length === 0) return { ok: false, reason: 'empty_signature' }
    return verifier.verify(key, signature) ? { ok: true } : { ok: false, reason: 'invalid_signature' }
  } catch {
    return { ok: false, reason: 'verification_error' }
  }
}

/** Constant-time compare for the shared-secret fallback (Basic-auth style). */
export function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
