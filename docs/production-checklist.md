# Production go-live checklist

Everything that must be done, verified, or confirmed before `gift_card_system`
goes live for **Just A Second**. Work top to bottom. Several items require sign-off
from real professionals (accountant, lawyer) — those are called out explicitly and
are **not** things the code can satisfy on its own.

Cross-references: `.env.example` (all env vars), `docs/database.md` (migrations),
`docs/payment-flow.md` (Grow), `docs/roles-and-permissions.md` (auth).

---

## (a) Infrastructure

- [ ] Create the production **Supabase project**.
- [ ] Run migrations in order:
  - [ ] `supabase/migrations/0001_init.sql`
  - [ ] `supabase/migrations/0002_rls.sql`
  - [ ] `supabase/migrations/0003_functions.sql`
  - [ ] (or `supabase db push` / `npm run db:migrate`)
- [ ] Load seed data as appropriate (`supabase/seed.sql` / `npm run db:seed`) —
      review before seeding production (demo data is for dev).
- [ ] Set all required env vars from `.env.example`:
  - [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - [ ] `SUPABASE_SERVICE_ROLE_KEY` (server-only)
  - [ ] `APP_BASE_URL` = the production URL (e.g. `https://gift.justasecond.co.il`)
  - [ ] `BUSINESS_TIMEZONE` (e.g. `Asia/Jerusalem`)
- [ ] Deploy the Next.js app to the production host.
- [ ] Configure the **delivery cron** to `POST /api/cron/deliver` on a schedule
      (Vercel Cron / Supabase scheduled function / external cron), with header
      `Authorization: Bearer <CRON_SECRET>`.
- [ ] Set a strong `CRON_SECRET` and confirm the endpoint rejects requests
      without it (401).

---

## (b) Payments

- [ ] Obtain production **Grow (grow.link / Meshulam)** credentials:
      `GROW_API_KEY`, `GROW_API_SECRET`, `GROW_PAGE_CODE`, `GROW_API_URL`.
- [ ] **Confirm the webhook signature scheme and field names with Grow** — the
      adapter (`lib/payments/grow.ts`) is written to documented shapes but is
      UNVERIFIED against a live account (header, `transactionCode`/`asmachta`/
      `statusCode`/`sum`/`cField1`).
- [ ] Set `PAYMENT_PROVIDER=grow`.
- [ ] Set `PAYMENT_WEBHOOK_SECRET` to the real HMAC secret Grow signs with.
- [ ] Run a **real test transaction** end to end (checkout → verified webhook →
      one card + one initial credit → receipt → delivery).
- [ ] Verify **amount reconciliation** works (a mismatched amount must NOT
      activate — `amount_mismatch`).
- [ ] Confirm a duplicate/replayed webhook does not double-activate
      (`already_processed`).

---

## (c) Email

- [ ] Set `EMAIL_PROVIDER=resend` and `RESEND_API_KEY`, `EMAIL_FROM`.
- [ ] **Verify the Resend sending domain** (SPF/DKIM) so buyer confirmations and
      recipient gift-card emails deliver and don't land in spam.
- [ ] Send a live test recipient email (with PDF attachment) and a buyer
      confirmation.

---

## (d) Accounting

- [ ] **CONFIRM WITH THE BUSINESS'S ISRAELI ACCOUNTANT** the correct document
      type before enabling any real accounting integration:
  - [ ] Receipt (קבלה) at purchase, vs.
  - [ ] Tax invoice (חשבונית מס) at redemption, vs.
  - [ ] Deposit receipt (קבלה על פיקדון) — gift cards are often treated as a
        deposit until redeemed.
- [ ] Only after that guidance, set `RECEIPT_PROVIDER=greeninvoice` with
      `GREENINVOICE_API_KEY` / `GREENINVOICE_API_SECRET`.
- [ ] Note: the **mock receipt provider does NOT constitute tax compliance** — it
      is a placeholder. Do not go live on the mock.

---

## (e) Legal / privacy

- [ ] **MUST be reviewed by an Israeli lawyer / privacy professional** before
      launch. This app is **not** represented as legally certified. Specifically:
  - [ ] Consumer gift-card law (validity, terms, disclosures).
  - [ ] Expiry rules (whether/when a balance may expire).
  - [ ] Israeli Privacy Protection Law (חוק הגנת הפרטיות) compliance.
  - [ ] Data retention policy for buyer/recipient PII.
- [ ] Review the customer-facing terms page (`app/terms/page.tsx`) with counsel.

---

## (f) Security

- [ ] **Rotate all dev secrets** — `CRON_SECRET`, `PAYMENT_WEBHOOK_SECRET`,
      `AUTH_SECRET` (the `.env.example` values are placeholders).
- [ ] Remove/disable the demo accounts (`lib/auth/users.ts`) — production uses
      Supabase Auth + `user_roles`, not the demo directory.
- [ ] Enable **MFA for owner/admin** accounts in Supabase Auth.
- [ ] **Review RLS** — confirm deny-by-default is in force on every table and
      codes/balances/tokens are never anon-readable
      (`supabase/migrations/0002_rls.sql`, `docs/redemption-security.md`).
- [ ] Confirm the **service-role key is server-only** and never shipped to the
      browser bundle (never `NEXT_PUBLIC_`).
- [ ] Set up **Sentry** (`SENTRY_DSN`) for error monitoring.

---

## (g) Hebrew PDF font

- [ ] Add a Hebrew-capable font at
      `public/fonts/NotoSansHebrew-Regular.ttf` so gift-card PDFs
      (`lib/gift-cards/pdf.ts`) render full Hebrew glyphs. Without it, Hebrew text
      in generated PDFs may be missing or boxed. (See `public/fonts/README.md`.)
