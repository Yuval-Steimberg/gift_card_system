import QRCode from 'qrcode'

/**
 * QR content is ALWAYS an opaque HTTPS URL to the recipient page (which is
 * gated by the long random public token). It never contains DB ids, balance,
 * PII, or payment data — see docs/redemption-security.md.
 */
export function recipientUrl(baseUrl: string, publicToken: string): string {
  return `${baseUrl.replace(/\/$/, '')}/gift/${publicToken}`
}

export async function qrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 6,
    color: { dark: '#333D36', light: '#FFFCF5' },
  })
}

/** PNG bytes for embedding in PDFs / attachments. */
export async function qrPngBuffer(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 8,
    color: { dark: '#333D36', light: '#FFFFFF' },
  })
}
