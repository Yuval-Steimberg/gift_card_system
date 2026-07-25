import type { EmailMessage, EmailProvider, EmailSendResult } from './types'

/** Parse a "Name <email@x>" (or bare "email@x") from-string into SendGrid's shape. */
export function parseFromAddress(from: string): { email: string; name?: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (m) return { email: (m[2] ?? '').trim(), name: (m[1] ?? '').trim() || undefined }
  return { email: from.trim() }
}

/**
 * SendGrid adapter. SendGrid authenticates the sending domain with CNAME
 * records (Sender Authentication) — no MX record required — so it works with
 * DNS hosts that block subdomain MX (e.g. Wix). Enable with
 * EMAIL_PROVIDER=sendgrid + SENDGRID_API_KEY, and set EMAIL_FROM to an address
 * on the authenticated domain (e.g. "Just A Second <gifts@justasecond.co.il>").
 */
export class SendGridEmailProvider implements EmailProvider {
  readonly name = 'sendgrid'
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const body: Record<string, unknown> = {
      personalizations: [{ to: [{ email: message.to }] }],
      from: parseFromAddress(this.from),
      subject: message.subject,
      // SendGrid requires text/plain to precede text/html in the content array.
      content: [
        { type: 'text/plain', value: message.text },
        { type: 'text/html', value: message.html },
      ],
    }
    if (message.attachments?.length) {
      body.attachments = message.attachments.map((a) => ({
        content: Buffer.from(a.content).toString('base64'),
        filename: a.filename,
        type: a.contentType,
        disposition: 'attachment',
      }))
    }

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`SendGrid send failed (${res.status}): ${detail}`)
    }
    // SendGrid returns 202 Accepted with an empty body; id is in a header.
    return { providerMessageId: res.headers.get('x-message-id') ?? 'accepted', provider: this.name }
  }
}
