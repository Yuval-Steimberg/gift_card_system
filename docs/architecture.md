# Architecture

The `gift_card_system` is a standalone Next.js (App Router, TypeScript strict)
application for **Just A Second**: gift cards are purchased online, delivered
digitally, and redeemed in-store. It is fully independent of the existing Wix
site (see `docs/wix-integration.md`) and boots with **zero external credentials**
thanks to mock providers and an in-memory data layer.

This document ties the pieces together. For the money/DB internals see
`docs/database.md`; for the security guarantees see `docs/redemption-security.md`;
for the payment path see `docs/payment-flow.md`.

---

## 1. Directory tree

```
app/
├── page.tsx                         marketing home
├── gift-cards/page.tsx              public purchase funnel entry
├── checkout/
│   ├── mock/page.tsx                dev-only mock hosted checkout page
│   ├── confirmation/page.tsx        post-pay confirmation (polls server state)
│   └── cancelled/page.tsx
├── gift/[token]/
│   ├── page.tsx                     recipient view (secure public_token)
│   ├── actions.ts                   reportGiftCardLost server action
│   └── pdf/route.ts                 on-demand gift-card PDF
├── employee/
│   ├── login/page.tsx               staff sign-in
│   ├── page.tsx                     redemption app (scan / lookup / redeem)
│   └── actions.ts                   redemption server actions
├── admin/
│   ├── layout.tsx  page.tsx         dashboard overview
│   ├── gift-cards/page.tsx          searchable/filterable table
│   ├── gift-cards/[id]/page.tsx     card detail (ledger + audit + lifecycle)
│   ├── templates/  settings/  reports/
│   ├── reports/export/route.ts      CSV export
│   └── actions.ts                   admin lifecycle server actions
├── actions/purchase.ts              createPurchase + getPurchaseStatus
├── api/
│   ├── webhooks/payment/route.ts    the ONLY activation entry point
│   └── cron/deliver/route.ts        delivery worker (CRON_SECRET-gated)
├── layout.tsx  globals.css  terms/page.tsx
lib/
├── money.ts                         integer minor units (agorot)
├── env.ts                           Zod-validated env, isSupabaseConfigured()
├── gift-cards/                      service.ts, admin-service.ts, codes.ts,
│                                    ledger.ts, status.ts, pdf.ts, qr.ts, types.ts
├── payments/                        types.ts (interface), mock.ts, grow.ts,
│                                    index.ts (factory), webhook-handler.ts
├── delivery/email/                  index.ts (factory), log.ts, resend.ts, types.ts
├── accounting/                      index.ts (factory), mock.ts, greeninvoice.ts, types.ts
├── data/                            store.ts (interface), memory-store.ts,
│                                    supabase-store.ts, supabase-client.ts,
│                                    seed-data.ts, mutex.ts, index.ts (factory)
├── permissions/roles.ts             RBAC roles + permission matrix
├── auth/                            session.ts, guards.ts, users.ts (demo auth)
├── security/                        webhook.ts, rate-limit.ts, text.ts
└── validation/                      purchase.ts, redeem.ts (Zod, client+server)
supabase/
├── migrations/0001_init.sql         enums, tables, constraints, indexes
├── migrations/0002_rls.sql          RLS deny-by-default + role scoping
├── migrations/0003_functions.sql    redeem_gift_card, activate_..., get_public_...
└── seed.sql                         deterministic demo data
scripts/db-migrate.mjs  scripts/db-seed.mjs
```

---

## 2. Provider abstractions (mock + real behind one interface)

Three side-effecting concerns are each defined as a TypeScript interface with a
mock/dev adapter (the default) and a real adapter, selected by an env var. This
is why the whole system runs locally with no credentials.

| Concern | Interface | Mock / dev default | Real adapter | Selector env |
| --- | --- | --- | --- | --- |
| Payment | `PaymentProvider` (`lib/payments/types.ts`) | `MockPaymentProvider` (`lib/payments/mock.ts`) | `GrowPaymentProvider` (`lib/payments/grow.ts`) | `PAYMENT_PROVIDER=mock\|grow` |
| Email | `lib/delivery/email/types.ts` | log adapter (`log.ts`, writes previews to `.mail/`) | Resend (`resend.ts`) | `EMAIL_PROVIDER=log\|resend` |
| Receipt | `lib/accounting/types.ts` | mock (`mock.ts`) | greeninvoice stub (`greeninvoice.ts`) | `RECEIPT_PROVIDER=mock\|greeninvoice` |

Each concern has a factory: `getPaymentProvider()` (`lib/payments/index.ts`),
`getEmailProvider()` (`lib/delivery/email/index.ts`), `getReceiptProvider()`
(`lib/accounting/index.ts`). All are `import 'server-only'` — secrets never reach
the browser bundle.

---

## 3. Data layer (`GiftCardStore` interface)

`lib/data/store.ts` defines the `GiftCardStore` interface. Two implementations:

- **`MemoryStore`** (`lib/data/memory-store.ts`) — the **offline default**.
  Seeded from `lib/data/seed-data.ts`, fully in-memory, a process-global
  singleton so state persists across requests in a running dev server. Atomic
  operations are serialized by a **per-card mutex** (`lib/data/mutex.ts`), giving
  tests and the demo the same atomic contract as production.
- **`SupabaseStore`** (`lib/data/supabase-store.ts`) — **production**. Delegates
  every balance-changing operation to Postgres RPCs (`redeem_gift_card`,
  `activate_gift_card_from_payment`, `reverse_redemption`, `apply_ledger_adjustment`,
  `transition_gift_card_status`, `reissue_gift_card`, `claim_due_delivery_jobs`,
  `get_public_gift_card`) created in `supabase/migrations/0003_functions.sql`.

`getStore()` (`lib/data/index.ts`) resolves which to use: `SupabaseStore` when
`isSupabaseConfigured()` (`lib/env.ts`) is true, otherwise `MemoryStore`.

---

## 4. Money model — ledger-based, integer minor units

- **Money is always integer minor units (agorot).** `₪100 → 10000`; DB `bigint`.
  No float / numeric money anywhere. Helpers live in `lib/money.ts`.
- **The immutable ledger `gift_card_ledger_entries` is the source of truth.**
  Amounts are signed (credits +, debits −). The invariant
  `balance_minor == SUM(ledger.amount_minor)` always holds.
- **`gift_cards.balance_minor` is a cached total**, updated **atomically** inside
  the same transaction as each ledger insert — never by ad-hoc app code. This
  keeps reads (recipient page, redemption UI, dashboard) to a single-row lookup.

See `docs/database.md` for the ledger entry types and status machine
(`lib/gift-cards/status.ts`).

---

## 5. Atomic redemption guarantee

Every in-store spend goes through **one** operation and nothing else:

- **Production:** the `redeem_gift_card()` plpgsql function locks the card with
  `SELECT ... FOR UPDATE`, short-circuits duplicate `idempotency_key`s, validates
  amount/status/expiry/balance, then writes ledger debit + redemption row +
  cached balance + audit in a single transaction.
- **Offline:** `MemoryStore` mirrors this with the per-card mutex in
  `lib/data/mutex.ts`.

App code **never** does read-modify-write on a balance. Full analysis in
`docs/redemption-security.md`.

---

## 6. Security model

- **Signed webhooks.** Payment is proven only by a signature-verified server-side
  webhook (`lib/security/webhook.ts`); a browser redirect is never trusted. The
  webhook amount is reconciled against the stored authoritative amount before
  activation.
- **RBAC enforced server-side.** `assertPermission()` (`lib/auth/guards.ts`) runs
  inside every server action / route handler against the matrix in
  `lib/permissions/roles.ts`. Hiding a UI button is never authorization. See
  `docs/roles-and-permissions.md`.
- **RLS deny-by-default.** In production, `supabase/migrations/0002_rls.sql`
  enables/forces RLS on every table; codes/balances/tokens are never
  anon-readable. The only anon read path is the `get_public_gift_card` definer
  function, which returns a PII-minimized projection.
- **Rate limiting** (`lib/security/rate-limit.ts`) on public token lookups and
  redemption endpoints.
- **Safe text** (`lib/security/text.ts`) sanitizes buyer/recipient/greeting input
  at purchase time (`sanitizeLine`, `sanitizeGreeting`).

---

## 7. Delivery jobs (cron worker, not in-process timers)

Recipient emails are enqueued as `delivery_jobs` rows and processed by
`deliverDueJobs()` (`lib/gift-cards/service.ts`). The worker is driven by an
**external scheduler** hitting `POST /api/cron/deliver`
(`app/api/cron/deliver/route.ts`), authorized by a `Bearer ${CRON_SECRET}`
header — not an in-process `setInterval`. Immediate (non-scheduled) deliveries
are also flushed inline right after activation for a snappy dev experience;
because job claiming (`claim_due_delivery_jobs`, `FOR UPDATE SKIP LOCKED`) and
sends are idempotent, both paths are safe.

---

## 8. Request flow — purchase

1. Customer completes the funnel at `app/gift-cards/page.tsx`; the server action
   `createPurchase` (`app/actions/purchase.ts` → `lib/gift-cards/service.ts`)
   runs.
2. `createPurchase` validates the amount **server-side** against
   `system_settings` (never trusts the client), creates a gift card in **draft
   (inactive)** state, and attaches a `pending` payment row.
3. It calls `getPaymentProvider().createCheckoutSession(...)` and returns the
   provider `redirectUrl`. The browser is redirected to the hosted checkout
   (mock: `/checkout/mock`; Grow: grow.link).
4. On approval the provider POSTs a **signed webhook** to
   `/api/webhooks/payment`. `handlePaymentWebhook` (`lib/payments/webhook-handler.ts`)
   verifies the signature, then calls `processVerifiedPaymentEvent`.
5. `processVerifiedPaymentEvent` calls `store.activateFromPayment(...)` which
   (via `activate_gift_card_from_payment`) idempotently activates **exactly one**
   card and writes **exactly one** `initial_credit` ledger entry, reconciling the
   amount. It then issues a receipt, sends the buyer confirmation email, and
   enqueues recipient delivery.
6. Meanwhile the browser sits on `app/checkout/confirmation/page.tsx`, which
   **polls** `getPurchaseStatus` until the card is `paid` — the redirect itself
   is never treated as proof of payment.

## 9. Request flow — redemption

1. A signed-in employee (`app/employee/page.tsx`, gated by `requireUser`/
   `requireRole`) scans the QR (`public_token`) or types the `code`.
2. The employee action asserts `redemption:perform` via `assertPermission`, then
   calls `redeemGiftCard` (`lib/gift-cards/service.ts` → `store.redeem`).
3. `store.redeem` runs the single atomic operation (`redeem_gift_card` in
   Postgres, or the mutex-guarded path in `MemoryStore`): lock → dedupe on
   `idempotency_key` → validate → write ledger debit + redemption + cached
   balance + recomputed status + audit. It returns an outcome code
   (`ok | duplicate | invalid_amount | not_found | not_redeemable | expired |
   insufficient_balance`).
4. A manager (`redemption:reverse`) can later reverse a redemption via
   `reverse_redemption`, which credits the balance back and un-sticks a
   `fully_redeemed` card.
