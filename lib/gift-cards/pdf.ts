import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { formatMoney } from '@/lib/money'
import { qrPngBuffer, recipientUrl } from './qr'
import type { GiftCard, GiftCardTemplate } from './types'

const HEBREW_FONT_PATH = path.join(process.cwd(), 'public', 'fonts', 'NotoSansHebrew-Regular.ttf')
const HEBREW_RANGE = /[֐-׿؀-ۿ]/

const brand = {
  cream: rgb(1, 0.988, 0.961),
  forest: rgb(0.2, 0.239, 0.212),
  orange: rgb(0.91, 0.51, 0.145),
  slate: rgb(0.384, 0.42, 0.396),
}

/**
 * Server-side gift-card PDF. Latin text, amounts, code, QR, and URL always
 * render. Hebrew greetings/names render as real glyphs when a Hebrew TTF is
 * present at public/fonts/NotoSansHebrew-Regular.ttf (auto-embedded via
 * fontkit); otherwise a safe ASCII fallback is used so generation never throws.
 * This is server-generated (no browser dependency).
 */
export async function generateGiftCardPdf(
  card: GiftCard,
  template: GiftCardTemplate,
  baseUrl: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold)

  let hebrewFont: PDFFont | null = null
  if (existsSync(HEBREW_FONT_PATH)) {
    try {
      const fontkit = (await import('@pdf-lib/fontkit')).default
      doc.registerFontkit(fontkit)
      hebrewFont = await doc.embedFont(readFileSync(HEBREW_FONT_PATH), { subset: true })
    } catch {
      hebrewFont = null
    }
  }

  const page = doc.addPage([595.28, 420]) // A5 landscape-ish
  const { width, height } = page.getSize()

  // Background panel in the template's colour.
  page.drawRectangle({ x: 0, y: 0, width, height, color: brand.cream })
  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, color: brand.forest, borderColor: brand.orange, borderWidth: 2 })

  const pick = (text: string): { font: PDFFont; text: string } => {
    if (hebrewFont && HEBREW_RANGE.test(text)) {
      return { font: hebrewFont, text: naiveRtl(text) }
    }
    // Latin/standard-font path: strip anything WinAnsi can't encode (₪, Hebrew…).
    return { font: helv, text: toWinAnsiSafe(text) }
  }

  const drawText = (text: string, x: number, y: number, size: number, bold = false, color = brand.cream) => {
    const p = pick(text)
    const font = p.font === helv && bold ? helvBold : p.font
    page.drawText(p.text, { x, y, size, font, color })
  }

  // Header
  drawText('JUST A SECOND', 48, height - 72, 20, true, brand.orange)
  drawText('GIFT CARD  ·  שובר מתנה', 48, height - 96, 11, false, brand.cream)

  // Amount (LTR-safe)
  drawText(formatMoney(card.balanceMinor, card.currency), 48, height - 160, 40, true, brand.cream)
  drawText(
    card.balanceMinor === card.initialAmountMinor ? 'Value' : 'Remaining balance',
    48,
    height - 180,
    10,
    false,
    rgb(0.72, 0.78, 0.72),
  )

  // Recipient + greeting
  drawText(`To / אל: ${card.isAnonymous ? '' : card.recipientName}`, 48, height - 220, 12, false, brand.cream)
  const greetingLines = wrap(card.greeting, 60).slice(0, 4)
  greetingLines.forEach((line, i) => drawText(line, 48, height - 244 - i * 16, 11, false, rgb(0.85, 0.89, 0.85)))

  // Code (LTR-safe, monospace-ish)
  drawText('Code / קוד:', 48, 92, 10, false, rgb(0.72, 0.78, 0.72))
  drawText(card.code, 48, 70, 16, true, brand.orange)

  // Expiry + URL
  const url = recipientUrl(baseUrl, card.publicToken)
  if (card.expiresAt) {
    drawText(`Valid until ${card.expiresAt.slice(0, 10)}`, 48, 48, 9, false, rgb(0.72, 0.78, 0.72))
  }

  // QR (right side)
  try {
    const png = await qrPngBuffer(url)
    const qrImage = await doc.embedPng(png)
    const qrSize = 150
    page.drawRectangle({ x: width - qrSize - 60, y: (height - qrSize) / 2 - 10, width: qrSize + 20, height: qrSize + 20, color: brand.cream, borderColor: brand.orange, borderWidth: 1 })
    page.drawImage(qrImage, { x: width - qrSize - 50, y: (height - qrSize) / 2, width: qrSize, height: qrSize })
  } catch {
    // QR embed failed; PDF still valid.
  }

  return doc.save()
}

function wrap(text: string, maxChars: number): string[] {
  const out: string[] = []
  for (const rawLine of text.split('\n')) {
    let line = rawLine
    while (line.length > maxChars) {
      out.push(line.slice(0, maxChars))
      line = line.slice(maxChars)
    }
    out.push(line)
  }
  return out
}

/** Naive per-line RTL reversal for embedded Hebrew (no full bidi shaping). */
function naiveRtl(text: string): string {
  return text
    .split('\n')
    .map((line) => [...line].reverse().join(''))
    .join('\n')
}

/**
 * Make text safe for the built-in WinAnsi standard font: map the shekel sign to
 * "ILS", drop other non-Latin-1 code points (e.g. Hebrew when no Hebrew font is
 * embedded) so pdf-lib never throws on encode.
 */
function toWinAnsiSafe(text: string): string {
  return (
    text
      .replace(/₪/g, 'ILS ')
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x00-\xFF]/g, '')
  )
}
