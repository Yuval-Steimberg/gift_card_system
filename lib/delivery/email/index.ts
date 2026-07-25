import 'server-only'
import { serverEnv } from '@/lib/env'
import { LogEmailProvider } from './log'
import { ResendEmailProvider } from './resend'
import { SendGridEmailProvider } from './sendgrid'
import type { EmailProvider } from './types'

let instance: EmailProvider | null = null

export function getEmailProvider(): EmailProvider {
  if (instance) return instance
  const env = serverEnv()
  if (env.EMAIL_PROVIDER === 'sendgrid') {
    if (!env.SENDGRID_API_KEY) {
      throw new Error('SENDGRID_API_KEY is required when EMAIL_PROVIDER=sendgrid (or set EMAIL_PROVIDER=log).')
    }
    instance = new SendGridEmailProvider(env.SENDGRID_API_KEY, env.EMAIL_FROM)
  } else if (env.EMAIL_PROVIDER === 'resend') {
    if (!env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend (or set EMAIL_PROVIDER=log).')
    }
    instance = new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM)
  } else {
    instance = new LogEmailProvider()
  }
  return instance
}

export function _resetEmailProvider(): void {
  instance = null
}

export * from './types'
