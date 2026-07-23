import { formatMoney } from '@/lib/money'
import { escapeHtml } from '@/lib/security/text'
import { recipientUrl } from '@/lib/gift-cards/qr'
import type { GiftCard } from '@/lib/gift-cards/types'

interface BusinessInfo {
  name: string
  address: string
  phone: string
  email: string
}

const shell = (inner: string, dir: 'rtl' | 'ltr') => `<!doctype html>
<html dir="${dir}" lang="${dir === 'rtl' ? 'he' : 'en'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#FFFCF5;font-family:Heebo,Arial,sans-serif;color:#333D36;">
<div style="max-width:560px;margin:0 auto;padding:24px;">
${inner}
<p style="font-size:12px;color:#626B65;margin-top:32px;">Just A Second · ג׳אסט א סקונד</p>
</div></body></html>`

/** Recipient email: "you've received a gift card" with link + code. */
export function renderRecipientEmail(
  card: GiftCard,
  baseUrl: string,
  business: BusinessInfo,
): { subject: string; html: string; text: string } {
  const url = recipientUrl(baseUrl, card.publicToken)
  const rtl = card.recipientLanguage === 'he'
  const amount = formatMoney(card.initialAmountMinor, card.currency)
  const sender = card.isAnonymous ? (rtl ? 'מעריך/ה חשאי/ת' : 'someone special') : card.buyerName ?? ''
  const greeting = escapeHtml(card.greeting).replace(/\n/g, '<br>')

  const subject = rtl ? `קיבלת שובר מתנה מ-Just A Second` : `You've received a Just A Second gift card`
  const heading = rtl ? `${escapeHtml(card.recipientName)}, קיבלת מתנה` : `${escapeHtml(card.recipientName)}, you've got a gift`
  const from = sender ? (rtl ? `מאת ${escapeHtml(sender)}` : `from ${escapeHtml(sender)}`) : ''
  const cta = rtl ? 'לצפייה בשובר' : 'View your gift card'
  const codeLabel = rtl ? 'קוד השובר' : 'Gift card code'

  const inner = `
<div style="background:#333D36;border-radius:16px;padding:28px;text-align:center;color:#FFFCF5;">
  <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#F4A866;">Just A Second</div>
  <h1 style="margin:12px 0 4px;font-size:24px;color:#FFFCF5;">${heading}</h1>
  <div style="color:#B5C9AD;font-size:14px;">${from}</div>
  <div style="font-size:40px;font-weight:800;margin:18px 0;color:#FFFCF5;">${amount}</div>
  ${greeting ? `<div style="background:rgba(255,255,255,.08);border-radius:12px;padding:14px;color:#ECE5D1;font-size:14px;">${greeting}</div>` : ''}
  <a href="${url}" style="display:inline-block;margin-top:22px;background:#E88225;color:#FFFCF5;text-decoration:none;padding:12px 28px;border-radius:999px;font-weight:700;">${cta}</a>
  <div style="margin-top:18px;font-size:12px;color:#B5C9AD;">${codeLabel}: <span dir="ltr" style="unicode-bidi:embed;font-weight:700;color:#FFFCF5;">${escapeHtml(card.code)}</span></div>
</div>
<p style="font-size:13px;color:#626B65;">${rtl ? 'ניתן לממש בחנות' : 'Redeemable in store'}: ${escapeHtml(business.address)}</p>`

  const text = `${heading}\n${from}\n${amount}\n\n${card.greeting}\n\n${cta}: ${url}\n${codeLabel}: ${card.code}`
  return { subject, html: shell(inner, rtl ? 'rtl' : 'ltr'), text }
}

/** Buyer confirmation email: receipt + what happens next. */
export function renderBuyerConfirmationEmail(
  card: GiftCard,
  business: BusinessInfo,
  receiptNumber: string | null,
): { subject: string; html: string; text: string } {
  const amount = formatMoney(card.initialAmountMinor, card.currency)
  const subject = `אישור רכישה · שובר מתנה ${amount}`
  const inner = `
<h1 style="font-size:22px;">תודה על הרכישה</h1>
<p style="font-size:14px;color:#626B65;">רכשת שובר מתנה בסך <strong dir="ltr" style="unicode-bidi:embed;">${amount}</strong> עבור ${escapeHtml(card.recipientName)}.</p>
<div style="background:#fff;border:1px solid #DDD6C4;border-radius:12px;padding:16px;font-size:14px;">
  <div>נמען: ${escapeHtml(card.recipientName)}</div>
  <div>אימייל נמען: <span dir="ltr" style="unicode-bidi:embed;">${escapeHtml(card.recipientEmail)}</span></div>
  <div>מועד משלוח: ${card.scheduledDeliveryAt ? new Date(card.scheduledDeliveryAt).toLocaleString('he-IL') : 'מיידי'}</div>
  ${receiptNumber ? `<div>מספר קבלה: <span dir="ltr" style="unicode-bidi:embed;">${escapeHtml(receiptNumber)}</span></div>` : ''}
</div>
<p style="font-size:13px;color:#626B65;">השובר יישלח ישירות לנמען/ת. לשאלות: <span dir="ltr" style="unicode-bidi:embed;">${escapeHtml(business.email)}</span></p>`
  const text = `תודה על הרכישה. שובר מתנה ${amount} עבור ${card.recipientName}.`
  return { subject, html: shell(inner, 'rtl'), text }
}
