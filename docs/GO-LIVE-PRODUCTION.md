# Go-Live: From Test Deploy → Real Production

You currently have a **working test deployment** (Vercel + Supabase, mock payments, demo auth).
This guide takes it to a **real, revenue-handling production system**, step by step, with the exact
commands and **where to find every piece of data**.

> Legend: 🔧 = config only · 💻 = code/dev work · 📄 = paperwork/3rd-party · ⚠️ = must not skip.

**Order matters.** Do 1→3 first (domain, auth, payments) — everything else layers on top.

---

## 0. What "real production" adds vs. your test deploy

| Area | Test (now) | Real production |
| --- | --- | --- |
| Payments | mock (no charges) | **Grow** (real Israeli cards/Bit/Apple-Google Pay) |
| Staff login | demo cookie + shared password | **Supabase Auth** (real users, MFA) |
| Email | Resend (needs domain) | Resend with verified domain |
| Receipts | mock | **Green Invoice/Morning** (accountant-confirmed) |
| Domain | `*.vercel.app` | `gift.justasecond.co.il` |
| Legal | placeholder terms | lawyer-reviewed terms + privacy |
| Monitoring | none | Sentry + alerts + backups |

---

## 1. 🔧 Custom domain

1. **Vercel → your project → Settings → Domains → Add** → enter `gift.justasecond.co.il`.
2. Vercel shows a **CNAME** (or A) record. Add it at your **domain registrar / DNS host**
   (wherever justasecond.co.il DNS lives — likely the Wix/registrar DNS panel).
3. Wait for "Valid Configuration", then in **Vercel env vars** set:
   ```
   APP_BASE_URL = https://gift.justasecond.co.il
   ```
   **Redeploy** (env changes need a redeploy). This must match the live origin or QR/links/webhooks break.

---

## 2. 🔧⚠️ Real staff authentication (Supabase Auth) — CODE DONE

✅ **Code is implemented.** The auth layer is now dual-mode: when Supabase is configured it uses
**Supabase Auth** (`lib/auth/supabase-auth.ts` + `middleware.ts`), pulling the role from
`user_roles` via `profiles.auth_user_id`; offline it falls back to demo auth. No code change needed
— just create the users and grant roles.

**Where the data lives:** Supabase → **Authentication** (users) + your `profiles`/`user_roles`
tables (created by `0001_init.sql`).

**Steps (config only):**
1. Supabase → **Authentication → Providers** → enable **Email**. Turn on **email confirmations**;
   enable **MFA** for privileged users (Authentication → settings).
2. Supabase → **Authentication → Users → Add user** for each staff member → copy each **User UID**.
3. In **SQL Editor**, link each auth user to a profile + role:
   ```sql
   -- 1) create the profile linked to the auth user (or update the seeded one)
   insert into profiles (auth_user_id, email, full_name)
   values ('<auth-user-uid>', 'noa@justasecond.co.il', 'נעה ברנט')
   on conflict (email) do update set auth_user_id = excluded.auth_user_id;
   -- 2) grant a role (owner/admin/store_manager/store_employee/finance/read_only)
   insert into user_roles (profile_id, role)
   values ((select id from profiles where email='noa@justasecond.co.il'), 'owner')
   on conflict do nothing;
   ```
4. **Delete `AUTH_DEMO_PASSWORD`** from Vercel (no longer used once Supabase Auth is on). Redeploy.
5. Test: log in at `/employee/login` with the staff email + the password you set in Supabase.

> Sign-in accepts only users who have a `profiles` row + a `user_roles` grant — anyone else is
> rejected as "no staff permissions".

---

## 3. 💻📄⚠️ Real payments — Grow (grow.link / Meshulam)

The `GrowPaymentProvider` (`lib/payments/grow.ts`) is modeled **exactly on the existing Just A
Second website** (Make.com scenario → Grow, with a direct Grow REST fallback), so it plugs into the
business's existing Grow account + Make scenario. It sends the same fields (`price`/`fullName`/
`phone`/… + `success_url`/`cancel_url`/`notify_url`) and parses the same webhook
(`transactionCode`/`asmachta`, `cField1`, `sum`, `statusCode`). Verified by unit tests
(`tests/unit/grow.test.ts`); still do a live transaction test before launch.

**Where to get the data:** the business's existing **Grow account** (grow.link) + **Make.com**
scenario (the same ones the current website uses). You'll need:
- `GROW_API_KEY` (userId), `GROW_API_SECRET` (apiKey), `GROW_PAGE_CODE` — from the Grow dashboard.
- `MAKE_WEBHOOK_URL` — the Make.com webhook URL of the existing "create Grow payment" scenario
  (optional; leave empty to call Grow's REST API directly instead).

**Steps:**
1. In Vercel env (reuse the SAME values the current site uses):
   ```
   PAYMENT_PROVIDER      = grow
   GROW_API_KEY          = <from Grow>
   GROW_API_SECRET       = <from Grow>
   GROW_PAGE_CODE        = <from Grow>
   GROW_API_URL          = https://restapi.grow.link
   MAKE_WEBHOOK_URL      = <your existing Make.com scenario URL>   # optional
   PAYMENT_WEBHOOK_SECRET = <long random>                          # see step 3
   ```
   Generate a secret: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
2. Point the payment **notify/callback** to `https://gift.justasecond.co.il/api/webhooks/payment`
   (the adapter already sends this as `notify_url`; make sure the Make scenario forwards it to Grow).
3. **(Recommended) Lock down the webhook.** The reference site did no signature check. This adapter
   accepts an OPTIONAL shared secret: add a `secret` field (= your `PAYMENT_WEBHOOK_SECRET`) to the
   Make scenario's call to `/api/webhooks/payment`, and the adapter will require it. Even without it,
   forgery is contained (unguessable UUID order ref + amount reconciliation + one-time activation).
4. **Redeploy** (env changes need it).
5. ⚠️ **Test with one real low-value transaction** (e.g. ₪50): confirm the webhook is received, the
   amount reconciles, exactly one card activates, and a receipt + delivery fire. Check
   `/admin/gift-cards/<id>` ledger + audit.
6. Test a **refund** from `/admin` and confirm Grow processes it.

> Alternative: Stripe is in the deps but unused. If the business qualifies for Stripe ILS, a
> `StripePaymentProvider` can be added behind the same `PaymentProvider` interface.

---

## 4. 🔧 Real email — Resend verified domain

You already use Resend. For production, verify a **real sending domain** so you can email any recipient.

**Where:** [resend.com](https://resend.com) → **Domains → Add Domain** → add the shown DNS records
(SPF/DKIM/DMARC) at your DNS host → wait for "Verified". Then:
```
EMAIL_PROVIDER = resend
RESEND_API_KEY = <Resend → API Keys>
EMAIL_FROM     = Just A Second <gifts@justasecond.co.il>
```
Verify end-to-end: `npm run verify:email someone@gmail.com` → expect ✓.

---

## 5. 🔧📄⚠️ Accounting / receipts (Green Invoice / Morning) — CODE DONE

✅ **Code is implemented** (`lib/accounting/greeninvoice.ts`): token auth → create document →
store number + URL. It's written to the documented v1 API but is **UNVERIFIED against a live
account** — run it in the **sandbox** first (like Grow).

**⚠️ First, ask the business's Israeli accountant** which document a gift-card sale requires
(receipt vs. tax invoice at redemption vs. deposit receipt) and set `GREENINVOICE_DOC_TYPE`
accordingly — this is the one decision the code can't make.

**Where to get the data:** a **Green Invoice / Morning** (morning.co.il) account → **Settings → API keys**.
```
RECEIPT_PROVIDER        = greeninvoice
GREENINVOICE_API_URL    = https://api.greeninvoice.co.il   # or the sandbox URL to test first
GREENINVOICE_API_KEY    = <from Green Invoice>
GREENINVOICE_API_SECRET = <from Green Invoice>
GREENINVOICE_DOC_TYPE   = 320   # accountant-confirmed: 400=receipt, 320=invoice-receipt, 305=tax invoice
```
Redeploy, buy a card in the sandbox, and confirm a document is issued (check the card's audit log).

---

## 6. 📄⚠️ Legal & privacy (do not skip)

Have an **Israeli lawyer / privacy professional** review and provide:
- Gift-card **terms** (expiry rules per Israeli consumer law, non-refundable/transferable clauses) —
  replace the placeholder in `app/terms/page.tsx`.
- A **privacy policy** (Israeli Privacy Protection Law) + a data-retention policy. The app already
  minimizes PII and has audit logs; set retention windows in `/admin/settings`/DB as advised.
- Confirm consent/marketing rules if you later add SMS/WhatsApp.

The app is explicitly **not represented as legally certified**.

---

## 7. 🔧💻 Security hardening

- [ ] **Rotate every secret** to fresh random values (`AUTH_SECRET`, `PAYMENT_WEBHOOK_SECRET`,
      `CRON_SECRET`). Delete `AUTH_DEMO_PASSWORD` after moving to Supabase Auth.
- [ ] **MFA** on owner/admin Supabase accounts.
- [ ] Confirm `SUPABASE_SERVICE_ROLE_KEY` is **server-only** (never `NEXT_PUBLIC_`).
- [ ] Review **RLS** in `supabase/migrations/0002_rls.sql`; verify no anon can read cards/balances
      (test with the anon key).
- [ ] 💻 For multi-instance scale, back the rate limiter (`lib/security/rate-limit.ts`) with
      Redis/Upstash (currently in-memory / per-instance).
- [x] Content-Security-Policy + security headers — ✅ set in `next.config.mjs`.

---

## 8. 🔧 Monitoring, alerts & backups

- **Sentry:** ✅ wired (`lib/logging/report.ts` forwards server errors to Sentry's ingest API — no
  SDK needed). Just create a project at sentry.io → copy the DSN → set `SENTRY_DSN` in Vercel → redeploy.
- **Backups:** Supabase → **Database → Backups**. On the Pro plan enable **Point-in-Time Recovery**.
  Gift cards are financial value — take backups seriously.
- **Alerts:** operational alerts currently surface in `/admin` + logs; add email/Slack from
  `deliverDueJobs` / webhook failures when you want push alerts.

---

## 9. 🔧 Scheduled delivery (cron)

Immediate delivery works with no cron — it's sent inline the moment payment is verified. **Scheduled**
(מתוזמן) gift cards enqueue a due-job that only sends when `/api/cron/deliver` runs after the chosen
time. Vercel **Hobby** fires that cron only **once a day** (`0 9 * * *` = 09:00 UTC), so without a
more frequent trigger a card scheduled for "today 15:00" won't arrive until the next 09:00-UTC tick.
Pick **one** of these so scheduled cards arrive on time:

- **(recommended, free) GitHub Actions** — the repo ships `.github/workflows/scheduled-delivery.yml`,
  which POSTs the endpoint every 15 min. Enable it by adding two repo secrets
  (Settings → Secrets and variables → Actions):
  - `DELIVERY_CRON_URL` = `https://gift.justasecond.co.il/api/cron/deliver`
  - `CRON_SECRET` = the **same** value set in the Vercel project env.
  Until `DELIVERY_CRON_URL` is set the workflow self-skips. Trigger a test run from the Actions tab
  ("Run workflow"). GitHub cron granularity is ~5–15 min and can be delayed at peak — fine for gift
  cards, not for to-the-second timing.
- **Vercel Pro** — set `vercel.json` cron back to `*/5 * * * *`.
- **Any external scheduler** (cron-job.org, Supabase `pg_cron` + `pg_net`, an uptime pinger) —
  `POST https://…/api/cron/deliver` with header `Authorization: Bearer $CRON_SECRET`.

Notes: the endpoint is **idempotent** (per-card idempotency keys → never double-sends), so pinging it
often is safe. If `CRON_SECRET` is left unset the endpoint accepts the daily Vercel cron unauthenticated
(it only flushes already-due delivery emails) — but set a secret in production and use it in whichever
trigger you pick.

---

## 10. 🔧 Hebrew PDF glyphs

Drop a Hebrew TTF at `public/fonts/NotoSansHebrew-Regular.ttf` (Noto Sans Hebrew, OFL — from Google
Fonts) and redeploy. The PDF generator auto-embeds it; without it, code/QR/amounts still render but
Hebrew uses a Latin fallback. See `public/fonts/README.md`.

---

## 11. 🔧 Wix "Buy a Gift Card" button

In the Wix editor: add a **Button** → **Link → Web address** →
`https://gift.justasecond.co.il/gift-cards` (open in new tab). Optionally append `?utm_source=wix`.
Do **not** iframe-embed checkout. Full steps + rationale: `docs/wix-integration.md`.

---

## 12. ✅ Final pre-launch checklist

- [ ] Custom domain live; `APP_BASE_URL` matches; redeployed.
- [ ] Supabase Auth live; real staff users + roles; demo auth removed.
- [ ] Grow: real transaction end-to-end verified (webhook signature, amount reconcile, one card, one
      credit, receipt, delivery); refund tested.
- [ ] Resend domain verified; `verify:email` ✓.
- [ ] Accounting document type confirmed by accountant; Green Invoice issuing on purchase.
- [ ] Terms + privacy reviewed by an Israeli lawyer and published.
- [ ] All secrets rotated; MFA on; RLS verified; service-role key server-only.
- [ ] Sentry wired; Supabase PITR backups on.
- [ ] Hebrew PDF font added.
- [ ] Wix button added.
- [ ] `/api/health` → `ok: true`; `npm run verify:supabase` ✓ against prod DB.
- [ ] Run the full flow once on prod: buy (real ₪) → recipient email → in-store redeem → admin ledger.

---

### Reference: where each credential comes from

| Env var | Source |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API |
| `GROW_API_KEY` / `GROW_API_SECRET` / `GROW_PAGE_CODE` | Grow merchant dashboard |
| `PAYMENT_WEBHOOK_SECRET` | you generate; must match Grow's signing |
| `RESEND_API_KEY` | Resend → API Keys · `EMAIL_FROM` = your verified domain |
| `GREENINVOICE_API_KEY` / `SECRET` | Green Invoice/Morning account |
| `SENTRY_DSN` | sentry.io project |
| `AUTH_SECRET` / `CRON_SECRET` | you generate (`crypto.randomBytes`) |
| `APP_BASE_URL` / `BUSINESS_TIMEZONE` | your domain / `Asia/Jerusalem` |
