import 'server-only'
import { getStore } from '@/lib/data'
import { serverEnv } from '@/lib/env'
import { getEmailProvider } from '@/lib/delivery/email'
import { formatMoney } from '@/lib/money'
import { reportError } from '@/lib/logging/report'
import type { DeliveryHealthReport } from '@/lib/data/store'

/** How far back each sweep looks. Wide enough that a problem is still caught
 *  if a day's run is missed; the alert is deduped by being a daily digest. */
const LOOKBACK_DAYS = 14

export interface ReconciliationResult {
  unmatchedPayments: number
  paidNotActivated: number
  undelivered: number
  alerted: boolean
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

function section(title: string, why: string, rows: string[]): string {
  if (rows.length === 0) return ''
  return [
    `<h3 style="margin:24px 0 4px">${escapeHtml(title)} — ${rows.length}</h3>`,
    `<p style="margin:0 0 8px;color:#666;font-size:13px">${escapeHtml(why)}</p>`,
    '<ul style="margin:0;padding-inline-start:18px">',
    ...rows.map((r) => `<li style="margin-bottom:4px">${r}</li>`),
    '</ul>',
  ].join('\n')
}

export function renderReconciliationEmail(
  report: DeliveryHealthReport,
  baseUrl: string,
): { subject: string; html: string; text: string } {
  const total = report.unmatchedPayments.length + report.paidNotActivated.length + report.undelivered.length

  const body = [
    section(
      'תשלומים ללא שובר',
      'Money was charged and no gift card could be matched to it. Find the payment in Grow and issue a card by hand.',
      report.unmatchedPayments.map(
        (p) =>
          `${escapeHtml(p.payerEmail ?? 'unknown payer')} · ${formatMoney(p.amountMinor)} · ` +
          `${escapeHtml(p.provider)} ${escapeHtml(p.eventId)} · ${escapeHtml(p.createdAt.slice(0, 16).replace('T', ' '))}`,
      ),
    ),
    section(
      'שולם אך לא הופעל',
      'A payment callback arrived for these cards but they never went active. Use "סימון כשולם והפעלה" in /admin.',
      report.paidNotActivated.map(
        (c) =>
          `<a href="${baseUrl}/admin/cards/${c.id}">${escapeHtml(c.code)}</a> · ` +
          `${escapeHtml(c.recipientEmail)} · ${formatMoney(c.amountMinor)}`,
      ),
    ),
    section(
      'שובר פעיל שלא נמסר',
      'These cards are paid and active, but the recipient email did not go out (or the receiving server rejected it).',
      report.undelivered.map(
        (c) =>
          `<a href="${baseUrl}/admin/cards/${c.id}">${escapeHtml(c.code)}</a> · ` +
          `${escapeHtml(c.recipientEmail)} · ${formatMoney(c.amountMinor)} · ` +
          `${escapeHtml(c.deliveryStatus)}${c.lastError ? ` — ${escapeHtml(c.lastError)}` : ''}`,
      ),
    ),
  ]
    .filter(Boolean)
    .join('\n')

  const text = [
    `${total} item(s) need attention.`,
    `Unmatched payments: ${report.unmatchedPayments.length}`,
    `Paid but not activated: ${report.paidNotActivated.length}`,
    `Active but undelivered: ${report.undelivered.length}`,
    `${baseUrl}/admin`,
  ].join('\n')

  return {
    subject: `⚠️ שוברי מתנה — ${total} פריטים דורשים טיפול`,
    html: `<div dir="rtl" style="font-family:system-ui,Arial,sans-serif;max-width:640px">
<h2 style="margin:0 0 4px">בדיקת שוברים יומית</h2>
<p style="margin:0;color:#666;font-size:13px">${total} items need a human. Everything below is money already taken.</p>
${body}
<p style="margin-top:24px"><a href="${baseUrl}/admin">פתיחת לוח הבקרה</a></p>
</div>`,
    text,
  }
}

/**
 * Find everything that was paid for and did not arrive, and email the owner if
 * there is anything. Returns the counts either way so the cron response is
 * useful on its own.
 *
 * Deliberately quiet on a clean run: an alert that arrives every day is an
 * alert nobody reads.
 */
export async function runReconciliation(): Promise<ReconciliationResult> {
  const store = getStore()
  const env = serverEnv()
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const report = await store.getDeliveryHealth(since)

  const counts = {
    unmatchedPayments: report.unmatchedPayments.length,
    paidNotActivated: report.paidNotActivated.length,
    undelivered: report.undelivered.length,
  }
  const total = counts.unmatchedPayments + counts.paidNotActivated + counts.undelivered
  if (total === 0) return { ...counts, alerted: false }

  await store.appendAudit({
    actorId: null,
    actorRole: 'system',
    action: 'reconcile.issues_found',
    entityType: 'system',
    entityId: 'reconcile',
    reason: `${total} item(s) need attention`,
    metadata: counts,
  })

  const settings = await store.getSettings()
  const to = settings.businessEmail?.trim()
  if (!to) {
    // No owner address configured: the sweep found problems and cannot tell
    // anyone. That is itself an incident.
    await reportError(new Error('reconciliation found issues but businessEmail is not set'), {
      scope: 'reconcile',
      ...counts,
    })
    return { ...counts, alerted: false }
  }

  const mail = renderReconciliationEmail(report, env.APP_BASE_URL)
  try {
    await getEmailProvider().send({
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      idempotencyKey: `reconcile:${new Date().toISOString().slice(0, 10)}`,
      metadata: { kind: 'reconciliation' },
    })
    return { ...counts, alerted: true }
  } catch (err) {
    await reportError(err, { scope: 'reconcile_alert', ...counts })
    return { ...counts, alerted: false }
  }
}
