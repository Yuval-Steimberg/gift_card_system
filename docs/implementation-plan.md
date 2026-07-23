# gift_card_system — Implementation Plan & Checklist

A standalone digital gift-card platform for **Just A Second** (physical retail).
Purchased online → delivered digitally → redeemed in-store. Independent of Wix.

## Architecture at a glance

```
Next.js (App Router, TS strict)
├── app/(public)          marketing + purchase funnel  (customer, no account)
├── app/gift/[token]      recipient gift-card view (secure random token)
├── app/employee         redemption app (auth: employee/manager)
├── app/admin            dashboard (auth: owner/admin/finance/…)
├── app/api              route handlers: checkout, webhook, status, cron
├── components/ui        shadcn-style primitives (JAS design tokens)
├── lib
│   ├── money            integer minor units (agorot) — NEVER float
│   ├── gift-cards       code + secure token gen, status machine, ledger service
│   ├── payments         PaymentProvider interface + mock + grow adapter
│   ├── delivery         email abstraction (dev-log + resend) + delivery jobs
│   ├── accounting       ReceiptProvider interface + mock + greeninvoice stub
│   ├── security         webhook verification, rate limiting, safe text
│   ├── permissions      RBAC roles + server-side guards
│   ├── data             store interface: MemoryStore (offline) + SupabaseStore
│   └── validation       Zod schemas (shared client+server)
└── supabase/migrations  SQL schema, RLS, redeem_gift_card(), seed.sql
```

### Key architectural decisions (with rationale)

1. **Integer minor units (agorot).** ₪249.90 → `24990`. DB `bigint`. No floating point for money, ever.
2. **Immutable ledger is the source of truth.** `gift_card_ledger_entries` (signed amounts). The
   `gift_cards.balance_minor` column is a cached total, updated **atomically** with each ledger insert.
3. **Redemption is one atomic DB operation.** Production: `redeem_gift_card()` plpgsql function using
   `SELECT … FOR UPDATE` row lock + idempotency-key uniqueness. App code never does read-modify-write.
4. **Two separate identifiers.** A human-readable `code` (Crockford base32, checksum, e.g.
   `JAS-XXXX-XXXX-C`) for manual entry, and a long cryptographically-random `public_token` for
   links/QR. Neither exposes DB ids, balance, or PII. Token is revocable & rotated on reissue.
5. **Payment is proven only by a verified server-side webhook.** Browser redirects are never trusted.
   All webhook processing is idempotent (`payment_events` unique + `idempotency_keys`).
6. **Provider abstractions** for payment, email, and accounting, each with a mock/dev adapter so the
   whole system runs locally with **zero external credentials**.
7. **Offline-capable data layer.** `MemoryStore` (seeded) is the default so the app boots and the full
   flow works without Supabase; `SupabaseStore` activates when env is configured. The production
   atomic guarantee lives in the SQL function; `MemoryStore` mirrors it with a mutex for tests/demo.

## MVP scope (what "done" means)

The full Definition of Done from the brief. Concretely, the MVP delivers, end to end:
purchase (preset/custom amount, design, buyer, recipient, greeting, timing, review, **mock** pay) →
verified webhook activates exactly one card + one initial ledger credit → recipient page (code, QR,
balance, PDF) → dev-email delivery → employee sign-in → scan/lookup → partial then final redemption
(atomic, idempotent, no overspend/double-spend) → manager reversal → admin search, detail (ledger +
audit), lifecycle actions → RBAC enforced server-side → unit+integration+e2e tests → CI green → docs.

## Environment variables / external credentials required

All optional for local dev (mocks kick in). See `.env.example`. Required only for production:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`PAYMENT_PROVIDER` (`mock`|`grow`), `GROW_*`, `PAYMENT_WEBHOOK_SECRET`, `EMAIL_PROVIDER`
(`log`|`resend`), `RESEND_*`, `RECEIPT_PROVIDER` (`mock`|`greeninvoice`), `GREENINVOICE_*`,
`APP_BASE_URL`, `BUSINESS_TIMEZONE`, `CRON_SECRET`, `SENTRY_DSN` (optional).

## Documented assumptions

- **Currency ILS only** for the MVP; the money layer is currency-tagged for future multi-currency.
- **Email is the only required delivery channel**; SMS/WhatsApp are stubbed interfaces.
- **Grow** is the intended production provider (reference-repo compatible) but is behind the interface
  and unverified until real credentials + Make.com scenario exist. Mock is the default.
- **Accounting treatment** (receipt vs. tax invoice at purchase vs. at redemption) **must be confirmed
  by the business's Israeli accountant** — the code is structured to adapt without a rewrite.
- **Legal/privacy** (consumer gift-card law, data retention, Israeli Privacy Protection Law) **must be
  reviewed by an Israeli lawyer**. This app is **not** represented as legally certified.
- Local demo uses `MemoryStore`; production uses Supabase migrations. Both are first-class.

## Phased checklist

### Phase 1 — Foundation
- [x] Repo inspected (empty) + reference audited (`docs/just-website-repository-audit.md`)
- [x] Architecture plan (this file)
- [x] Next.js + TS strict + Tailwind + tokens + UI primitives
- [x] Env validation (Zod) + `.env.example`
- [x] ESLint + Prettier + Supabase clients

### Phase 2 — Database & security
- [x] Migrations: all tables, enums, constraints, indexes (`supabase/migrations/0001_init.sql`)
- [x] RLS policies (deny-by-default; codes/balances never anon-readable) (`0002_rls.sql`)
- [x] Ledger model + `redeem_gift_card()` atomic function + reversal/adjust/reissue (`0003_functions.sql`)
- [x] Seed data (`supabase/seed.sql`) + `MemoryStore` seed mirror

### Phase 3 — Public purchase flow
- [x] Multi-step funnel + Zod validation + live preview
- [x] Order creation (inactive) + mock payment + provider abstraction
- [x] Idempotent, signature-verified webhook + confirmation page with safe polling

### Phase 4 — Generation & delivery
- [x] Code + secure token + QR + PDF (Hebrew-capable) + email templates + delivery jobs + retries

### Phase 5 — Employee redemption
- [x] Auth + QR scanner + manual lookup + partial/full redemption + reversal + offline guard

### Phase 6 — Admin dashboard
- [x] Overview + searchable/filterable table + detail (ledger+audit) + lifecycle actions
- [x] Template management + system settings + reports + CSV export + server-side RBAC

### Phase 7 — Quality
- [x] Unit + integration (financial) tests + e2e specs + RTL + CI + docs
      (validated: concurrent-redemption overspend prevention, webhook idempotency, forged-webhook rejection)

## Progress log

Kept current as work proceeds; see also the per-area task list.
