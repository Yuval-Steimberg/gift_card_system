#!/usr/bin/env node
/**
 * Discover + verify Grow's transaction-listing endpoint.
 *
 * WHY: the daily reconciliation sweep (/api/cron/reconcile) compares Grow's own
 * list of charges against what our database recorded — the ONLY check that can
 * catch a payment which never reached us at all. That needs an endpoint whose
 * exact path and field names this project has never been able to confirm,
 * because it has always run through Make.com with no GROW_* API credentials.
 *
 * This script tries the likely paths against the REAL account and prints what
 * comes back, so you can set GROW_TRANSACTIONS_PATH (and, if the field names
 * differ, fix toProviderTransaction() in lib/payments/grow.ts).
 *
 * Usage:
 *   npm run verify:grow            # last 7 days
 *   npm run verify:grow 30         # last 30 days
 *
 * Reads GROW_API_URL / GROW_API_KEY / GROW_API_SECRET / GROW_TRANSACTIONS_PATH
 * from the environment or .env.local. Exit 0 = a path returned rows.
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

const apiUrl = (process.env.GROW_API_URL || 'https://restapi.grow.link').replace(/\/$/, '')
const userId = process.env.GROW_API_KEY
const apiKey = process.env.GROW_API_SECRET

if (!userId || !apiKey) {
  console.error('✗ GROW_API_KEY (userId) and GROW_API_SECRET (apiKey) must be set.')
  console.error('  Grow dashboard → הגדרות → API. Put them in .env.local, then re-run.')
  process.exit(1)
}

const days = Number(process.argv[2] || 7)
const to = new Date()
const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
const pad = (n) => String(n).padStart(2, '0')
const ddmmyyyy = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`

// The configured path first, then the candidates worth trying.
const candidates = [
  process.env.GROW_TRANSACTIONS_PATH,
  '/api/light/server/1.0/getTransactions',
  '/api/light/server/getTransactions',
  '/api/light/server/1.0/getTransactionsList',
  '/api/light/server/1.0/getApiTransactions',
].filter(Boolean)

const body = new URLSearchParams({
  userId,
  apiKey,
  dateFrom: ddmmyyyy(from),
  dateTo: ddmmyyyy(to),
  from: from.toISOString(),
  to: to.toISOString(),
})

console.log(`Grow: ${apiUrl}`)
console.log(`Window: ${ddmmyyyy(from)} → ${ddmmyyyy(to)}\n`)

let success = null
for (const path of candidates) {
  process.stdout.write(`POST ${path} … `)
  try {
    const res = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const text = await res.text()
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      console.log(`HTTP ${res.status}`)
      continue
    }
    console.log('HTTP 200')
    console.log(JSON.stringify(parsed ?? text, null, 2).slice(0, 4000))
    console.log()
    if (parsed && !success) success = path
  } catch (err) {
    console.log(`network error: ${err.message}`)
  }
}

if (!success) {
  console.error('✗ No candidate path returned JSON. Ask Grow support for the')
  console.error('  transaction-listing endpoint, then set GROW_TRANSACTIONS_PATH.')
  process.exit(1)
}

console.log(`✓ Use: GROW_TRANSACTIONS_PATH=${success}`)
console.log('  Check the printed rows: the transaction id, amount, payer email and')
console.log('  status field names must match toProviderTransaction() in lib/payments/grow.ts.')
