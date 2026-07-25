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
Payments: **Grow (Meshulam) via Make.com**. Email: **SendGrid**. Accounting: Green Invoice (mock).

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
  Email adapters: `log`, `resend` (abandoned — needs subdomain MX), **`sendgrid`** (live; CNAME auth).
- `app/admin/actions.ts` — `adminMarkPaid` (manual "mark paid & activate" for a paid card whose
  webhook never landed; runs the same verified-activation path). `components/admin/card-actions.tsx`
  shows the **"סימון כשולם והפעלה"** button on pre-activation cards.
- `lib/auth/` — **dual-mode auth**: Supabase Auth (`supabase-auth.ts` + root `middleware.ts`) when
  Supabase is configured; demo cookie auth (`session.ts`/`users.ts`) offline. Roles from `user_roles`.
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

## Current deployment state (LIVE test/demo, real payments proven)

- **Hosting:** Vercel, production branch = `claude/gift-card-system-build-0oflq7`. Live at
  `gift-card-system-8i8e.vercel.app` **and the custom domain `gift.justasecond.co.il`** (attached, blue-check in Vercel).
- **DB:** Supabase project configured; migrations + seed run; `/api/health` → `ok:true`.
- **Payments:** `PAYMENT_PROVIDER=grow` via the **JAS Make.com scenario** (`MAKE_WEBHOOK_URL` set;
  `GROW_*` API keys NOT set — everything goes through Make). A **real ₪-charge was completed
  end-to-end** (Grow charged the card + issued a receipt). ⚠️ The one open item is Grow's
  server-to-server callback (see gotcha #8) — until it lands automatically, activate paid cards
  with the admin **"סימון כשולם והפעלה"** button (`adminMarkPaid`).
- **Email:** ✅ **LIVE + confirmed** (a real card email landed in the inbox via SendGrid).
  `EMAIL_PROVIDER=sendgrid` + `SENDGRID_API_KEY`. **Resend was abandoned** — it needs a
  `send` subdomain **MX** record and Wix DNS cannot create subdomain MX (gotcha #9). SendGrid
  authenticates the domain with **CNAME** records (Wix supports those); `justasecond.co.il` is
  **domain-authenticated in SendGrid**. `EMAIL_FROM="Just A Second <gifts@justasecond.co.il>"`
  (the SENDER; keep the closing `>`). Adapter: `lib/delivery/email/sendgrid.ts` (unit-tested).
  The "for questions" **contact** address in the email body is `settings.businessEmail`
  (`/admin → הגדרות`; set to the real `justasecondil2@gmail.com`) — separate from the sender.
- **Receipt/accounting:** `RECEIPT_PROVIDER=mock` (Green Invoice still unverified). NOTE: this var
  only accepts `mock`|`greeninvoice` — do NOT put `sendgrid` here (that once white-screened admin; now
  guarded, gotcha #3/env `.catch`).
- **Auth (prod):** **Supabase Auth**, NOT the demo accounts. `owner@justasecond.example` +
  `AUTH_DEMO_PASSWORD` ONLY works offline; on the live deploy `login()` routes to Supabase Auth.
  Staff = a Supabase Auth user linked to a `profiles` row + a `user_roles` row (see "Adding staff").
- **₪1 test mode:** `/admin → הגדרות` set **min amount = 1** (custom amounts already on) to buy a
  ₪1 card through the real Grow flow. Revert min to 50 before public launch.
- **Cron:** `vercel.json` runs `/api/cron/deliver` daily (Hobby limit). Immediate delivery
  doesn't need cron.

### Adding staff (production / Supabase Auth)
1. Supabase → Authentication → Users → **Add user** (email + password, ✅ Auto Confirm).
2. Supabase → SQL Editor: link the auth user to a profile + role (most-privileged role wins):
   ```sql
   with au as (select id, email from auth.users where email='them@x.com'),
   prof as (insert into profiles (auth_user_id, email, full_name, is_active)
            select au.id, au.email, 'Full Name', true from au
            on conflict (email) do update set auth_user_id=excluded.auth_user_id, is_active=true
            returning id)
   insert into user_roles (profile_id, role) select prof.id, 'owner' from prof
   on conflict (profile_id, role) do nothing;
   ```
   Roles: `owner`/`admin` = full; `store_manager`, `store_employee` (redemption only), `finance`.
   Deactivate = delete the auth user or set `profiles.is_active=false`. (No in-app staff UI yet.)

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
8. **Grow via Make: three traps.** (a) The JAS Make scenario **hardcodes** notify/success/invoice
   URLs to `just-a-second-website.vercel.app` — for gift cards those MUST be the gift app's URLs
   (`{...}/api/webhooks/payment`, `{...}/checkout/confirmation?ref={order_ref}`), else a paid card
   never activates. (b) Grow rejects an **empty Full Name/phone** with `427 pageFieldSettings[fullName][value]`
   / "Missing parameter 'phone'"; buyer name+phone are now required + guarded in `grow.ts` before
   the Make call. (c) Grow's **server-to-server callback NEVER ARRIVES** — the browser redirect
   works but the POST doesn't, and the card audit log shows **zero** `payment.webhook_*` hits
   **even after** repointing the Make notify URL at the raw Vercel domain
   (`gift-card-system-8i8e.vercel.app/api/webhooks/payment`). So it's **not a domain problem** —
   Grow simply isn't sending server notifications for this Meshulam terminal (IPN/"עדכון שרת" likely
   disabled). The JAS site masks this by showing success optimistically on redirect; our app is
   stricter (activates only on a verified webhook), so the gap surfaces. **THE FIX = ask Grow/Meshulam
   support to enable server-to-server notifications for the terminal** (or, if API keys are ever
   obtained, build confirmation-page polling via `getPaymentStatus`). Meanwhile use `adminMarkPaid`.
   Our activation path is proven working (the manual button runs the same verified path →
   `giftcard.activated`); the ONLY missing link is Grow *sending* the callback.
   `processVerifiedPaymentEvent` audits every outcome (`payment.webhook_<code>`) so any callback that
   DOES arrive-but-doesn't-activate (e.g. `amount_mismatch`) is visible in the card log.
9. **Wix DNS limits dictate the email provider.** Wix **cannot** create subdomain MX records and
   **locks nameservers** on Wix-registered domains (can't move DNS to Cloudflare). Resend REQUIRES a
   `send` subdomain MX → impossible on Wix. **SendGrid** authenticates via **CNAME** (Sender
   Authentication), which Wix supports → that's why email is SendGrid. Same reason a full Cloudflare
   migration was attempted and abandoned (nameservers not editable in Wix).
10. **`serverEnv()` enums use `.catch(default)`** (not just `.default`) + `APP_BASE_URL` is validated
    via `new URL()` with a localhost fallback — a mistyped provider var or base URL must never throw
    (it once white-screened `/admin` because auth calls `serverEnv` on a hot path — see gotcha #3).

## Responsive

Verified across phone (390) / tablet (820) / desktop (1440). Admin has a mobile section nav
(sidebar is desktop-only); tables use `min-w` + `whitespace-nowrap` to scroll instead of squish.

## Cross-browser QR scanner

`components/employee/qr-scanner.tsx` decodes QR **in every browser**: native `BarcodeDetector`
when present (Chrome/Android), else a pure-JS `jsQR` fallback that reads camera frames off a
canvas (Safari + Firefox — neither implements BarcodeDetector). Requires `getUserMedia` (camera
over HTTPS); manual code entry is always the ultimate fallback. Desktops without a webcam use
manual entry. (Regression guard: don't drop the `jsqr` dep or the canvas path — Safari breaks.)

## Status of the live-launch items

- **Grow payments** — ✅ real ₪1 charge + receipt confirmed via Make. ⚠️ auto-activation callback
  **never arrives** (gotcha #8c) — NOT a domain issue; Grow isn't sending server notifications for
  the terminal. **Action: Grow/Meshulam support must enable server-to-server notifications.** Use
  `adminMarkPaid` ("סימון כשולם והפעלה") meanwhile. App side is proven working.
- **Email (SendGrid)** — ✅✅ **DONE + confirmed live** (real card email received in the inbox).
  Free plan = 100/day.
- **₪1 test mode** — ✅ works. Set via `/admin → הגדרות` (min amount = 1) or SQL
  `update system_settings set min_amount_minor=100 where id=1;`. **Revert to 5000 (₪50) before launch.**
- **Green Invoice (accounting)** — ⏳ adapter implemented, still `RECEIPT_PROVIDER=mock`; sandbox-test
  and set `GREENINVOICE_DOC_TYPE` per the accountant, then flip to `greeninvoice`.
- **Settings save** — fixed: it silently swallowed DB write errors + didn't revalidate the public
  funnel; now surfaces errors and revalidates `/gift-cards` + `/`.
- **Remaining non-code work:** update `businessEmail`→`justasecondil2@gmail.com` + real store phone in
  settings; legal/privacy review; Hebrew PDF font drop-in at `public/fonts/NotoSansHebrew-Regular.ttf`;
  revert `min amount` 1 → 50 before launch; add the "Buy a Gift Card" button on the Wix site; rotate
  any secrets shared in chat; Sentry DSN; Supabase backups. Optional code: an in-`/admin`
  staff-management page (invite by email + role) to avoid SQL.
