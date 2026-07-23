export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  /** Optional file attachments (e.g. the gift-card PDF). */
  attachments?: { filename: string; content: Buffer | Uint8Array; contentType: string }[]
  /** Correlates the send with a delivery job for idempotency/audit. */
  idempotencyKey?: string
}

export interface EmailSendResult {
  providerMessageId: string
  provider: string
}

export interface EmailProvider {
  readonly name: string
  send(message: EmailMessage): Promise<EmailSendResult>
}
