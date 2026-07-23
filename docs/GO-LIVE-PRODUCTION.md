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

## 2. 💻⚠️ Real staff authentication (replace demo auth)

The demo cookie auth (`lib/auth/`) with a shared `AUTH_DEMO_PASSWORD` is **not production-grade** —
anyone with the password is "owner". Replace it with **Supabase Auth** (already a dependency).

**Where the data lives:** Supabase → **Authentication** (users) and your `profiles` + `user_roles`
tables (already created by `0001_init.sql`).

**Steps:**
1. Supabase → **Authentication → Providers** → enable **Email** (+ optionally magic link). Turn on
   **email confirmations**. For privileged users enable **MFA** (Authentication → settings).
2. Supabase → **Authentication → Users → Add user** for each real staff member. Copy each user's
   UUID.
3. Insert their profile + role (SQL Editor):
   ```sql
   insert into profiles (auth_user_id, email, name) values ('<uuid>', 'noa@justasecond.co.il', 'נעה');
   insert into user_roles (user_id, role) values ('<profile-id>', 'owner');  -- owner/admin/store_manager/store_employee/finance/read_only
   ```
4. 💻 **Code change (dev task):** swap `lib/auth/session.ts` + `lib/auth/guards.ts` to read the
   Supabase session (via `@supabase/ssr` cookies) and look up the role from `user_roles` instead of
   the hardcoded `DEMO_USER_LIST`. Keep the `Role`/`Permission` model in `lib/permissions/roles.ts`
   as-is. Delete `AUTH_DEMO_PASSWORD` from Vercel afterward.
   > This is the one item that needs real development, not just config. Everything downstream
   > (RBAC, RLS, audit) already keys off `user.id`/`user.role`, so the surface is small.

---

## 3. 💻📄⚠️ Real payments — Grow (grow.link / Meshulam)

The `GrowPaymentProvider` (`lib/payments/grow.ts`) is written to Grow's documented shapes but is
**UNVERIFIED against a live account**. Treat this as an integration task, not a flip of a switch.

**Where to get the data:** open a **Grow business account** (grow.link) → merchant dashboard →
API / integration settings. You'll need:
- `GROW_API_KEY` (userId), `GROW_API_SECRET` (apiKey), `GROW_PAGE_CODE` — from Grow dashboard.
- The **webhook signature scheme** — ⚠️ confirm with Grow support exactly how they sign callbacks
  (header name + algorithm). `verifyWebhook()` currently expects an HMAC in `x-grow-signature`;
  adjust to match Grow's real scheme.

**Steps:**
1. In Vercel env:
   ```
   PAYMENT_PROVIDER      = grow
   GROW_API_KEY          = <from Grow>
   GROW_API_SECRET       = <from Grow>
   GROW_PAGE_CODE        = <from Grow>
   GROW_API_URL          = https://restapi.grow.link
   PAYMENT_WEBHOOK_SECRET = <long random; must match what Grow signs with>
   ```
   Generate a secret: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
2. Set your webhook/notify URL in Grow (or it's sent per-request) to
   `https://gift.justasecond.co.il/api/webhooks/payment`.
3. 💻 Reconcile `lib/payments/grow.ts` field names + signature with Grow's live docs. Then **redeploy**.
4. ⚠️ **Test with one real low-value transaction** (e.g. ₪50): confirm the webhook is received,
   signature verifies, the amount reconciles, exactly one card activates, and a receipt + delivery fire.
   Check `/admin/gift-cards/<id>` ledger + audit.
5. Test a **refund** from `/admin` and confirm Grow processes it.

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

## 5. 💻📄⚠️ Accounting / receipts (Green Invoice / Morning)

The receipt provider is a **mock**; the Green Invoice adapter (`lib/accounting/greeninvoice.ts`) is a
**stub**. Do NOT enable it until the treatment is confirmed.

**⚠️ First, ask the business's Israeli accountant** which document a gift-card sale requires
(receipt at purchase vs. tax invoice at redemption vs. deposit receipt) — this changes *when* and
*what* the code issues.

**Where to get the data:** a **Green Invoice / Morning** (morning.co.il) account → API keys.
```
RECEIPT_PROVIDER      = greeninvoice
GREENINVOICE_API_KEY  = <from Green Invoice>
GREENINVOICE_API_SECRET = <from Green Invoice>
```
💻 Implement `createReceipt()` in `lib/accounting/greeninvoice.ts` against their API per the
accountant's decision, store the document number/URL, and test issuance on a real purchase.

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
- [ ] Add a Content-Security-Policy header in `next.config.mjs` (base security headers already set).

---

## 8. 🔧 Monitoring, alerts & backups

- **Sentry:** create a project at sentry.io → copy the DSN → set `SENTRY_DSN` in Vercel. (Wire the
  SDK in — the env slot exists.)
- **Backups:** Supabase → **Database → Backups**. On the Pro plan enable **Point-in-Time Recovery**.
  Gift cards are financial value — take backups seriously.
- **Alerts:** operational alerts currently surface in `/admin` + logs; add email/Slack from
  `deliverDueJobs` / webhook failures when you want push alerts.

---

## 9. 🔧 Scheduled delivery (cron)

Immediate delivery works with no cron. For **scheduled** gift cards to send close to their chosen
time, upgrade to **Vercel Pro** and set `vercel.json` cron back to `*/5 * * * *`. On Hobby it's
daily (`0 9 * * *`). Any external scheduler can also `POST /api/cron/deliver` with
`Authorization: Bearer $CRON_SECRET`.

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
