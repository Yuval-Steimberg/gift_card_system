import type { EmailMessage, EmailProvider, EmailSendResult } from './types'

/**
 * Resend adapter. UNVERIFIED against a live account — confirm the sending
 * domain is verified in Resend before enabling (EMAIL_PROVIDER=resend).
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend'
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: (message.attachments ?? []).map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content).toString('base64'),
        })),
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Resend send failed (${res.status}): ${detail}`)
    }
    const data = (await res.json()) as { id?: string }
    return { providerMessageId: data.id ?? 'unknown', provider: this.name }
  }
}
