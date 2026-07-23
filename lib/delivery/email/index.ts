import 'server-only'
import { serverEnv } from '@/lib/env'
import { LogEmailProvider } from './log'
import { ResendEmailProvider } from './resend'
import type { EmailProvider } from './types'

let instance: EmailProvider | null = null

export function getEmailProvider(): EmailProvider {
  if (instance) return instance
  const env = serverEnv()
  if (env.EMAIL_PROVIDER === 'resend') {
    instance = new ResendEmailProvider(env.RESEND_API_KEY!, env.EMAIL_FROM)
  } else {
    instance = new LogEmailProvider()
  }
  return instance
}

export function _resetEmailProvider(): void {
  instance = null
}

export * from './types'
