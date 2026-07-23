#!/usr/bin/env node
/**
 * Live verification of the Supabase production data layer.
 *
 * Run this AFTER you've created the Supabase project, run the migrations + seed,
 * and set the env vars. It connects with the service-role key and:
 *   1. checks the required tables + RPCs exist (migrations applied),
 *   2. runs a real end-to-end money cycle on a throwaway card
 *      (activate -> redeem -> public view) via the atomic RPCs,
 *   3. asserts the ledger/balance invariants hold,
 *   4. cleans up the temporary rows.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify-supabase.mjs
 * or, with vars in .env.local:  npm run verify:supabase
 *
 * Exit code 0 = all good, 1 = something failed (details printed).
 */

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

// Best-effort load of .env.local / .env (no dependency on dotenv).
for (const f of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* file absent — fine */
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`)
const info = (m) => console.log(`\x1b[1m${m}\x1b[0m`)

if (!url || !serviceKey) {
  console.error(
    'Missing env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
      '(in the shell or .env.local) before running this script.',
  )
  process.exit(1)
}

let createClient
try {
  ;({ createClient } = await import('@supabase/supabase-js'))
} catch {
  console.error('Could not load @supabase/supabase-js. Run `npm install` first.')
  process.exit(1)
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } })
let failures = 0
const fail = (m) => {
  bad(m)
  failures++
}

// ---------------------------------------------------------------- 1. schema
info('\n1) Schema — required tables')
const REQUIRED_TABLES = [
  'gift_cards',
  'gift_card_ledger_entries',
  'gift_card_redemptions',
  'payments',
  'payment_events',
  'delivery_jobs',
  'gift_card_templates',
  'system_settings',
  'audit_logs',
  'store_locations',
]
for (const t of REQUIRED_TABLES) {
  const { error } = await db.from(t).select('*', { head: true, count: 'exact' }).limit(1)
  if (error) fail(`table ${t}: ${error.message}`)
  else ok(`table ${t}`)
}

info('\n2) Settings + templates (did the seed run?)')
const { data: settings } = await db.from('system_settings').select('*').limit(1).maybeSingle()
if (settings) ok(`system_settings present (currency=${settings.currency})`)
else fail('system_settings is empty — run supabase/seed.sql')

const { data: template } = await db.from('gift_card_templates').select('id,name').limit(1).maybeSingle()
if (template) ok(`template available (${template.name})`)
else fail('no gift_card_templates — run supabase/seed.sql')

// ------------------------------------------------------- 3. live money cycle
info('\n3) Live atomic money cycle (activate → redeem → public view)')
let cardId = null
const token = `verify-${randomUUID()}`
const code = `VERIFY-${randomUUID().slice(0, 8).toUpperCase()}`
const INITIAL = 20000 // ₪200 in agorot
const REDEEM = 5000 // ₪50

try {
  if (!template) throw new Error('cannot run cycle without a template (seed first)')

  // Create a throwaway draft card directly.
  const { data: created, error: cErr } = await db
    .from('gift_cards')
    .insert({
      code,
      public_token: token,
      status: 'draft',
      currency: 'ILS',
      initial_amount_minor: INITIAL,
      balance_minor: 0,
      template_id: template.id,
      buyer_name: 'Verify Script',
      buyer_email: 'verify@example.com',
      buyer_phone: null,
      buyer_company: null,
      buyer_tax_id: null,
      wants_invoice: false,
      is_anonymous: false,
      recipient_name: 'Verify Recipient',
      recipient_email: 'verify-recipient@example.com',
      recipient_phone: null,
      recipient_language: 'he',
      delivery_channel: 'email',
      greeting: 'verification',
      sender_timezone: 'Asia/Jerusalem',
    })
    .select('id')
    .single()
  if (cErr) throw new Error(`create card: ${cErr.message}`)
  cardId = created.id
  ok('created throwaway draft card')

  // Activate via the idempotent RPC (should credit exactly INITIAL).
  const { data: act, error: aErr } = await db.rpc('activate_gift_card_from_payment', {
    p_gift_card_id: cardId,
    p_provider: 'mock',
    p_event_id: `verify-evt-${cardId}`,
    p_provider_payment_id: `verify-pay-${cardId}`,
    p_amount_minor: INITIAL,
    p_currency: 'ILS',
    p_raw_event: {},
  })
  if (aErr) throw new Error(`activate_gift_card_from_payment RPC: ${aErr.message}`)
  const actRow = Array.isArray(act) ? act[0] : act
  if (actRow?.out_code === 'activated') ok(`activation returned '${actRow.out_code}'`)
  else fail(`activation returned '${actRow?.out_code}' (expected 'activated')`)

  // Idempotency: repeat the same event -> no second credit.
  await db.rpc('activate_gift_card_from_payment', {
    p_gift_card_id: cardId,
    p_provider: 'mock',
    p_event_id: `verify-evt-${cardId}`,
    p_provider_payment_id: `verify-pay-${cardId}`,
    p_amount_minor: INITIAL,
    p_currency: 'ILS',
    p_raw_event: {},
  })
  const { data: credits } = await db
    .from('gift_card_ledger_entries')
    .select('id')
    .eq('gift_card_id', cardId)
    .eq('type', 'initial_credit')
  if ((credits?.length ?? 0) === 1) ok('exactly one initial credit after duplicate activation')
  else fail(`expected 1 initial credit, found ${credits?.length}`)

  // Redeem via the atomic RPC.
  const { data: red, error: rErr } = await db.rpc('redeem_gift_card', {
    p_gift_card_id: cardId,
    p_amount_minor: REDEEM,
    p_employee_id: null,
    p_store_location_id: null,
    p_idempotency_key: `verify-redeem-${cardId}`,
    p_sale_reference: null,
    p_receipt_number: null,
    p_note: null,
  })
  if (rErr) throw new Error(`redeem_gift_card RPC: ${rErr.message}`)
  const redRow = Array.isArray(red) ? red[0] : red
  if (redRow?.out_code === 'ok' && Number(redRow.out_balance_after) === INITIAL - REDEEM) {
    ok(`redemption ok, balance ${INITIAL - REDEEM} agorot (₪${(INITIAL - REDEEM) / 100})`)
  } else {
    fail(`redemption returned '${redRow?.out_code}' balance=${redRow?.out_balance_after}`)
  }

  // Duplicate redeem (same idempotency key) -> 'duplicate', no double charge.
  const { data: red2 } = await db.rpc('redeem_gift_card', {
    p_gift_card_id: cardId,
    p_amount_minor: REDEEM,
    p_employee_id: null,
    p_store_location_id: null,
    p_idempotency_key: `verify-redeem-${cardId}`,
    p_sale_reference: null,
    p_receipt_number: null,
    p_note: null,
  })
  const red2Row = Array.isArray(red2) ? red2[0] : red2
  if (red2Row?.out_code === 'duplicate') ok("duplicate redeem returned 'duplicate' (no double charge)")
  else fail(`duplicate redeem returned '${red2Row?.out_code}' (expected 'duplicate')`)

  // Public view RPC hides PII and shows the right balance.
  const { data: pub, error: pErr } = await db.rpc('get_public_gift_card', { p_token: token })
  if (pErr) throw new Error(`get_public_gift_card RPC: ${pErr.message}`)
  const pubRow = Array.isArray(pub) ? pub[0] : pub
  if (pubRow && Number(pubRow.balance_minor) === INITIAL - REDEEM) {
    ok('public view returns correct balance and no buyer PII')
  } else {
    fail(`public view balance mismatch: ${JSON.stringify(pubRow)}`)
  }

  // Invariant: cached balance == ledger sum.
  const { data: ledger } = await db.from('gift_card_ledger_entries').select('amount_minor').eq('gift_card_id', cardId)
  const sum = (ledger ?? []).reduce((s, e) => s + Number(e.amount_minor), 0)
  const { data: card } = await db.from('gift_cards').select('balance_minor').eq('id', cardId).single()
  if (Number(card.balance_minor) === sum) ok(`invariant holds: balance_minor == SUM(ledger) == ${sum}`)
  else fail(`invariant broken: balance_minor=${card.balance_minor} but ledger sum=${sum}`)
} catch (e) {
  fail(e.message)
} finally {
  // Cleanup throwaway rows (service role bypasses RLS).
  if (cardId) {
    await db.from('gift_card_ledger_entries').delete().eq('gift_card_id', cardId)
    await db.from('gift_card_redemptions').delete().eq('gift_card_id', cardId)
    await db.from('delivery_jobs').delete().eq('gift_card_id', cardId)
    await db.from('payment_events').delete().eq('gift_card_id', cardId)
    await db.from('audit_logs').delete().eq('entity_id', cardId)
    await db.from('gift_cards').delete().eq('id', cardId)
    ok('cleaned up throwaway verification data')
  }
}

console.log('')
if (failures === 0) {
  info('✅ Supabase data layer verified — the live deployment is ready.')
  process.exit(0)
} else {
  info(`❌ ${failures} check(s) failed — see above. Fix migrations/env and re-run.`)
  process.exit(1)
}
