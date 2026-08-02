# Just A Second — Gift Card System

A standalone, production-oriented **digital gift-card platform** for the Just A Second
physical retail store. Customers buy a gift card online, it is delivered digitally to a
recipient, and it is redeemed **in-store** with full protection against duplicate use.
The system is independent of Wix and can be linked from the existing site with a
“Buy a Gift Card” button.

> **Runs with zero external credentials.** Out of the box the app uses an in-memory
> store and mock payment/email/receipt providers, so you can experience the
> **entire** purchase → deliver → redeem → admin flow locally without Supabase, Grow, or
> any API key. Configure real services when you’re ready.
>
> **No sample gift cards are ever created.** The store seeds configuration only
> (settings, card designs, the store location), so every figure in `/admin` comes from
> real purchases and a fresh install starts at zero.

## Table of contents

1. [Overview](#overview) · 2. [Architecture](#architecture) · 3. [Tech stack](#tech-stack)
4. [Local setup](#local-setup) · 5. [Environment variables](#environment-variables)
6. [Supabase setup & migrations](#supabase-setup--migrations) · 7. [Mock payment flow](#mock-payment-flow)
8. [Mock email flow](#mock-email-flow) · 9. [Running tests](#running-tests)
10. [Production payment integration](#production-payment-integration) · 11. [Accounting](#accounting)
12. [Deployment](#deployment) · 13. [Wix linking](#wix-linking) · 14. [Security notes](#security-notes)
15. [Known limitations](#known-limitations) · 16. [Roadmap](#roadmap)

## Overview

- **Public purchase funnel** (`/gift-cards`): amount (preset/custom) → design → buyer →
  recipient → greeting → timing → review → pay. Live gift-card preview, RTL-first Hebrew.
- **Recipient page** (`/gift/<token>`): branded card, balance, human code, QR, PDF download,
  “report lost”. Gated by a long random token — **no DB ids in the URL**.
- **Employee redemption** (`/employee`): sign in, scan QR or type code, partial/full redeem,
  atomic + idempotent.
- **Admin dashboard** (`/admin`): overview, searchable/filterable table, card detail with
  full ledger + audit timeline, lifecycle actions (suspend/cancel/refund/reissue/adjust/
  resend/reverse), templates, settings, reports, CSV export — all RBAC-gated **server-side**.

The definitive design + build plan is in [`docs/implementation-plan.md`](docs/implementation-plan.md).
The audit of the existing Wix-adjacent site (brand + payment reuse) is in
[`docs/just-website-repository-audit.md`](docs/just-website-repository-audit.md).

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full picture. Highlights:

- **Money is integer minor units (agorot).** ₪249.90 → `24990`. No floating point, ever.
- **Immutable ledger is the source of truth.** `gift_cards.balance_minor` is a cached total,
  updated **atomically** with each ledger entry.
- **Redemption is one atomic operation.** Production: the `redeem_gift_card()` Postgres
  function (`SELECT … FOR UPDATE` + unique idempotency key). Offline: a per-card mutex in
  `MemoryStore` mirrors the same guarantee. App code never does read-modify-write on balance.
- **Payment is proven only by a verified, signed webhook.** A browser redirect is never
  treated as proof of payment. All webhook processing is idempotent.
- **Provider abstractions** for payment, email, and accounting — each with a mock/dev adapter.
- **Two data layers behind one interface** (`lib/data/store.ts`): `MemoryStore` (default,
  offline) and `SupabaseStore` (production, via SQL RPCs).

## Tech stack

Next.js 14 (App Router) · React 18 · TypeScript (strict) · Tailwind CSS + JAS design tokens ·
Radix primitives · Zod · Supabase / PostgreSQL (RLS + plpgsql functions) · pdf-lib · qrcode ·
Vitest · Playwright · ESLint · Prettier · GitHub Actions.

## Local setup

```bash
npm install
cp .env.example .env.local        # optional — defaults work offline
npm run dev                       # http://localhost:3000
```

Then try the flow:

1. **Buy:** open `/gift-cards`, complete the steps, and on the **mock checkout** click
   “אישור ותשלום”. You’ll land on the confirmation page once the signed webhook activates the card.
2. **Recipient:** the confirmation page links to `/gift/<token>`. Open the dev email preview
   in `.mail/` too.
3. **Redeem:** open `/employee`, sign in as `employee1@justasecond.example` / `password`,
   and redeem by code or QR.
4. **Admin:** open `/admin`, sign in as `owner@justasecond.example` / `password`.

**Demo accounts** (offline auth only, never on a Supabase deployment; password
`password`): `owner@`, `admin@`, `manager@`, `employee1@`, `employee2@`, `finance@`
`justasecond.example`.
**No sample cards are seeded** — to get a card to redeem, buy one through the funnel
above (step 1) and use the code from the confirmation page.

## Environment variables

Every variable is **optional** for local dev (mocks kick in). See
[`.env.example`](.env.example) for the annotated list. `NEXT_PUBLIC_*` is browser-exposed;
everything else is server-only. Key groups: app (`APP_BASE_URL`, `BUSINESS_TIMEZONE`,
`CRON_SECRET`), Supabase, payments (`PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET`, `GROW_*`),
email (`EMAIL_PROVIDER`, `RESEND_*`), accounting (`RECEIPT_PROVIDER`, `GREENINVOICE_*`).
Validation lives in `lib/env.ts` and fails fast with a clear message when a real provider is
selected without its credentials.

## Supabase setup & migrations

The app runs offline without Supabase. To use the production data layer:

```bash
# 1. Create a Supabase project; set NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
# 2. Apply migrations (choose one):
supabase db push                                  # Supabase CLI
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql \
                     -f supabase/migrations/0002_rls.sql \
                     -f supabase/migrations/0003_functions.sql
psql "$DATABASE_URL" -f supabase/seed.sql          # reference data: settings, designs, store
# or:
DATABASE_URL=... npm run db:migrate && npm run db:seed
# Database still holds the old sample cards? Purge just those:
psql "$DATABASE_URL" -f supabase/cleanup-demo-data.sql
# Or wipe EVERY card and start the dashboard from zero (destructive; keeps
# settings, designs, store locations and staff):
psql "$DATABASE_URL" -f supabase/reset-gift-cards.sql
```

Once `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set, `getStore()`
automatically uses `SupabaseStore`. Schema, constraints, RLS, and the atomic functions are
documented in [`docs/database.md`](docs/database.md) and
[`docs/redemption-security.md`](docs/redemption-security.md).

## Mock payment flow

`PAYMENT_PROVIDER=mock` (default). `createCheckoutSession` returns a URL to `/checkout/mock`,
our own hosted-checkout stand-in. Clicking **approve** posts a **cryptographically-signed**
webhook to `/api/webhooks/payment` — the exact same verification + activation path production
uses. The confirmation page polls server state; the card activates only on the verified webhook.
Full detail: [`docs/payment-flow.md`](docs/payment-flow.md).

## Mock email flow

`EMAIL_PROVIDER=log` (default) writes an HTML preview of every message to `.mail/` and logs a
summary line — no credentials, no network. Inspect the recipient card email and buyer receipt
there.

## Running tests

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # next lint
npm test                 # Vitest: unit + integration (financial logic)
npm run test:e2e         # Playwright: purchase→redeem, employee redeem, authz (builds+starts app)
```

Unit tests cover money, code/token generation, the status machine, ledger math, permissions,
safe text, and webhook signatures. Integration tests cover activation idempotency (exactly one
card + one credit), full/partial redemption, **concurrent-redemption overspend prevention**,
duplicate-submit idempotency, reversal, manual adjustment, reissue token invalidation, and
forged-webhook rejection. All run offline against `MemoryStore`.

## Production payment integration

Set `PAYMENT_PROVIDER=grow` and provide `GROW_API_KEY`, `GROW_API_SECRET`, `GROW_PAGE_CODE`,
and a strong `PAYMENT_WEBHOOK_SECRET`. The Grow adapter (`lib/payments/grow.ts`) is modeled on
the reference site’s Grow/Meshulam integration but **hardened**: signed-webhook verification,
amount reconciliation, and minor-unit money. It is written to documented shapes but is
**unverified against a live Grow account** — confirm the exact field names and webhook
signature scheme with Grow before go-live (see [`docs/payment-flow.md`](docs/payment-flow.md)).

## Accounting

`RECEIPT_PROVIDER=mock` by default. A Green Invoice / Morning adapter stub exists behind the
`ReceiptProvider` interface. **The correct Israeli accounting treatment for a gift-card sale
(receipt at purchase vs. tax invoice at redemption vs. deposit receipt) MUST be confirmed with
the business’s accountant** before enabling a real provider — the mock is not compliance. See
[`docs/production-checklist.md`](docs/production-checklist.md).

## Deployment

Deploy as a standard Next.js app (Vercel recommended; any Node host works). Set the env vars,
run the Supabase migrations, and schedule the delivery worker to POST `/api/cron/deliver` with
`Authorization: Bearer $CRON_SECRET` (e.g. Vercel Cron / Supabase scheduled function). Do **not**
rely on in-process timers for scheduled delivery.

- **Shareable test deploy** (Vercel + Supabase, mock payments): [`docs/deploy-vercel-test.md`](docs/deploy-vercel-test.md)
- **Real production go-live** (domain, Grow payments, Supabase Auth, accounting, legal, security):
  [`docs/GO-LIVE-PRODUCTION.md`](docs/GO-LIVE-PRODUCTION.md)
- **One-command DB provision:** run `supabase/setup.sql` in the Supabase SQL Editor.
- **Diagnostics:** `GET /api/health` (store, tables, admin-query + auth probes, env flags),
  `npm run verify:supabase`, `npm run verify:email`.

## Wix linking

The app is independent of Wix. Deploy it to a branded subdomain (e.g. `gift.justasecond.co.il`)
and add a **“Buy a Gift Card”** button on the Wix site linking to `/gift-cards`. Do not embed
checkout in an iframe. Full steps: [`docs/wix-integration.md`](docs/wix-integration.md).

## Security notes

Signed + verified webhooks (the single most important fix over the reference site, whose
webhook verified nothing); server-side RBAC on every protected action; RLS deny-by-default so
codes/balances are never anon-readable; QR/links carry only an opaque token; rate-limited public
lookups; plain-text-only greetings with bidi-safe sanitization; integer money; idempotent
financial operations; service-role key server-only. Details:
[`docs/redemption-security.md`](docs/redemption-security.md) and
[`docs/roles-and-permissions.md`](docs/roles-and-permissions.md).

## Known limitations

- **Offline data layer is in-memory** (resets on restart); production requires Supabase.
- **Grow + Green Invoice adapters are unverified** against live accounts (documented above).
- **PDF Hebrew glyphs** require dropping a Hebrew TTF at `public/fonts/NotoSansHebrew-Regular.ttf`
  (auto-embedded when present; a safe Latin fallback is used otherwise). Code/QR/amounts always render.
- **SMS/WhatsApp** delivery are interface stubs; **email** is the MVP channel.
- **Legal, privacy, and accounting compliance are not certified** — require professional review.

## Roadmap

MVP is complete (see the Definition of Done in [`docs/implementation-plan.md`](docs/implementation-plan.md)).
Future: Apple/Google Wallet passes, SMS/WhatsApp delivery, online redemption, multi-store,
multi-currency, corporate bulk purchase, and a public API — the architecture is prepared for
these but they are intentionally out of MVP scope.
