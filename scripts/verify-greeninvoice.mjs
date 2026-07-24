#!/usr/bin/env node
/**
 * Live verification of the Green Invoice (Morning) receipt integration.
 *
 * Runs the exact two calls the app makes — authenticate (token) then create a
 * document — against your account (use the SANDBOX first) and prints the real
 * response so any field/type mismatch is obvious before enabling in the app.
 *
 * Usage (put the vars in .env.local or the shell):
 *   npm run verify:greeninvoice
 *
 * Env:
 *   GREENINVOICE_API_URL     (default sandbox: https://sandbox.d.greeninvoice.co.il)
 *   GREENINVOICE_API_KEY     (the API "id")
 *   GREENINVOICE_API_SECRET  (the API "secret")
 *   GREENINVOICE_DOC_TYPE    (default 400 = receipt; 320 = invoice-receipt)
 *   GREENINVOICE_TEST_EMAIL  (optional; where a test doc emails, if any)
 */
import { readFileSync } from 'node:fs'

for (const f of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* no env file */
  }
}

const url = (process.env.GREENINVOICE_API_URL || 'https://sandbox.d.greeninvoice.co.il').replace(/\/$/, '')
const id = process.env.GREENINVOICE_API_KEY
const secret = process.env.GREENINVOICE_API_SECRET
const docType = Number(process.env.GREENINVOICE_DOC_TYPE || '400')
const testEmail = process.env.GREENINVOICE_TEST_EMAIL || 'test@example.com'

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`)
const info = (m) => console.log(`\x1b[1m${m}\x1b[0m`)

if (!id || !secret) {
  console.error('Missing GREENINVOICE_API_KEY / GREENINVOICE_API_SECRET (set in .env.local).')
  process.exit(1)
}

info(`\nGreen Invoice check — ${url} (docType ${docType})`)

// 1) Authenticate
let token
try {
  const res = await fetch(`${url}/api/v1/account/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, secret }),
  })
  const text = await res.text()
  if (!res.ok) {
    bad(`auth failed (HTTP ${res.status}): ${text.slice(0, 300)}`)
    process.exit(1)
  }
  token = JSON.parse(text).token
  if (!token) {
    bad(`auth returned no token: ${text.slice(0, 300)}`)
    process.exit(1)
  }
  ok('authenticated (token received)')
} catch (e) {
  bad(`auth error: ${e.message}`)
  process.exit(1)
}

// 2) Create a test document (mirrors lib/accounting/greeninvoice.ts)
try {
  const body = {
    type: docType,
    lang: 'he',
    currency: 'ILS',
    vatType: 0,
    client: { name: 'לקוח בדיקה', emails: [testEmail] },
    income: [{ description: 'שובר מתנה (בדיקה)', quantity: 1, price: 100, currency: 'ILS', vatType: 0 }],
    payment: [{ type: 4, price: 100, currency: 'ILS' }],
    remarks: 'verify-greeninvoice test document',
  }
  const res = await fetch(`${url}/api/v1/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    bad(`document creation failed (HTTP ${res.status}):`)
    console.log(text.slice(0, 800))
    console.log('\nPaste the above error back and I will adjust the adapter fields.')
    process.exit(1)
  }
  const data = JSON.parse(text)
  ok(`document created — number ${data.number ?? data.id ?? '?'}`)
  if (data.url?.origin || data.url?.he) ok(`url: ${data.url.origin ?? data.url.he}`)
  info('\n✅ Green Invoice sandbox works with these settings.')
  process.exit(0)
} catch (e) {
  bad(`document error: ${e.message}`)
  process.exit(1)
}
