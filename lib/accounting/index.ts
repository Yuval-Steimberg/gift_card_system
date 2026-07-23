import 'server-only'
import { serverEnv } from '@/lib/env'
import { MockReceiptProvider } from './mock'
import { GreenInvoiceReceiptProvider } from './greeninvoice'
import type { ReceiptProvider } from './types'

let instance: ReceiptProvider | null = null

export function getReceiptProvider(): ReceiptProvider {
  if (instance) return instance
  const env = serverEnv()
  if (env.RECEIPT_PROVIDER === 'greeninvoice') {
    if (!env.GREENINVOICE_API_KEY) {
      throw new Error('GREENINVOICE_API_KEY is required when RECEIPT_PROVIDER=greeninvoice.')
    }
    instance = new GreenInvoiceReceiptProvider(env.GREENINVOICE_API_KEY, env.GREENINVOICE_API_SECRET ?? '')
  } else {
    instance = new MockReceiptProvider()
  }
  return instance
}

export function _resetReceiptProvider(): void {
  instance = null
}

export * from './types'
