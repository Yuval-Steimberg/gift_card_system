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
   the Make call. (c) **Grow's callback is a GLOBAL webhook, not the per-request notify_url** — set in Grow →
   הגדרות → ניהול ווהבוקים (webhooks), type "עדכון לאחר ביצוע עסקה", scope "כל העסקאות". A single
   global webhook fires for ALL transactions and OVERRIDES the per-transaction notify_url we send in
   Make — which is why the Make notify_url never mattered. The pre-existing "Just A Second Website"
   webhook pointed at a **dead JAS Netlify URL** (`fabulous-chaja-618dfe.netlify.app`), so gift-card
   payments were being POSTed there into the void. **THE FIX = add a Grow webhook "Just A Second Gift
   Cards" → `https://gift-card-system-8i8e.vercel.app/api/webhooks/payment`, active, all transactions,
   and disable the old dead JAS one** (Grow may fire only one). Diagnosed by pointing the webhook at
   webhook.site and capturing the real payload.
   (d) **Grow's Payment-Links webhook payload:** amount is `paymentSum` (NOT `sum`), payer is
   `payerEmail`, id is `transactionCode`/`asmachta`, and it **omits our order_ref/custom field**. So
   `verifyWebhook` reads `paymentSum`/`payerEmail`, and `processVerifiedPaymentEvent` resolves the
   card by order_ref → else by the newest pending card matching **payer email + exact amount**
   (`findPendingCardIdByEmailAndAmount`). Idempotency stays on the provider event id; unmatched
   callbacks log `payment.webhook_unmatched`. `adminMarkPaid` remains the manual backup.
9. **Wix DNS limits dictate the email provider.** Wix **cannot** create subdomain MX records and
   **locks nameservers** on Wix-registered domains (can't move DNS to Cloudflare). Resend REQUIRES a
   `send` subdomain MX → impossible on Wix. **SendGrid** authenticates via **CNAME** (Sender
   Authentication), which Wix supports → that's why email is SendGrid. Same reason a full Cloudflare
   migration was attempted and abandoned (nameservers not editable in Wix).
10. **`serverEnv()` enums use `.catch(default)`** (not just `.default`) + `APP_BASE_URL` is validated
    via `new URL()` with a localhost fallback — a mistyped provider var or base URL must never throw
    (it once white-screened `/admin` because auth calls `serverEnv` on a hot path — see gotcha #3).

## Gift-card PDF — Hebrew rendering (fixed; don't regress)

`lib/gift-cards/pdf.ts` embeds **Heebo** (`public/fonts/Heebo-Regular.ttf`, Hebrew + Latin +
digits; Noto Sans Hebrew is a Hebrew-only fallback) via fontkit, `subset:false` (the variable
font can fail to subset). **Draw Hebrew in LOGICAL order — do NOT reverse it.** pdf-lib + fontkit
already lay an embedded Hebrew font out RTL correctly; a naive per-line reversal double-flips it
into gibberish (this was the bug — verified by rendering the PDF to PNG with pymupdf). Keep every
line **single-script**: mixed Latin+Hebrew in one `drawText` reverses the Hebrew part, so labels
(`To:`/`From:`/`Message:`/`Code`+`קוד`, `GIFT CARD`+`שובר מתנה`) are drawn separately from Hebrew
values. Greeting wraps on word boundaries. The recipient web page (`/gift/[token]`) also shows the
full message in a dedicated "הודעה אישית" section (the card-art preview clamps to ~2 lines).
To eyeball changes: generate a card and `python3 -c "import fitz; ...get_pixmap().save('x.png')"`.

## Performance (admin felt slow — fixed; keep these)

- **`loading.tsx` per area** (`app/admin`, `app/gift-cards`, `app/employee`, `app/gift/[token]`)
  streams an instant skeleton so navigation isn't a frozen page while `force-dynamic` pages fetch.
- **`getCurrentUser()` is wrapped in React `cache()`** — the layout + page + actions in one request
  share ONE auth resolution instead of each re-hitting Supabase.
- **`supabaseCurrentUser()` parallelizes** its roles + store-location lookups.
- **No N+1 on the dashboard:** `getAdminStats` uses `store.countCardsWithFailedDelivery()` (one
  aggregate query) instead of looping `getDeliveryJobs(cardId)` per card. (Still loads all cards to
  sum totals in JS — fine for hundreds; move to a SQL aggregate if it reaches thousands.)

## Responsive

Verified across phone (390) / tablet (820) / desktop (1440). Admin has a mobile section nav
(sidebar is desktop-only); tables use `min-w` + `whitespace-nowrap` to scroll instead of squish.

## Checkout field validation (hardened — don't loosen without reason)

`lib/validation/purchase.ts` is the source of truth (Zod), mirrored client-side in
`components/checkout/purchase-wizard.tsx` and backstopped in `lib/payments/grow.ts`:
- **buyerName + recipientName** must be a **real full name** (first + last, Hebrew/Latin letters
  only, no digits/symbols) via shared `isFullName()`. Grow 427-rejects a bad `fullName`, so this is
  load-bearing — a single word / digits / empty name is exactly what caused `pageFieldSettings[fullName]`.
- **buyerPhone + recipientPhone** are **required** valid Israeli mobiles (recipient phone was made
  required per the owner; flip back to optional-but-validated if conversion suffers).
- **buyerEmail + recipientEmail** get **strict, 3-layer email validation** (see below).
- The wizard blocks advancing per step, shows inline errors as you type, and on any server
  rejection **names the exact field(s) + jumps to the failing step** (no more dead-end generic
  "יש לתקן את השדות המסומנים" on the summary). Tests: `tests/unit/purchase-validation.test.ts`.

### Email validation (3 layers — syntax, typo, deliverability)
`lib/validation/email.ts` (client-safe, no deps) exports `checkEmail()` / `isValidEmail()`:
1. **Syntax** — no spaces, exactly one `@`, valid local part, valid domain labels, TLD 2–24
   letters, no double dots / leading-trailing hyphens. Rejects `yuval @gmail.com`, `x@gmail`,
   `x@gmail.123`, `.x@a.com`, etc.
2. **Typo detection** — a curated `KNOWN_TYPOS` table (`gmial.com`→`gmail.com`, `gmail.co`,
   `gmail.con`, …) plus Levenshtein-distance-1 vs `POPULAR_DOMAINS` → blocks with a Hebrew
   suggestion `האם התכוונת ל-<addr>?` (also exposed as `.suggestion`). The wizard shows this
   exact message inline.
3. **Deliverability (server-only, async)** — `lib/validation/email-deliverability.ts`
   `domainCanReceiveMail()` does an MX lookup (falls back to A/AAAA) via `node:dns/promises`.
   **Fail-OPEN**: only a definitively non-existent domain (`ENOTFOUND`/`ENODATA`) is rejected;
   transient DNS errors never block a real buyer. `startPurchase` runs it for buyer+recipient
   **in parallel** after Zod passes, returns per-field `fieldErrors` if a domain is unreachable.
- ⚠️ **Keep the DNS check in its OWN module** (`email-deliverability.ts`, NOT `email.ts`): the
  client purchase wizard imports `checkEmail` from `email.ts`, and any `node:dns` import in that
  file **fails the client webpack build** (`UnhandledSchemeError: node:dns/promises`). That's why
  it's split. Tests: `tests/unit/email-validation.test.ts` (syntax + typo; DNS is not unit-tested).

## Cross-browser QR scanner

`components/employee/qr-scanner.tsx` decodes QR **in every browser**: native `BarcodeDetector`
when present (Chrome/Android), else a pure-JS `jsQR` fallback that reads camera frames off a
canvas (Safari + Firefox — neither implements BarcodeDetector). Requires `getUserMedia` (camera
over HTTPS); manual code entry is always the ultimate fallback. Desktops without a webcam use
manual entry. (Regression guard: don't drop the `jsqr` dep or the canvas path — Safari breaks.)

## Status of the live-launch items

- **Grow payments** — ✅ real ₪1 charge + receipt confirmed. Auto-activation: Grow WAS firing all
  along, but via a **global webhook** aimed at a dead JAS Netlify URL (gotcha #8c). Fixed by adding a
  dedicated Grow webhook → the gift app + parsing Grow's real payload (`paymentSum`/`payerEmail`, no
  order_ref → match by email+amount, gotcha #8d). Pending: confirm one live ₪1 payment shows
  `giftcard.activated · verified payment` (not `manual_activate`). `adminMarkPaid` is the backup.
- **Email (SendGrid)** — ✅✅ **DONE + confirmed live** (real card email received in the inbox).
  Free plan = 100/day.
- **₪1 test mode** — ✅ works. Set via `/admin → הגדרות` (min amount = 1) or SQL
  `update system_settings set min_amount_minor=100 where id=1;`. **Revert to 5000 (₪50) before launch.**
- **Green Invoice (accounting)** — ⏳ adapter implemented, still `RECEIPT_PROVIDER=mock`; sandbox-test
  and set `GREENINVOICE_DOC_TYPE` per the accountant, then flip to `greeninvoice`.
- **Settings save** — fixed: it silently swallowed DB write errors + didn't revalidate the public
  funnel; now surfaces errors and revalidates `/gift-cards` + `/`.
- **Hebrew gift-card PDF** — ✅ fixed (Heebo embedded, logical-order rendering; greeting/recipient/
  sender now show on the PDF + the recipient web page). See the PDF section above.
- **Remaining non-code work:** update `businessEmail`→`justasecondil2@gmail.com` + real store phone in
  settings; set gift-card **expiry to 4 months** in `/admin → הגדרות` (the new landing copy says 4);
  legal/privacy review; revert `min amount` 1 → 50 before launch; add the "Buy a Gift Card" button on
  the Wix site; rotate any secrets shared in chat; Sentry DSN; Supabase backups. Optional code: an
  in-`/admin` staff-management page (invite by email + role) to avoid SQL.
