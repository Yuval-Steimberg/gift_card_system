# Deploy a shareable TEST instance (Vercel + Supabase, mock payments)

This gets a public URL you can share with testers. **No real money changes hands** —
payments use the mock provider, so testers click “approve” and the full signed-webhook
activation runs, but nothing is charged.

> A shared, multi-user deployment **requires Supabase** for persistence. Vercel runs the
> app across serverless instances, so the in-memory store won’t work there (each request
> could hit a different instance, and state resets on cold start).

## Prerequisites
- A GitHub account with this repo pushed (branch `claude/gift-card-system-build-0oflq7`).
- A free [Supabase](https://supabase.com) account.
- A free [Vercel](https://vercel.com) account.

## Step 1 — Create the database (Supabase)
1. Create a new Supabase project. Note the project URL and keys under **Settings → API**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**secret** — server only)
2. Open **SQL Editor** and run each migration file in order (copy-paste the file contents):
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_rls.sql`
   - `supabase/migrations/0003_functions.sql`
3. Run `supabase/seed.sql` to load the card designs, the store location and the
   system-settings row (required — the app errors without settings). It creates **no**
   gift cards: `/admin` starts at zero and only ever shows real sales. If this database
   was seeded with the old demo cards, run `supabase/cleanup-demo-data.sql` to purge them.

   Alternatively, with the Supabase CLI: `supabase db push` then `psql "$DB_URL" -f supabase/seed.sql`.

## Step 1.5 — Verify the database (one command, catches problems early)
Before deploying, confirm the migrations + seed are correct and the atomic RPCs work against
your live Supabase. Put `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in a local
`.env.local` (or export them), then run:

```bash
npm run verify:supabase
```

It checks every required table, confirms the seed ran, then runs a real
**activate → redeem → duplicate-guard → public-view** cycle on a throwaway card and asserts the
`balance == SUM(ledger)` invariant — cleaning up after itself. Green ✅ means the production data
layer is good to go; any ❌ names the exact table/RPC to fix.

## Step 2 — Deploy the app (Vercel)
1. Vercel → **Add New → Project → Import** this GitHub repo.
2. Framework preset auto-detects **Next.js**. Leave build/output defaults.
3. Add **Environment Variables** (Production + Preview):

   | Variable | Value |
   | --- | --- |
   | `APP_BASE_URL` | your Vercel URL, e.g. `https://your-app.vercel.app` |
   | `NEXT_PUBLIC_SUPABASE_URL` | from Step 1 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from Step 1 (secret) |
   | `PAYMENT_PROVIDER` | `mock` |
   | `PAYMENT_WEBHOOK_SECRET` | any long random string |
   | `AUTH_SECRET` | any long random string |
   | `AUTH_DEMO_PASSWORD` | a private staff password (replaces `password`) |
   | `CRON_SECRET` | any long random string |
   | `BUSINESS_TIMEZONE` | `Asia/Jerusalem` |
   | `EMAIL_PROVIDER` | `resend` (so recipients get real gift emails — see Step 2.5) |
   | `RESEND_API_KEY` | from Resend (Step 2.5) |
   | `EMAIL_FROM` | `Just A Second <gifts@yourdomain.com>` (a verified Resend sender) |

   > Set `APP_BASE_URL` **after** the first deploy if you don’t know the URL yet, then redeploy.
   > It must match the live origin so the confirmation/recipient links and the webhook URL are correct.

4. Deploy. The included `vercel.json` schedules the delivery worker (`/api/cron/deliver`)
   **once a day** (`0 9 * * *`) — the Vercel **Hobby** plan only allows daily cron jobs. Vercel
   auto-authorizes it with your `CRON_SECRET`. This only affects *scheduled* gift cards (they’ll
   send at the daily run); **immediate** delivery — the default and the main test path — happens
   at purchase time and does **not** use cron. On the Pro plan you can raise the frequency, e.g.
   `*/5 * * * *`, if you want scheduled cards to go out closer to their chosen time.

## Step 2.5 — Set up real emails (Resend)
So recipients actually receive their gift card (not just a preview file), use Resend:

1. Create a free account at [resend.com](https://resend.com) → **API Keys → Create** →
   copy the key into `RESEND_API_KEY`.
2. **Verify a sending domain** (Resend → Domains → add your domain, add the DNS records it
   shows). Then set `EMAIL_FROM` to an address on that domain, e.g.
   `Just A Second <gifts@yourdomain.com>`.
3. Test it end to end **before** deploying — with `RESEND_API_KEY` + `EMAIL_FROM` in `.env.local`:

   ```bash
   npm run verify:email you@yourdomain.com
   ```

   A green ✓ means gift + confirmation emails will send. A ✗ prints Resend’s exact reason
   (almost always an unverified `from` domain).

> **Quick test without your own domain:** you can set
> `EMAIL_FROM='Just A Second <onboarding@resend.dev>'` and Resend will send — but only to the
> email address that owns your Resend account. Verify a real domain to email arbitrary recipients.

If you’d rather skip email for the first round, set `EMAIL_PROVIDER=log` instead; recipients then
open their card via the confirmation-page link (no email is sent — the log adapter writes to the
server’s ephemeral filesystem on Vercel).

## Step 3 — Verify the live deployment
1. Open `https://your-app.vercel.app` → **רכישת שובר** → complete the steps → on the mock
   checkout click **אישור ותשלום** → you should reach **“התשלום אושר”** with a code.
2. Click **צפייה בשובר** → the recipient page shows balance + QR + PDF.
3. `https://your-app.vercel.app/employee` → sign in with a staff email (below) and your
   `AUTH_DEMO_PASSWORD` → redeem the card.
4. `https://your-app.vercel.app/admin` → sign in as the owner → find the card, view its ledger.

If any page 500s, check Vercel’s **Runtime Logs** — the most likely cause is a missing/incorrect
Supabase env var or a migration that didn’t run.

## What to tell your testers
- Share the base URL and say **“Buy a Gift Card”** / `/gift-cards`.
- Tell them the checkout is a **test** — clicking approve does **not** charge anything.
- Ask them **not to enter real personal data** (this is a test build; legal/privacy review is pending).
- If you want testers to try the staff side, share a staff email + your `AUTH_DEMO_PASSWORD`.

**Staff logins** (all use `AUTH_DEMO_PASSWORD`):
`owner@justasecond.example`, `manager@justasecond.example`, `employee1@justasecond.example`,
`finance@justasecond.example`.

## Emails
This guide uses **Resend** (`EMAIL_PROVIDER=resend`) so recipients get real gift emails — set up
and tested in Step 2.5 via `npm run verify:email`. Resend requires a verified sending domain; until
one is verified you can only send to the address that owns the Resend account (or use the
`onboarding@resend.dev` sender for a quick self-test).

The alternative, `EMAIL_PROVIDER=log`, writes previews to the server filesystem — **ephemeral on
Vercel**, so recipients get nothing; they’d open the card from the confirmation-page link instead.
Good for a first smoke test, not for a real recipient experience.

## Important caveats for a test share
- This is a **test build**: mock payments, demo staff accounts, and unverified accounting/legal.
  Do not treat issued cards as real financial instruments.
- The `SupabaseStore` adapter is validated against the schema but hasn’t been run against a live
  Supabase before — do the Step 3 verification right after deploying. If something breaks, the
  Vercel runtime logs will point to the exact table/RPC.
- To go **fully** live later (real Grow payments, real receipts, legal/privacy sign-off), follow
  `docs/production-checklist.md`.
