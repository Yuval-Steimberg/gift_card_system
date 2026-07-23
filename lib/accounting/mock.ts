import { randomUUID } from 'node:crypto'
import type { CreateReceiptInput, ReceiptProvider, ReceiptResult } from './types'

/**
 * Mock receipt provider for local dev/tests. Produces a plausible document
 * number and a null URL.
 *
 * IMPORTANT: This does NOT constitute accounting compliance. The correct
 * Israeli accounting treatment for a gift-card sale (receipt at purchase vs.
 * tax invoice at redemption, deposit receipt, etc.) MUST be confirmed with the
 * business's accountant. See docs/production-checklist.md.
 */
export class MockReceiptProvider implements ReceiptProvider {
  readonly name = 'mock'

  async createReceipt(input: CreateReceiptInput): Promise<ReceiptResult> {
    const documentType = input.wantsInvoice ? 'tax_invoice' : 'receipt'
    return {
      provider: this.name,
      documentType,
      documentNumber: `MOCK-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
      documentUrl: null,
      status: 'issued',
      issuedAt: new Date().toISOString(),
    }
  }
}
