#!/usr/bin/env node
/**
 * Live verification of the Resend email path.
 *
 * Sends a real test email through the same Resend API the app uses, so you can
 * confirm your API key + verified sending domain work BEFORE relying on gift
 * delivery in production.
 *
 * Usage:
 *   TEST_EMAIL_TO=you@yourdomain.com npm run verify:email
 *   # or:
 *   node scripts/verify-email.mjs you@yourdomain.com
 *
 * Reads RESEND_API_KEY and EMAIL_FROM from the environment / .env.local.
 * Exit 0 = sent, 1 = failed (Resend's error is printed).
 */

import { readFileSync } from 'node:fs'

for (const f of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* no env file — fine */
  }
}

const apiKey = process.env.RESEND_API_KEY
const from = process.env.EMAIL_FROM || 'Just A Second <onboarding@resend.dev>'
const to = process.argv[2] || process.env.TEST_EMAIL_TO

const info = (m) => console.log(`\x1b[1m${m}\x1b[0m`)

if (!apiKey) {
  console.error('Missing RESEND_API_KEY (set it in the shell or .env.local).')
  process.exit(1)
}
if (!to) {
  console.error('No recipient. Pass one: `node scripts/verify-email.mjs you@example.com` or set TEST_EMAIL_TO.')
  process.exit(1)
}

info(`Sending a test email via Resend`)
console.log(`  from: ${from}`)
console.log(`  to:   ${to}`)

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from,
    to: [to],
    subject: 'Just A Second — email delivery test',
    html: '<div style="font-family:Heebo,Arial,sans-serif;color:#333D36"><h2>בדיקת שליחת מייל</h2><p>אם קיבלת את ההודעה הזו, שליחת המיילים דרך Resend עובדת. 🎉 (זו הודעת בדיקה בלבד.)</p></div>',
    text: 'Email delivery test — if you received this, Resend is working.',
  }),
})

if (!res.ok) {
  const detail = await res.text().catch(() => '')
  console.error(`\n\x1b[31m✗ Resend rejected the send (HTTP ${res.status})\x1b[0m`)
  console.error(detail)
  console.error(
    '\nCommon causes:\n' +
      '  • The `from` domain is not verified in Resend. Verify your domain, or for a quick\n' +
      "    test use EMAIL_FROM='Just A Second <onboarding@resend.dev>' and send only to the\n" +
      '    email address that owns the Resend account.\n' +
      '  • Invalid or revoked RESEND_API_KEY.',
  )
  process.exit(1)
}

const data = await res.json().catch(() => ({}))
console.log(`\n\x1b[32m✓ Sent\x1b[0m (Resend id: ${data.id ?? 'unknown'}). Check the inbox for "${to}".`)
process.exit(0)
