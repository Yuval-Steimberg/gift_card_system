# gift_card_system — Project Memory

> Read this first. It's the durable context for the Just A Second digital gift-card platform:
> what it is, how it's built, how it's deployed today, the gotchas we already hit, and what's
> left to make it a real production system. Design tokens/brand rules are inherited from the
> Just A Second design system (see `docs/just-website-repository-audit.md`).

## What this is

A standalone digital gift-card platform for the **Just A Second** physical store (Tel Aviv,
Menachem Begin 34). Buy online → deliver digitally → redeem in-store. Independent of Wix.
Hebrew-first (RTL), bilingual.

## Tech stack

Next.js 14 (App Router) · React 18 · TypeScript (strict) · Tailwind + JAS design tokens ·
Radix primitives · Zod · Supabase/PostgreSQL (RLS + plpgsql atomic functions) · pdf-lib · qrcode ·
Vitest · Playwright · ESLint/Prettier · GitHub Actions.

## Non-negotiable architecture rules

- **Money is integer minor units (agorot).** ₪249.90 → `24990`. NEVER floats. See `lib/money.ts`.
- **Immutable ledger is the source of truth.** `gift_cards.balance_minor` is a cache updated
  atomically with each `gift_card_ledger_entries` row.
- **Redemption is ONE atomic op.** Prod: `redeem_gift_card()` plpgsql (`SELECT … FOR UPDATE` +
  unique idempotency key). Offline: per-card mutex in `MemoryStore`. Never read-modify-write.
- **Payment is proven only by a signed, verified webhook.** Browser redirects are never trusted.
  Activation is idempotent (one card, one initial credit) — `payment_events` unique + RPC.
- **RBAC enforced server-side** on every action (`assertPermission` in `lib/auth/guards.ts`).
  Hiding a UI button is never authorization.
- **Provider abstractions** (payment/email/receipt) each with a mock/dev adapter + a real adapter.

## How it runs (two modes, one interface)

`lib/data/store.ts` defines `GiftCardStore`. `getStore()` (`lib/data/index.ts`) picks:
- **MemoryStore** (default, offline) — seeded, mutex-atomic. Used when Supabase env is absent.
  This is the local-dev + test target. Data is ephemeral.
- **SupabaseStore** (production) — when `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  are set. Atomic ops delegate to the SQL functions in `supabase/migrations/0003_functions.sql`.

## Key files / directories

- `lib/money.ts` — minor-unit money. `lib/gift-cards/` — types, codes/tokens, status machine,
  ledger, PDF, QR, service (orchestration), admin-service (stats + lifecycle).
- `lib/data/` — store interface, MemoryStore, SupabaseStore, supabase-client, seed-data.
- `lib/payments|delivery/email|accounting/` — provider interfaces + mock + real adapters + factory.
- `lib/auth/` — demo cookie auth (session/users/guards). **Replace with Supabase Auth for prod.**
- `lib/env.ts` — env parsing. **Only parses; must NOT throw for provider config** (see gotcha #3).
- `app/` — `(public)` landing + `/gift-cards` funnel, `/gift/[token]` recipient, `/employee`,
  `/admin`, `/api` (webhooks/payment, cron/deliver, health).
- `supabase/migrations/000{1,2,3}.sql` + `seed.sql` + `setup.sql` (all-in-one).
- `app/api/health/route.ts` — diagnostic endpoint (store, tables, admin-query probes, auth probe,
  env flags). Invaluable for debugging deployments.

## Commands

```bash
npm run dev            # local dev (memory store, no creds needed) → :3000
npm test               # 43 unit + integration tests (money, concurrency, idempotency)
npm run typecheck / lint / build
npm run verify:supabase   # exercise the LIVE Supabase (tables + atomic RPC cycle). Needs .env.local
npm run verify:email you@x # send a real Resend test email. Needs RESEND_API_KEY + EMAIL_FROM
```

## Current deployment state (test/demo)

- **Hosting:** Vercel, production branch = `claude/gift-card-system-build-0oflq7`. Live at
  `gift-card-system-8i8e.vercel.app` (custom domain not yet attached).
- **DB:** Supabase project configured; migrations + seed run; `/api/health` → `ok:true`.
- **Payments:** `PAYMENT_PROVIDER=mock` (no real charges).
- **Email:** `EMAIL_PROVIDER=resend` (verify the key/domain with `verify:email`).
- **Auth:** demo cookie auth. Staff login `owner@justasecond.example` + `AUTH_DEMO_PASSWORD`.
- **Cron:** `vercel.json` runs `/api/cron/deliver` daily (Hobby limit). Immediate delivery
  doesn't need cron.

To go from this test deploy to **real production**, follow `docs/GO-LIVE-PRODUCTION.md`.

## Gotchas we already hit (don't repeat these)

1. **Supabase must be seeded, not just migrated.** Empty `system_settings` → pages error.
   Run `supabase/setup.sql` (all-in-one) in the SQL Editor. Confirm via `/api/health`
   (`migrationsRan`, `seedRan`, per-table counts).
2. **Vercel env-var changes need a redeploy** to take effect. If a var "isn't working," check
   `/api/health` `build`/`env` flags to confirm the LIVE deploy actually has it.
3. **`serverEnv()` must never throw for provider config.** It's called on hot paths (auth session
   signing). Provider-credential checks live in each factory (`getPaymentProvider` /
   `getEmailProvider` / `getReceiptProvider`), NOT in `serverEnv()`. (A missing email key once took
   down admin + checkout because auth called a throwing `serverEnv`.)
4. **Errors thrown in a `layout.tsx` are not caught by that segment's `error.tsx`.** The admin
   layout runs auth first; a throw there white-screens. That's why `/api/health` (which skips auth)
   stayed green while `/admin` 500'd.
5. **Login uses `AUTH_DEMO_PASSWORD`** (trimmed) or `password` if unset. Browser autofill can inject
   a different saved credential — clear the field and type manually. `/api/health` reports
   `AUTH_DEMO_PASSWORD_SET` + `AUTH_DEMO_PASSWORD_LEN` to diagnose.
6. **Static prerender vs runtime env/DB.** Pages that read settings/DB are `export const dynamic =
   'force-dynamic'` so the build never depends on runtime env or a live DB.
7. **Vercel Hobby crons are daily only** (`0 9 * * *`); `*/5` needs Pro.

## Responsive

Verified across phone (390) / tablet (820) / desktop (1440). Admin has a mobile section nav
(sidebar is desktop-only); tables use `min-w` + `whitespace-nowrap` to scroll instead of squish.

## Known limitations (still mock/unverified — see production guide)

- Grow payment adapter **mirrors the existing JAS website exactly** (Make.com scenario → Grow, with
  a direct Grow REST fallback; same fields + webhook parsing; unit-tested in `tests/unit/grow.test.ts`)
  but still needs a **live transaction test** before launch. Set `PAYMENT_PROVIDER=grow` + `GROW_*`
  (+ optional `MAKE_WEBHOOK_URL`). Green Invoice receipt adapter is still a stub. Demo auth is not
  production-grade. Legal/privacy/accounting need professional review. Hebrew PDF glyphs need a font
  drop-in at `public/fonts/NotoSansHebrew-Regular.ttf`.
