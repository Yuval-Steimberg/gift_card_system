import 'server-only'
import { getStore } from '@/lib/data'
import { serverEnv } from '@/lib/env'
import { getEmailProvider } from '@/lib/delivery/email'
import { formatMoney } from '@/lib/money'
import { reportError } from '@/lib/logging/report'
import { getPaymentProvider } from '@/lib/payments'
import type { ProviderTransaction } from '@/lib/payments'
import type { DeliveryHealthReport } from '@/lib/data/store'

/** How far back each sweep looks. Wide enough that a problem is still caught
 *  if a day's run is missed; the alert is deduped by being a daily digest. */
const LOOKBACK_DAYS = 14

export interface ReconciliationResult {
  unmatchedPayments: number
  paidNotActivated: number
  undelivered: number
  /** Charges the PAYMENT PROVIDER made that never reached us at all. */
  untrackedCharges: number
  /** Why the provider-side check could not run, if it could not. A sweep that
   *  silently skips half its job is worse than one that says so. */
  providerCheckError: string | null
  alerted: boolean
}

/** A charge the provider says it took, with nothing on our side to match it. */
export interface UntrackedCharge {
  providerPaymentId: string
  amountMinor: number
  payerEmail: string | null
  createdAt: string
}

/**
 * Ask the payment provider what it actually charged, and subtract what we
 * recorded. This is the ONLY check that can catch a payment which never reached
 * us — a webhook aimed at the wrong URL, a Make scenario that failed, an outage
 * on our side. Our own tables cannot reveal it by construction: to them, that
 * customer simply never bought anything.
 */
async function findUntrackedCharges(
  sinceIso: string,
): Promise<{ charges: UntrackedCharge[]; error: string | null }> {
  const provider = getPaymentProvider()
  if (typeof provider.listTransactions !== 'function') {
    return { charges: [], error: `${provider.name} cannot list transactions` }
  }
  let transactions: ProviderTransaction[]
  try {
    transactions = await provider.listTransactions({ fromIso: sinceIso, toIso: new Date().toISOString() })
  } catch (err) {
    // Credentials missing, endpoint moved, provider down — report it. Never
    // let a failed provider check read as "no problems found".
    return { charges: [], error: err instanceof Error ? err.message : 'provider check failed' }
  }

  const paid = transactions.filter((t) => t.status === 'paid' && t.providerPaymentId)
  if (paid.length === 0) return { charges: [], error: null }

  const known = await getStore().findKnownProviderPaymentIds(
    provider.name,
    paid.map((t) => t.providerPaymentId),
  )
  return {
    charges: paid
      .filter((t) => !known.has(t.providerPaymentId))
      .map((t) => ({
        providerPaymentId: t.providerPaymentId,
        amountMinor: t.amountMinor,
        payerEmail: t.payerEmail,
        createdAt: t.createdAt,
      })),
    error: null,
  }
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
  untracked: UntrackedCharge[] = [],
): { subject: string; html: string; text: string } {
  const total =
    report.unmatchedPayments.length + report.paidNotActivated.length + report.undelivered.length + untracked.length

  const body = [
    section(
      'חיוב שלא הגיע למערכת',
      'The payment provider charged these and we have NO record of them at all — no card, no order. ' +
        'Check the provider dashboard, then issue a card by hand.',
      untracked.map(
        (c) =>
          `${escapeHtml(c.payerEmail ?? 'unknown payer')} · ${formatMoney(c.amountMinor)} · ` +
          `${escapeHtml(c.providerPaymentId)} · ${escapeHtml(c.createdAt.slice(0, 16).replace('T', ' '))}`,
      ),
    ),
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
    `Charged at the provider but unknown to us: ${untracked.length}`,
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
  const [report, provider] = await Promise.all([store.getDeliveryHealth(since), findUntrackedCharges(since)])

  const counts = {
    unmatchedPayments: report.unmatchedPayments.length,
    paidNotActivated: report.paidNotActivated.length,
    undelivered: report.undelivered.length,
    untrackedCharges: provider.charges.length,
    providerCheckError: provider.error,
  }
  if (provider.error) {
    // Half the sweep did not run. That is an incident in itself: the check that
    // catches "charged but never reached us" is exactly the one you cannot
    // afford to lose quietly.
    await reportError(new Error(`reconciliation provider check unavailable: ${provider.error}`), {
      scope: 'reconcile_provider_check',
    })
  }
  const total =
    counts.unmatchedPayments + counts.paidNotActivated + counts.undelivered + counts.untrackedCharges
  if (total === 0) return { ...counts, alerted: false }

  await store.appendAudit({
    actorId: null,
    actorRole: 'system',
    action: 'reconcile.issues_found',
    entityType: 'system',
    entityId: 'reconcile',
    reason: `${total} item(s) need attention`,
    metadata: { ...counts, providerCheckError: counts.providerCheckError },
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

  const mail = renderReconciliationEmail(report, env.APP_BASE_URL, provider.charges)
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
