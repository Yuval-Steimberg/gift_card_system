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

/** Recipient email after an in-store redemption: what was spent and what is left. */
export function renderRedemptionEmail(
  card: GiftCard,
  amountMinor: number,
  balanceAfterMinor: number,
  baseUrl: string,
  business: BusinessInfo,
): { subject: string; html: string; text: string } {
  const rtl = card.recipientLanguage === 'he'
  const url = recipientUrl(baseUrl, card.publicToken)
  const spent = formatMoney(amountMinor, card.currency)
  const left = formatMoney(balanceAfterMinor, card.currency)
  const used = balanceAfterMinor === 0
  const ltr = (v: string) => `<strong dir="ltr" style="unicode-bidi:embed;">${v}</strong>`

  const subject = rtl
    ? used
      ? 'השובר מומש במלואו · Just A Second'
      : `נותרה יתרה של ${left} בשובר · Just A Second`
    : used
      ? 'Your gift card has been fully used · Just A Second'
      : `${left} left on your gift card · Just A Second`
  const heading = rtl ? `${escapeHtml(card.recipientName)}, תודה שבאת` : `Thanks for visiting, ${escapeHtml(card.recipientName)}`
  const line = rtl ? `מומשו ${ltr(spent)} מהשובר.` : `${ltr(spent)} was redeemed from your gift card.`
  const balance = used
    ? rtl
      ? 'השובר מומש במלואו.'
      : 'The gift card is now fully used.'
    : rtl
      ? `היתרה שנותרה: ${ltr(left)} — אפשר לממש אותה בביקור הבא.`
      : `Remaining balance: ${ltr(left)} — use it on your next visit.`
  const cta = rtl ? 'לצפייה בשובר' : 'View your gift card'
  const contact = business.email
    ? `${rtl ? 'משהו לא נראה נכון? כתבו לנו' : 'Something looks wrong? Write to us'}: <span dir="ltr" style="unicode-bidi:embed;">${escapeHtml(business.email)}</span>`
    : ''

  const inner = `
<h1 style="font-size:22px;">${heading}</h1>
<p style="font-size:15px;">${line}</p>
<p style="font-size:15px;">${balance}</p>
${used ? '' : `<a href="${url}" style="display:inline-block;margin-top:8px;background:#E88225;color:#FFFCF5;text-decoration:none;padding:10px 24px;border-radius:999px;font-weight:700;">${cta}</a>`}
<p style="font-size:13px;color:#626B65;margin-top:20px;">${contact}</p>`

  const strip = (h: string) => h.replace(/<[^>]+>/g, '')
  const text = `${strip(heading)}\n${strip(line)}\n${strip(balance)}${used ? '' : `\n\n${cta}: ${url}`}`
  return { subject, html: shell(inner, rtl ? 'rtl' : 'ltr'), text }
}

export interface SaleNotice {
  maskedCode: string
  adminUrl: string
  delivery: { status: string; scheduledFor: string | null; error: string | null } | null
  receipt: 'issued' | 'failed'
  manual: boolean
}

/** Staff email for every activated card: what was sold and whether it reached the recipient. */
export function renderSaleNotificationEmail(card: GiftCard, n: SaleNotice): { subject: string; html: string; text: string } {
  const amount = formatMoney(card.initialAmountMinor, card.currency)
  const d = n.delivery
  const delivered = d && (d.status === 'sent' || d.status === 'delivered')
  const scheduled = d && (d.status === 'scheduled' || d.status === 'pending') && d.scheduledFor && new Date(d.scheduledFor).getTime() > Date.now()
  const deliveryLine = delivered
    ? '✅ נשלח לנמען/ת'
    : scheduled
      ? `🕒 מתוזמן ל-${new Date(d!.scheduledFor!).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`
      : d
        ? `❌ לא נשלח (${escapeHtml(d.status)}${d.error ? `: ${escapeHtml(d.error)}` : ''})`
        : '❌ לא נוצרה משימת משלוח'
  const ok = Boolean(delivered || scheduled)
  const subject = `${ok ? '✅' : '⚠️'} שובר חדש נמכר · ${amount} · ${card.recipientName}`
  const ltr = (v: string) => `<span dir="ltr" style="unicode-bidi:embed;">${escapeHtml(v)}</span>`
  const row = (k: string, v: string) =>
    `<tr><td style="padding:4px 0 4px 12px;color:#626B65;white-space:nowrap;">${k}</td><td style="padding:4px 0;">${v}</td></tr>`

  const inner = `
<h1 style="font-size:20px;">שובר חדש נמכר: <span dir="ltr" style="unicode-bidi:embed;">${amount}</span></h1>
<table style="font-size:14px;border-collapse:collapse;">
${row('קוד', ltr(n.maskedCode))}
${row('תשלום', n.manual ? 'הופעל ידנית (סימון כשולם)' : 'אומת אוטומטית')}
${row('משלוח לנמען/ת', deliveryLine)}
${row('קבלה', n.receipt === 'issued' ? '✅ הופקה' : '⚠️ לא הופקה')}
${row('רוכש/ת', `${escapeHtml(card.buyerName ?? '')} · ${ltr(card.buyerEmail)}${card.buyerPhone ? ` · ${ltr(card.buyerPhone)}` : ''}`)}
${row('נמען/ת', `${escapeHtml(card.recipientName)} · ${ltr(card.recipientEmail)}${card.recipientPhone ? ` · ${ltr(card.recipientPhone)}` : ''}`)}
</table>
<a href="${n.adminUrl}" style="display:inline-block;margin-top:16px;background:#E88225;color:#FFFCF5;text-decoration:none;padding:10px 24px;border-radius:999px;font-weight:700;">לשובר במערכת הניהול</a>`

  const strip = (h: string) => h.replace(/<[^>]+>/g, '')
  const text = [
    `שובר חדש נמכר: ${amount}`,
    `קוד: ${n.maskedCode}`,
    `משלוח: ${strip(deliveryLine)}`,
    `קבלה: ${n.receipt === 'issued' ? 'הופקה' : 'לא הופקה'}`,
    `רוכש/ת: ${card.buyerName ?? ''} ${card.buyerEmail}`,
    `נמען/ת: ${card.recipientName} ${card.recipientEmail}`,
    n.adminUrl,
  ].join('\n')
  return { subject, html: shell(inner, 'rtl'), text }
}
