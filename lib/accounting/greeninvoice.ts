import { toMajor } from '@/lib/money'
import type { AccountingDocumentType, CreateReceiptInput, ReceiptProvider, ReceiptResult } from './types'

export interface GreenInvoiceConfig {
  apiUrl: string
  apiKey: string
  apiSecret: string
  /**
   * Green Invoice document `type` code. The correct code for a gift-card sale
   * MUST be confirmed with the business's accountant (see docs). Common codes:
   *   400 = קבלה (receipt) · 320 = חשבונית מס/קבלה (invoice-receipt) ·
   *   305 = חשבונית מס (tax invoice) · 300 = חשבון עסקה (proforma).
   */
  docType: number
}

const DOC_TYPE_LABEL: Record<number, AccountingDocumentType> = {
  400: 'receipt',
  320: 'invoice_receipt',
  305: 'tax_invoice',
  300: 'deposit_receipt',
}

/**
 * Green Invoice / Morning (morning.co.il) adapter — functional implementation
 * against the documented v1 API (token auth → create document). Like the Grow
 * adapter, it is written to the documented shapes but is UNVERIFIED against a
 * live account — run it in the Green Invoice **sandbox** first and confirm the
 * document `type` + VAT treatment with the accountant before enabling in prod.
 */
export class GreenInvoiceReceiptProvider implements ReceiptProvider {
  readonly name = 'greeninvoice'
  private token: { value: string; expiresAt: number } | null = null

  constructor(private readonly config: GreenInvoiceConfig) {}

  private async authenticate(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value
    const res = await fetch(`${this.config.apiUrl}/api/v1/account/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: this.config.apiKey, secret: this.config.apiSecret }),
    })
    if (!res.ok) throw new Error(`Green Invoice auth failed (${res.status})`)
    const data = (await res.json()) as { token?: string; expires?: number }
    if (!data.token) throw new Error('Green Invoice auth returned no token')
    // Tokens are short-lived; cache conservatively for ~9 minutes.
    this.token = { value: data.token, expiresAt: Date.now() + 9 * 60_000 }
    return data.token
  }

  async createReceipt(input: CreateReceiptInput): Promise<ReceiptResult> {
    const now = new Date().toISOString()
    try {
      const token = await this.authenticate()
      const amountMajor = toMajor(input.amountMinor, input.currency)
      const body = {
        type: this.config.docType,
        lang: 'he',
        currency: input.currency,
        vatType: 0,
        client: {
          name: input.customerName,
          emails: input.customerEmail ? [input.customerEmail] : [],
          taxId: input.customerTaxId ?? undefined,
        },
        income: [
          {
            description: input.description,
            quantity: 1,
            price: amountMajor,
            currency: input.currency,
            vatType: 0,
          },
        ],
        payment: [{ type: 4 /* credit card */, price: amountMajor, currency: input.currency }],
        remarks: `Gift card · ${input.orderRef} · payment ${input.paymentReference}`,
      }
      const res = await fetch(`${this.config.apiUrl}/api/v1/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        return {
          provider: this.name,
          documentType: DOC_TYPE_LABEL[this.config.docType] ?? 'receipt',
          documentNumber: '',
          documentUrl: null,
          status: 'failed',
          issuedAt: now,
          error: `Green Invoice document creation failed (${res.status}): ${detail.slice(0, 200)}`,
        }
      }
      const data = (await res.json()) as { id?: string; number?: string | number; url?: { origin?: string; he?: string } }
      return {
        provider: this.name,
        documentType: DOC_TYPE_LABEL[this.config.docType] ?? 'invoice_receipt',
        documentNumber: String(data.number ?? data.id ?? ''),
        documentUrl: data.url?.origin ?? data.url?.he ?? null,
        status: 'issued',
        issuedAt: now,
      }
    } catch (err) {
      return {
        provider: this.name,
        documentType: DOC_TYPE_LABEL[this.config.docType] ?? 'receipt',
        documentNumber: '',
        documentUrl: null,
        status: 'failed',
        issuedAt: now,
        error: err instanceof Error ? err.message : 'unknown error',
      }
    }
  }
}
