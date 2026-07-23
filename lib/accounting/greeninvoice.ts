import type { CreateReceiptInput, ReceiptProvider, ReceiptResult } from './types'

/**
 * Green Invoice / Morning (morning.co.il) adapter — STUB.
 *
 * Structured so the accounting behavior can be adapted without rewriting the
 * gift-card system. The exact document type + tax treatment must be confirmed
 * with the business's accountant before enabling. Left intentionally minimal;
 * flesh out `createReceipt` against the Green Invoice API once confirmed.
 */
export class GreenInvoiceReceiptProvider implements ReceiptProvider {
  readonly name = 'greeninvoice'
  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  async createReceipt(_input: CreateReceiptInput): Promise<ReceiptResult> {
    // Deliberately not implemented against a live account yet.
    return {
      provider: this.name,
      documentType: 'receipt',
      documentNumber: '',
      documentUrl: null,
      status: 'pending',
      issuedAt: new Date().toISOString(),
      error: 'greeninvoice adapter not yet implemented — confirm tax treatment with accountant',
    }
  }
}
