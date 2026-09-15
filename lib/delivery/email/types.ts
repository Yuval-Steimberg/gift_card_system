export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  /** Optional file attachments (e.g. the gift-card PDF). */
  attachments?: { filename: string; content: Buffer | Uint8Array; contentType: string }[]
  /** Correlates the send with a delivery job for idempotency/audit. */
  idempotencyKey?: string
  /**
   * Provider-side correlation keys echoed back on every delivery event
   * (SendGrid `custom_args`). Without these a bounce webhook is an anonymous
   * "some mail failed" — with them it names the exact card and job, which is
   * what turns provider telemetry into something /admin can show.
   */
  metadata?: Record<string, string>
}

export interface EmailSendResult {
  providerMessageId: string
  provider: string
}

export interface EmailProvider {
  readonly name: string
  send(message: EmailMessage): Promise<EmailSendResult>
}
