/**
 * SendGrid Event Webhook payload → our domain events.
 *
 * WHY THIS EXISTS: `SendGridEmailProvider.send()` returning 202 means SendGrid
 * ACCEPTED the message, never that a human received it. Bounces, blocks and
 * spam drops all happen AFTER that 202 and are reported only here. Without this
 * endpoint a corporate mail server silently binning every card looks exactly
 * like success — which is precisely how a batch of paid cards can "arrive"
 * according to our database and reach nobody.
 *
 * Pure parsing, no I/O, so it is unit-testable against real payloads.
 */

/** What the provider told us happened to one message. */
export type EmailDeliveryOutcome =
  /** The receiving server accepted it. The closest thing to proof of delivery. */
  | 'delivered'
  /** Permanently rejected (hard bounce, blocked sender, recipient marked spam).
   *  Retrying the same address is pointless and hurts sender reputation — a
   *  human has to fix the address or get the sender allow-listed. */
  | 'rejected'
  /** Temporarily deferred by the receiver. SendGrid keeps retrying; we wait. */
  | 'deferred'
  /** Engagement/queue noise (processed, open, click, …). Ignored. */
  | 'ignored'

export interface EmailProviderEvent {
  outcome: EmailDeliveryOutcome
  /** Raw provider event name, kept for the audit trail. */
  event: string
  /** Our delivery job id, echoed via custom_args. The reliable correlation. */
  jobId: string | null
  /** Our gift card id, echoed via custom_args. */
  giftCardId: string | null
  /** SendGrid's message id, reduced to the `X-Message-Id` our send returned. */
  messageId: string | null
  email: string
  reason: string | null
  occurredAt: string
}

/** SendGrid's `sg_message_id` is `<x-message-id>.<internal routing suffix>`;
 *  what `send()` stored is only the first segment. */
export function normalizeMessageId(sgMessageId: unknown): string | null {
  const raw = typeof sgMessageId === 'string' ? sgMessageId.trim() : ''
  if (!raw) return null
  const head = raw.split('.')[0] ?? ''
  return head || null
}

function outcomeFor(event: string): EmailDeliveryOutcome {
  switch (event) {
    case 'delivered':
      return 'delivered'
    // 'bounce' covers both hard and soft; SendGrid marks a soft bounce with
    // type:'blocked', which we treat as needing a human either way — it means
    // the receiving server refused us, not that the mailbox is busy.
    case 'bounce':
    case 'blocked':
    case 'dropped':
    case 'spamreport':
      return 'rejected'
    case 'deferred':
      return 'deferred'
    default:
      return 'ignored'
  }
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Parse one SendGrid Event Webhook POST body (a JSON array). Unknown shapes are
 * skipped rather than thrown on: this endpoint must never 4xx on a payload
 * variation, or SendGrid disables the webhook and we go blind again.
 */
export function parseEmailEvents(payload: unknown): EmailProviderEvent[] {
  if (!Array.isArray(payload)) return []
  const out: EmailProviderEvent[] = []
  for (const row of payload) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const event = asString(r.event)
    if (!event) continue
    const tsSeconds = Number(r.timestamp)
    out.push({
      outcome: outcomeFor(event),
      event,
      jobId: asString(r.jobId),
      giftCardId: asString(r.giftCardId),
      messageId: normalizeMessageId(r.sg_message_id),
      email: asString(r.email) ?? '',
      // SendGrid puts the receiving server's refusal text in `reason`, and the
      // SMTP dialogue in `response`. Either one is what a human needs to read.
      reason: asString(r.reason) ?? asString(r.response) ?? asString(r.type),
      occurredAt: Number.isFinite(tsSeconds) ? new Date(tsSeconds * 1000).toISOString() : new Date().toISOString(),
    })
  }
  return out
}
