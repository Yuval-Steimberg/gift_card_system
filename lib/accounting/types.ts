import type { Currency, Minor } from '@/lib/money'

export interface CreateReceiptInput {
  /** Our gift card / order reference. */
  orderRef: string
  amountMinor: Minor
  currency: Currency
  customerName: string
  customerEmail: string
  customerTaxId?: string | null
  /** Whether the buyer requested a business invoice vs. a simple receipt. */
  wantsInvoice: boolean
  paymentReference: string
  description: string
}

export type AccountingDocumentType = 'receipt' | 'tax_invoice' | 'invoice_receipt' | 'deposit_receipt'

export interface ReceiptResult {
  provider: string
  documentType: AccountingDocumentType
  documentNumber: string
  documentUrl: string | null
  status: 'issued' | 'pending' | 'failed'
  issuedAt: string
  error?: string
}

export interface ReceiptProvider {
  readonly name: string
  createReceipt(input: CreateReceiptInput): Promise<ReceiptResult>
}
