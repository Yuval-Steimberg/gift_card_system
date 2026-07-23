import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { EmailMessage, EmailProvider, EmailSendResult } from './types'

/**
 * Development email adapter: no external calls. Writes an HTML preview to
 * `.mail/` and logs a summary so developers can inspect exactly what a
 * recipient/buyer would receive without any credentials.
 */
export class LogEmailProvider implements EmailProvider {
  readonly name = 'log'
  private readonly dir: string
  constructor(dir = path.join(process.cwd(), '.mail')) {
    this.dir = dir
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const id = `log_${randomUUID()}`
    try {
      await mkdir(this.dir, { recursive: true })
      const safeTo = message.to.replace(/[^a-z0-9@._-]/gi, '_')
      const file = path.join(this.dir, `${Date.now()}_${safeTo}.html`)
      await writeFile(file, message.html, 'utf8')
      for (const att of message.attachments ?? []) {
        await writeFile(path.join(this.dir, `${id}_${att.filename}`), att.content)
      }
      // eslint-disable-next-line no-console
      console.info(`[email:log] to=${message.to} subject="${message.subject}" preview=${file}`)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.info(`[email:log] to=${message.to} subject="${message.subject}" (preview write failed)`, err)
    }
    return { providerMessageId: id, provider: this.name }
  }
}
