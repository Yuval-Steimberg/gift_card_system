import 'server-only'
import { serverEnv } from '@/lib/env'
import { MockPaymentProvider } from './mock'
import { GrowPaymentProvider } from './grow'
import type { PaymentProvider } from './types'

let instance: PaymentProvider | null = null

/** Resolve the configured payment provider (singleton). */
export function getPaymentProvider(): PaymentProvider {
  if (instance) return instance
  const env = serverEnv()
  if (env.PAYMENT_PROVIDER === 'grow') {
    // Two supported modes (same as the JAS website): Make.com scenario, or the
    // direct Grow REST API. Require credentials for at least one.
    const hasMake = Boolean(env.MAKE_WEBHOOK_URL)
    const hasDirect = Boolean(env.GROW_API_KEY && env.GROW_API_SECRET)
    if (!hasMake && !hasDirect) {
      throw new Error(
        'PAYMENT_PROVIDER=grow requires MAKE_WEBHOOK_URL (Make.com path) or ' +
          'GROW_API_KEY + GROW_API_SECRET (direct Grow API).',
      )
    }
    instance = new GrowPaymentProvider({
      apiUrl: env.GROW_API_URL ?? 'https://restapi.grow.link',
      apiKey: env.GROW_API_KEY ?? '',
      apiSecret: env.GROW_API_SECRET ?? '',
      pageCode: env.GROW_PAGE_CODE ?? '1',
      makeWebhookUrl: env.MAKE_WEBHOOK_URL,
      webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
    })
  } else {
    instance = new MockPaymentProvider(env.PAYMENT_WEBHOOK_SECRET)
  }
  return instance
}

/** Test helper to reset the singleton. */
export function _resetPaymentProvider(): void {
  instance = null
}

export * from './types'
