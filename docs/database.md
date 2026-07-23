# Database — schema, financial model, and operations

The PostgreSQL/Supabase persistence layer for the Just A Second gift-card system.
It mirrors the TypeScript domain model in `lib/gift-cards/types.ts` and
`lib/data/store.ts` exactly (table/column names and enum members line up 1:1).

- **Money is always integer minor units (agorot)** stored as `bigint`. `₪100 → 10000`.
  There is **no float / numeric money anywhere** — see `lib/money.ts`.
- **All ids are `uuid`** with `gen_random_uuid()` defaults.
- **All rows carry `created_at`** (and `updated_at` where mutable), `timestamptz`.

Files:

| File | Role |
| --- | --- |
| `supabase/migrations/0001_init.sql` | Enums, tables, constraints, indexes, `updated_at` triggers, role catalogue. |
| `supabase/migrations/0002_rls.sql` | Row-Level Security: deny-by-default, staff read scoping, RBAC helpers. |
| `supabase/migrations/0003_functions.sql` | Atomic `redeem_gift_card`, `activate_gift_card_from_payment`, public `get_public_gift_card`. |
| `supabase/seed.sql` | Deterministic demo data (mirrors `lib/data/seed-data.ts`). |
| `scripts/db-migrate.mjs` / `scripts/db-seed.mjs` | Node ESM runners (see [Running](#running-migrations--seed)). |

---

## The ledger-based financial model

The **immutable ledger `gift_card_ledger_entries` is the source of truth** for
every card's balance. `gift_cards.balance_minor` is a **cached total**, kept in
sync atomically with each ledger insert.

```
balance_minor  ==  SUM(gift_card_ledger_entries.amount_minor)   -- always
```

Ledger `amount_minor` is **signed**: credits positive, debits negative. Each
entry also snapshots `balance_after_minor` (the running balance after it).
`ledger_entry_type` values:

| Type | Sign | Emitted by |
| --- | --- | --- |
| `initial_credit` | + | activation on verified payment |
| `redemption_debit` | − | in-store redemption |
| `redemption_reversal_credit` | + | manager-approved reversal |
| `refund_debit` | − | refund |
| `manual_increase` / `manual_decrease` | ± | admin/finance adjustment |
| `expiration_adjustment` | − | expiry sweep |
| `cancellation_adjustment` | − | cancellation |
| `reissue_transfer` | ± | balance moved to a reissued card |

**Why cache the balance at all?** So reads (recipient page, redemption UI,
dashboard) are a single-row lookup, while writes still recompute from — and stay
consistent with — the ledger. The cache is only ever written inside the atomic
functions, never by ad-hoc app code.

### Two identifiers, never mixed

- **`code`** — human-readable, checksum-protected (e.g. `JAS-7F3K-QP2M-9`), for
  manual entry at the till. `UNIQUE`.
- **`public_token`** — long cryptographically-random token for links/QR,
  revocable and rotated on reissue. `UNIQUE`.

Neither exposes the database id, the balance, or PII. See
`docs/redemption-security.md`.

---

## Status transition map (`gift_card_status`)

```
                 draft
                   │ checkout opened
                   ▼
            awaiting_payment
                   │ webhook arriving
                   ▼
           payment_processing ──payment failed──► failed ──retry──► awaiting_payment
                   │ verified payment (activate_gift_card_from_payment)
                   ▼
                 active ◄─────────────┐
                   │                  │ reversal restores balance
       redemption (partial)          │
                   ▼                  │
          partially_redeemed ─────────┘
                   │ redemption to zero
                   ▼
            fully_redeemed

  active / partially_redeemed ──past expires_at──► expired
  active / partially_redeemed ──admin action────► suspended ──unsuspend──► active
  any pre-spend state ─────────admin action────► cancelled
  paid card ───────────────────refund──────────► refunded
  any card ────────────────────reissue─────────► reissued (superseded_by_card_id set)
```

**Redeemable statuses** (enforced in `redeem_gift_card`): `active`,
`partially_redeemed`. Everything else returns `not_redeemable`.

---

## Tables

**Identity / RBAC**
- `profiles` — staff users. `auth_user_id` maps to Supabase `auth.users.id`
  (soft link; customers are account-less and have no profile).
- `roles` — catalogue of the six `app_role`s (seeded by `0001`).
- `user_roles` — profile ↔ role grants; the scoping key for RLS.
- `store_locations` — physical retail sites.

**Catalogue**
- `gift_card_templates` — design templates (`template_occasion`, colours,
  `is_default`; a partial unique index enforces at most one default).

**Cards & money**
- `gift_cards` — the aggregate root. Holds `code`, `public_token`, `status`,
  `initial_amount_minor`, cached `balance_minor`, buyer/recipient fields,
  scheduling, `payment_id`, `issued_at`, `expires_at`, `superseded_by_card_id`.
- `gift_card_ledger_entries` — immutable signed ledger (source of truth).
- `gift_card_redemptions` — one row per in-store spend; `idempotency_key UNIQUE`.
- `redemption_reversals` — manager-approved credit-backs.
- `balance_adjustments` — manual admin/finance adjustments (write through ledger).

**Payments**
- `payments` — one payment per card (provider, amount, `payment_status`).
- `payment_events` — every provider webhook, deduped by `UNIQUE(provider, event_id)`
  (the activation idempotency anchor).
- `refunds` — refund records.
- `accounting_documents` — receipts / tax invoices from the accounting provider.

**Delivery**
- `delivery_jobs` — email/SMS/WhatsApp send jobs (`delivery_status`, retries).
- `delivery_attempts` — per-attempt log.

**Operational**
- `internal_notes` — staff annotations on a card.
- `audit_logs` — append-only actor/action/entity trail.
- `system_settings` — **singleton** (`id = 1`): presets, min/max, expiry, etc.
- `idempotency_keys` — generic one-shot key registry for server operations.

---

## Constraints & indexes worth knowing

Money / balance invariants on `gift_cards`:
- `chk_gc_initial_positive` — `initial_amount_minor > 0`
- `chk_gc_balance_nonneg` — `balance_minor >= 0` (the **hard** floor)
- `chk_gc_balance_within_cap` — `balance_minor <= initial_amount_minor`
- `chk_gc_currency_ils` — ILS-only for the MVP

Other guards:
- `gift_card_redemptions.amount_minor > 0`, `balance_after_minor >= 0`,
  `idempotency_key UNIQUE` (the double-spend guard).
- `gift_card_ledger_entries.balance_after_minor >= 0`; partial-unique
  `idempotency_key` (only enforced when non-null).
- `payment_events` `UNIQUE(provider, event_id)`.
- `system_settings` `CHECK (id = 1)` singleton + `min_amount_minor <= max_amount_minor`.

Indexes: `gift_cards(code)`, `(public_token)`, `(status)`,
`lower(buyer_email)`, `lower(recipient_email)`, `(template_id)`, `(expires_at)`;
ledger `(gift_card_id)`; redemptions `(gift_card_id)`; audit `(entity_type, entity_id)`;
plus a partial index on due delivery jobs.

`updated_at` is maintained by a `BEFORE UPDATE` trigger (`set_updated_at()`) on
every mutable table.

---

## Atomic functions (see `0003_functions.sql`)

- **`redeem_gift_card(...) → (out_code, out_balance_after, out_redemption_id, out_status)`**
  Locks the card `FOR UPDATE`; returns the prior result on a duplicate
  idempotency key; validates amount/existence/status/expiry/balance; then inserts
  ledger debit + redemption + updates cached balance + recomputes status +
  writes audit — all in one transaction. Outcome codes:
  `ok | duplicate | invalid_amount | not_found | not_redeemable | expired | insufficient_balance`.
- **`activate_gift_card_from_payment(...) → (out_code, out_balance_minor, out_status)`**
  Idempotent on `payment_events(provider, event_id)`. Reconciles the webhook
  amount against the authoritative `initial_amount_minor` before activating
  (`amount_mismatch` otherwise). Codes: `activated | already_processed | amount_mismatch | not_found | not_activatable`.
- **`get_public_gift_card(p_token) → recipient view`** — `SECURITY DEFINER`, the
  only anon-facing read path. Returns a PII-minimized projection (no db id, no
  buyer PII, no payment data; sender name suppressed when anonymous).

Additional operations consumed by `lib/data/supabase-store.ts` (all plpgsql,
`SECURITY DEFINER`, `SET search_path = public`; every balance-changing one locks
the card `FOR UPDATE`, writes a ledger row + an audit row, and keeps
`balance_minor = SUM(ledger.amount_minor)`):

- **`reverse_redemption(p_redemption_id, p_reason, p_requested_by, p_approved_by) → (out_code, out_message, out_reversal_id)`**
  Credits a redemption back (`redemption_reversal_credit` ledger + `redemption_reversals`
  row), sets `reversed_by_reversal_id`, and un-sticks a `fully_redeemed` card to
  `active`/`partially_redeemed`. Codes: `ok | not_found | already_reversed`.
- **`apply_ledger_adjustment(p_gift_card_id, p_type, p_magnitude_minor, p_reason, p_created_by, p_approved_by, p_idempotency_key) → (out_code, out_balance_after, out_message)`**
  Manual credit/debit through the ledger. Sign is derived from `p_type`
  (increase/reversal/initial = +, decrease/refund/expiration/cancellation/reissue = −).
  Idempotent on `p_idempotency_key`. Rejects a debit that would go below zero
  (`insufficient_balance`). Codes: `ok | invalid_amount | invalid_type | not_found | insufficient_balance`.
- **`transition_gift_card_status(p_gift_card_id, p_to, p_actor_id, p_actor_role, p_reason) → (out_code, out_message)`**
  Guarded lifecycle change (no balance change). Enforces the transition map from
  `lib/gift-cards/status.ts`. Codes: `ok | not_found | illegal_transition`.
- **`reissue_gift_card(p_gift_card_id, p_new_code, p_new_token, p_actor_id, p_actor_role, p_reason) → (out_code, out_message, out_new_card_id)`**
  Mints a replacement card carrying the remaining balance (new `initial_credit`
  ledger), transfers the old balance out (`reissue_transfer` debit to zero), sets
  the old card to `reissued` with `superseded_by_card_id`. Reissue-able from
  `active/partially_redeemed/suspended/expired/fully_redeemed`. Codes:
  `ok | not_found | not_reissuable`.
- **`claim_due_delivery_jobs(p_now, p_limit) → SETOF delivery_jobs`**
  Atomic work-queue claim (`FOR UPDATE SKIP LOCKED`). Claims `pending` (due or
  unscheduled), past-due `scheduled`, and `failed` jobs with `attempts < 5`;
  flips them to `processing` and increments `attempts`.

There is also a small `IMMUTABLE` helper `gc_status_for_balance(current, balance,
initial)` mirroring `statusForBalance` in `lib/gift-cards/status.ts`.

See `docs/redemption-security.md` for the full guarantees.

---

## Running migrations & seed

### Supabase CLI (recommended)

```bash
supabase db push          # applies everything under supabase/
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql   # optional demo data
```

### Plain psql (in order)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0002_rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0003_functions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

### Node scripts

```bash
export DATABASE_URL="postgresql://postgres:<pw>@<host>:5432/postgres"   # or SUPABASE_DB_URL
npm run db:migrate    # scripts/db-migrate.mjs
npm run db:seed       # scripts/db-seed.mjs
```

Both scripts read `DATABASE_URL` **or** `SUPABASE_DB_URL`, use the `pg` library
if it is installed, and otherwise **print the equivalent psql commands** and exit
cleanly. With **no** DB URL set they explain what to configure and exit `0` — no
credentials are ever required just to run them (CI-safe). `pg` is **not** a
declared dependency; it is detected at runtime via dynamic import.

Migrations are idempotent where practical (`CREATE ... IF NOT EXISTS`,
enum/constraint guards, `DROP FUNCTION IF EXISTS`), and the seed uses
`ON CONFLICT DO NOTHING`, so re-running is safe.

### Notes for non-Supabase Postgres

RLS (`0002`) and the definer functions use `auth.uid()`, which exists only on
Supabase. On a stock Postgres you can validate the schema (`0001`) and functions
by first stubbing `auth.uid()` and the `anon` / `authenticated` / `service_role`
roles. In production, Supabase provides these; the **service role bypasses RLS**
and is what server code uses for privileged writes.
