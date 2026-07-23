-- =============================================================================
-- setup.sql — ONE-SHOT database setup for gift_card_system.
-- Concatenation of 0001_init + 0002_rls + 0003_functions + seed, in order.
-- Paste this whole file into Supabase → SQL Editor → Run. Idempotent-safe.
-- (Regenerate with: cat supabase/migrations/000*.sql supabase/seed.sql)
-- =============================================================================

-- >>>>>>>>>>>>>>>>>>>> supabase/migrations/0001_init.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- 0001_init.sql — Just A Second gift-card system: schema
-- -----------------------------------------------------------------------------
-- Financial system. Rules baked into the schema:
--   * Money is ALWAYS integer minor units (agorot for ILS), stored as bigint.
--     NEVER float / numeric. See lib/money.ts.
--   * The immutable ledger (gift_card_ledger_entries) is the source of truth.
--     gift_cards.balance_minor is a CACHED total, mutated atomically alongside
--     each ledger insert (see 0003_functions.sql :: redeem_gift_card).
--   * All ids are uuid default gen_random_uuid(); all rows carry created_at
--     (and updated_at where mutable) as timestamptz.
--
-- Mirrors the TypeScript domain model in lib/gift-cards/types.ts and
-- lib/data/store.ts exactly (names + enum members).
--
-- Idempotent where practical (IF NOT EXISTS / DO $$ guards) so it can be
-- re-applied during development.
-- =============================================================================

-- gen_random_uuid() lives in pgcrypto on stock Postgres; Supabase ships it.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums (guarded so re-runs don't error)
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE gift_card_status AS ENUM (
    'draft',              -- created, not yet paid
    'awaiting_payment',   -- checkout session opened
    'payment_processing', -- webhook arriving / provider settling
    'active',             -- paid + activated, full or partial balance remains
    'partially_redeemed', -- some balance spent, some remains
    'fully_redeemed',     -- balance == 0
    'expired',
    'suspended',
    'cancelled',
    'refunded',
    'reissued',           -- superseded by a new card; old token/code void
    'failed'              -- payment failed
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM (
    'pending', 'processing', 'paid', 'failed', 'refunded', 'partially_refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delivery_status AS ENUM (
    'pending', 'scheduled', 'processing', 'sent', 'delivered', 'failed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ledger_entry_type AS ENUM (
    'initial_credit',
    'redemption_debit',
    'redemption_reversal_credit',
    'refund_debit',
    'manual_increase',
    'manual_decrease',
    'expiration_adjustment',
    'cancellation_adjustment',
    'reissue_transfer'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delivery_channel AS ENUM ('email', 'sms', 'whatsapp');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE language AS ENUM ('he', 'en');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE template_occasion AS ENUM ('birthday', 'holiday', 'celebration', 'general');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RBAC roles. Ordered loosely most→least privileged.
DO $$ BEGIN
  CREATE TYPE app_role AS ENUM (
    'owner', 'admin', 'store_manager', 'store_employee', 'finance', 'read_only'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE accounting_document_type AS ENUM ('receipt', 'tax_invoice', 'credit_note');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- updated_at trigger helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- Identity & RBAC
-- =============================================================================

-- Staff profile. `auth_user_id` maps to Supabase auth.users.id (no hard FK so
-- the schema also applies on plain Postgres). Customers do NOT get a profile —
-- the purchase funnel is account-less.
CREATE TABLE IF NOT EXISTS profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid UNIQUE,                    -- -> auth.users.id (Supabase)
  email         text NOT NULL UNIQUE,
  full_name     text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Catalogue of roles (one row per app_role). Human-readable description lives here.
CREATE TABLE IF NOT EXISTS roles (
  role        app_role PRIMARY KEY,
  description text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Which profiles hold which roles (many-to-many). Scoping key for RLS.
CREATE TABLE IF NOT EXISTS user_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        app_role NOT NULL REFERENCES roles(role),
  granted_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, role)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_profile ON user_roles(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role    ON user_roles(role);

-- Physical retail locations where redemptions happen.
CREATE TABLE IF NOT EXISTS store_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  address     text NOT NULL,
  timezone    text NOT NULL DEFAULT 'Asia/Jerusalem',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- Gift-card catalogue
-- =============================================================================

CREATE TABLE IF NOT EXISTS gift_card_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  occasion          template_occasion NOT NULL DEFAULT 'general',
  language          language NOT NULL DEFAULT 'he',
  cover_image_url   text,
  background_color  text NOT NULL DEFAULT '#333D36',
  text_color        text NOT NULL DEFAULT '#FFFCF5',
  accent_color      text NOT NULL DEFAULT '#E88225',
  is_active         boolean NOT NULL DEFAULT true,
  is_default        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- At most one default template.
CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_single_default
  ON gift_card_templates(is_default) WHERE is_default;

-- =============================================================================
-- Gift cards — the aggregate root
-- =============================================================================
CREATE TABLE IF NOT EXISTS gift_cards (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Two SEPARATE identifiers (never expose db id / balance / PII):
  code                   text NOT NULL UNIQUE,   -- human-readable, checksum-protected
  public_token           text NOT NULL UNIQUE,   -- long random token for links/QR, revocable

  status                 gift_card_status NOT NULL DEFAULT 'draft',
  currency               text NOT NULL DEFAULT 'ILS',

  initial_amount_minor   bigint NOT NULL,        -- agorot; set at purchase
  balance_minor          bigint NOT NULL DEFAULT 0, -- CACHED = SUM(ledger.amount_minor)

  template_id            uuid REFERENCES gift_card_templates(id),

  -- Buyer (purchaser). buyer_name null when anonymous on the card.
  buyer_name             text,
  buyer_email            text NOT NULL,
  buyer_phone            text,
  buyer_company          text,
  buyer_tax_id           text,
  wants_invoice          boolean NOT NULL DEFAULT false,
  is_anonymous           boolean NOT NULL DEFAULT false,

  -- Recipient.
  recipient_name         text NOT NULL,
  recipient_email        text NOT NULL,
  recipient_phone        text,
  recipient_language     language NOT NULL DEFAULT 'he',
  delivery_channel       delivery_channel NOT NULL DEFAULT 'email',

  greeting               text NOT NULL DEFAULT '',  -- safe plain text, line breaks preserved

  scheduled_delivery_at  timestamptz,               -- null = immediate
  sender_timezone        text NOT NULL DEFAULT 'Asia/Jerusalem',

  payment_id             uuid,                       -- FK added after payments table (circular)
  issued_at              timestamptz,                -- set on activation
  expires_at             timestamptz,                -- null = no expiry
  superseded_by_card_id  uuid REFERENCES gift_cards(id), -- set when reissued

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- Hard money invariants. Balance can never go negative or exceed the amount
  -- originally loaded. (Reversals credit back only up to a prior debit, so the
  -- cache stays within [0, initial_amount_minor].)
  CONSTRAINT chk_gc_initial_positive   CHECK (initial_amount_minor > 0),
  CONSTRAINT chk_gc_balance_nonneg     CHECK (balance_minor >= 0),
  CONSTRAINT chk_gc_balance_within_cap CHECK (balance_minor <= initial_amount_minor),
  CONSTRAINT chk_gc_currency_ils       CHECK (currency = 'ILS')
);

CREATE INDEX IF NOT EXISTS idx_gc_code            ON gift_cards(code);
CREATE INDEX IF NOT EXISTS idx_gc_public_token    ON gift_cards(public_token);
CREATE INDEX IF NOT EXISTS idx_gc_status          ON gift_cards(status);
CREATE INDEX IF NOT EXISTS idx_gc_buyer_email     ON gift_cards(lower(buyer_email));
CREATE INDEX IF NOT EXISTS idx_gc_recipient_email ON gift_cards(lower(recipient_email));
CREATE INDEX IF NOT EXISTS idx_gc_template        ON gift_cards(template_id);
CREATE INDEX IF NOT EXISTS idx_gc_expires_at      ON gift_cards(expires_at);

-- =============================================================================
-- Payments (created before gift_cards.payment_id FK is wired up)
-- =============================================================================
CREATE TABLE IF NOT EXISTS payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id          uuid NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  provider              text NOT NULL,           -- 'mock' | 'grow' | ...
  provider_payment_id   text,
  provider_checkout_id  text,
  amount_minor          bigint NOT NULL,
  currency              text NOT NULL DEFAULT 'ILS',
  status                payment_status NOT NULL DEFAULT 'pending',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pay_amount_positive CHECK (amount_minor > 0)
);
CREATE INDEX IF NOT EXISTS idx_payments_gift_card ON payments(gift_card_id);
CREATE INDEX IF NOT EXISTS idx_payments_status    ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_provider_pid
  ON payments(provider, provider_payment_id);

-- Wire the circular gift_cards -> payments FK now that payments exists.
DO $$ BEGIN
  ALTER TABLE gift_cards
    ADD CONSTRAINT fk_gc_payment
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- payment_events — every provider webhook/callback, deduped by provider event id.
-- The unique event_id is the idempotency anchor for activation (0003).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id    uuid REFERENCES payments(id) ON DELETE SET NULL,
  gift_card_id  uuid REFERENCES gift_cards(id) ON DELETE SET NULL,
  provider      text NOT NULL,
  event_id      text NOT NULL,        -- provider's unique event id
  event_type    text,
  amount_minor  bigint,
  currency      text,
  raw           jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Idempotency: a given provider event is stored/processed at most once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_events_event_id
  ON payment_events(provider, event_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_gift_card ON payment_events(gift_card_id);

-- -----------------------------------------------------------------------------
-- refunds
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refunds (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id          uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  gift_card_id        uuid NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  amount_minor        bigint NOT NULL,
  reason              text,
  status              payment_status NOT NULL DEFAULT 'pending',
  provider_refund_id  text,
  created_by          uuid REFERENCES profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_refund_amount_positive CHECK (amount_minor > 0)
);
CREATE INDEX IF NOT EXISTS idx_refunds_payment   ON refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_refunds_gift_card ON refunds(gift_card_id);

-- =============================================================================
-- Ledger — immutable, append-only, source of truth for balance
-- =============================================================================
CREATE TABLE IF NOT EXISTS gift_card_ledger_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id        uuid NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  type                ledger_entry_type NOT NULL,
  amount_minor        bigint NOT NULL,   -- SIGNED: credits positive, debits negative
  currency            text NOT NULL DEFAULT 'ILS',
  balance_after_minor bigint NOT NULL,   -- running balance snapshot after this entry
  reference_type      text,              -- 'payment' | 'redemption' | 'reversal' | ...
  reference_id        uuid,
  reason              text,
  created_by          uuid REFERENCES profiles(id),
  approved_by         uuid REFERENCES profiles(id),
  idempotency_key     text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ledger_balance_nonneg CHECK (balance_after_minor >= 0)
);
CREATE INDEX IF NOT EXISTS idx_ledger_gift_card ON gift_card_ledger_entries(gift_card_id);
CREATE INDEX IF NOT EXISTS idx_ledger_type      ON gift_card_ledger_entries(type);
CREATE INDEX IF NOT EXISTS idx_ledger_reference ON gift_card_ledger_entries(reference_type, reference_id);
-- Partial-unique idempotency key (only enforced when a key is supplied).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_idempotency
  ON gift_card_ledger_entries(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- =============================================================================
-- Redemptions (in-store spend). One redemption == one ledger debit.
-- =============================================================================
CREATE TABLE IF NOT EXISTS gift_card_redemptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id          uuid NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  amount_minor          bigint NOT NULL,          -- POSITIVE amount redeemed
  balance_before_minor  bigint NOT NULL,
  balance_after_minor   bigint NOT NULL,
  employee_id           uuid NOT NULL REFERENCES profiles(id),
  store_location_id     uuid REFERENCES store_locations(id),
  idempotency_key       text NOT NULL UNIQUE,     -- double-spend guard
  sale_reference        text,
  receipt_number        text,
  note                  text,
  reversed_by_reversal_id uuid,                    -- FK added after reversals table
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_redemption_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT chk_redemption_after_nonneg    CHECK (balance_after_minor >= 0)
);
CREATE INDEX IF NOT EXISTS idx_redemptions_gift_card ON gift_card_redemptions(gift_card_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_employee  ON gift_card_redemptions(employee_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_store     ON gift_card_redemptions(store_location_id);

-- -----------------------------------------------------------------------------
-- redemption_reversals (manager-approved credit-back of a redemption)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS redemption_reversals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  redemption_id   uuid NOT NULL REFERENCES gift_card_redemptions(id) ON DELETE CASCADE,
  gift_card_id    uuid NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  amount_minor    bigint NOT NULL,        -- POSITIVE amount credited back
  reason          text NOT NULL,
  requested_by    uuid NOT NULL REFERENCES profiles(id),
  approved_by     uuid NOT NULL REFERENCES profiles(id),
  ledger_entry_id uuid REFERENCES gift_card_ledger_entries(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_reversal_amount_positive CHECK (amount_minor > 0)
);
CREATE INDEX IF NOT EXISTS idx_reversals_redemption ON redemption_reversals(redemption_id);
CREATE INDEX IF NOT EXISTS idx_reversals_gift_card  ON redemption_reversals(gift_card_id);

-- Wire the redemption -> reversal FK now that reversals exists.
DO $$ BEGIN
  ALTER TABLE gift_card_redemptions
    ADD CONSTRAINT fk_redemption_reversal
    FOREIGN KEY (reversed_by_reversal_id) REFERENCES redemption_reversals(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- Manual balance adjustments (admin/finance; write through the ledger)
-- =============================================================================
CREATE TABLE IF NOT EXISTS balance_adjustments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id    uuid NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  ledger_entry_id uuid REFERENCES gift_card_ledger_entries(id),
  type            ledger_entry_type NOT NULL,   -- manual_increase | manual_decrease | ...
  magnitude_minor bigint NOT NULL,              -- POSITIVE magnitude; sign implied by type
  reason          text NOT NULL,
  created_by      uuid NOT NULL REFERENCES profiles(id),
  approved_by     uuid REFERENCES profiles(id),
  idempotency_key text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_adjustment_magnitude_positive CHECK (magnitude_minor > 0)
);
CREATE INDEX IF NOT EXISTS idx_adjustments_gift_card ON balance_adjustments(gift_card_id);

-- =============================================================================
-- Delivery
-- =============================================================================
CREATE TABLE IF NOT EXISTS delivery_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id        uuid NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  channel             delivery_channel NOT NULL DEFAULT 'email',
  status              delivery_status NOT NULL DEFAULT 'pending',
  scheduled_for       timestamptz,
  attempts            integer NOT NULL DEFAULT 0,
  last_error          text,
  provider_message_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_delivery_attempts_nonneg CHECK (attempts >= 0)
);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_gift_card ON delivery_jobs(gift_card_id);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_status    ON delivery_jobs(status);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_due
  ON delivery_jobs(scheduled_for) WHERE status IN ('pending', 'scheduled');

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_job_id     uuid NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  attempt_number      integer NOT NULL,
  status              delivery_status NOT NULL,
  provider_message_id text,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_job ON delivery_attempts(delivery_job_id);

-- =============================================================================
-- Accounting documents (receipts / tax invoices from the accounting provider)
-- =============================================================================
CREATE TABLE IF NOT EXISTS accounting_documents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id          uuid REFERENCES gift_cards(id) ON DELETE SET NULL,
  payment_id            uuid REFERENCES payments(id) ON DELETE SET NULL,
  type                  accounting_document_type NOT NULL DEFAULT 'receipt',
  provider              text NOT NULL DEFAULT 'mock',
  provider_document_id  text,
  document_number       text,
  amount_minor          bigint NOT NULL,
  currency              text NOT NULL DEFAULT 'ILS',
  url                   text,
  status                text NOT NULL DEFAULT 'issued',
  issued_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_accdoc_amount_positive CHECK (amount_minor > 0)
);
CREATE INDEX IF NOT EXISTS idx_accdocs_gift_card ON accounting_documents(gift_card_id);
CREATE INDEX IF NOT EXISTS idx_accdocs_payment   ON accounting_documents(payment_id);

-- =============================================================================
-- Internal notes (staff annotations on a card)
-- =============================================================================
CREATE TABLE IF NOT EXISTS internal_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id  uuid NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  body          text NOT NULL,
  author_id     uuid NOT NULL REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notes_gift_card ON internal_notes(gift_card_id);

-- =============================================================================
-- Audit log (append-only)
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES profiles(id),
  actor_role  text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  reason      text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

-- =============================================================================
-- System settings (singleton) + generic idempotency keys
-- =============================================================================
CREATE TABLE IF NOT EXISTS system_settings (
  id                        integer PRIMARY KEY DEFAULT 1,
  business_name             text NOT NULL,
  business_email            text NOT NULL,
  business_phone            text NOT NULL,
  store_address             text NOT NULL,
  currency                  text NOT NULL DEFAULT 'ILS',
  timezone                  text NOT NULL DEFAULT 'Asia/Jerusalem',
  preset_amounts_minor      bigint[] NOT NULL DEFAULT ARRAY[10000, 20000, 30000, 50000]::bigint[],
  min_amount_minor          bigint NOT NULL DEFAULT 5000,
  max_amount_minor          bigint NOT NULL DEFAULT 500000,
  allow_custom_amount       boolean NOT NULL DEFAULT true,
  expiry_months             integer,            -- null = no expiry
  allow_partial_redemption  boolean NOT NULL DEFAULT true,
  greeting_max_length       integer NOT NULL DEFAULT 500,
  terms_url                 text NOT NULL DEFAULT '/terms',
  default_language          language NOT NULL DEFAULT 'he',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_settings_singleton CHECK (id = 1),
  CONSTRAINT chk_settings_min_le_max CHECK (min_amount_minor <= max_amount_minor)
);

-- Generic idempotency-key registry for one-shot server operations that don't
-- have a natural unique column of their own.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key         text PRIMARY KEY,
  scope       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_idempotency_scope ON idempotency_keys(scope);

-- =============================================================================
-- updated_at triggers on every mutable table
-- =============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'store_locations', 'gift_card_templates', 'gift_cards',
    'payments', 'refunds', 'delivery_jobs', 'accounting_documents',
    'system_settings'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;

-- =============================================================================
-- Seed the role catalogue (needed before user_roles can reference it)
-- =============================================================================
INSERT INTO roles (role, description) VALUES
  ('owner',          'Business owner. Full access to everything.'),
  ('admin',          'Administrator. Manage cards, templates, settings, staff.'),
  ('store_manager',  'Store manager. Redeem and approve reversals.'),
  ('store_employee', 'Store employee. Look up and redeem cards.'),
  ('finance',        'Finance. Read financials, issue refunds, adjustments.'),
  ('read_only',      'Read-only auditor. View, never mutate.')
ON CONFLICT (role) DO NOTHING;

-- >>>>>>>>>>>>>>>>>>>> supabase/migrations/0002_rls.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- 0002_rls.sql — Row-Level Security. DENY BY DEFAULT.
-- -----------------------------------------------------------------------------
-- Threat model (see docs/just-website-repository-audit.md §6/§7): the reference
-- site shipped `anon read using(true)` on `orders`, so anyone could read every
-- order. We must NOT repeat that. For gift cards specifically:
--
--   * Gift-card CODES, PUBLIC TOKENS, and BALANCES must NEVER be readable by the
--     anon role through a table policy. There is deliberately NO anon SELECT
--     policy on gift_cards (or ledger / redemptions / payments).
--   * The recipient's public view is served ONLY through the SECURITY DEFINER
--     function get_public_gift_card(token) (defined in 0003_functions.sql),
--     which returns a PII-minimized projection and never leaks the db id.
--   * Authenticated STAFF read/write is scoped by role via user_roles, checked
--     by the helper auth_has_role(app_role[]).
--   * The SERVICE ROLE (server-side, service_role key) has the BYPASSRLS
--     attribute in Supabase, so ALL privileged server writes bypass these
--     policies. We never grant broad write policies to anon/authenticated.
--
-- Model: enable RLS on every table. Add NO permissive policy unless a specific
-- authenticated read is required. Absence of a policy == access denied.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: does the current authenticated user hold ANY of the given roles?
-- SECURITY DEFINER so it can read user_roles/profiles regardless of the caller's
-- own RLS. Maps auth.uid() -> profiles.auth_user_id -> user_roles.role.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_has_role(p_roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN profiles p ON p.id = ur.profile_id
    WHERE p.auth_user_id = auth.uid()
      AND p.is_active
      AND ur.role = ANY (p_roles)
  );
$$;

-- Convenience: current user is any kind of staff (has at least one role).
CREATE OR REPLACE FUNCTION auth_is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN profiles p ON p.id = ur.profile_id
    WHERE p.auth_user_id = auth.uid() AND p.is_active
  );
$$;

REVOKE ALL ON FUNCTION auth_has_role(app_role[]) FROM public;
REVOKE ALL ON FUNCTION auth_is_staff() FROM public;
GRANT EXECUTE ON FUNCTION auth_has_role(app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION auth_is_staff() TO authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS + FORCE it on every table. FORCE means even the table owner is
-- subject to policies; only BYPASSRLS roles (service_role) skip them.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'roles', 'user_roles', 'store_locations', 'gift_card_templates',
    'gift_cards', 'payments', 'payment_events', 'refunds',
    'gift_card_ledger_entries', 'gift_card_redemptions', 'redemption_reversals',
    'balance_adjustments', 'delivery_jobs', 'delivery_attempts',
    'accounting_documents', 'internal_notes', 'audit_logs', 'system_settings',
    'idempotency_keys'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- Drop any policy we might be re-creating (idempotent re-runs).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;',
                   r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- =============================================================================
-- READ policies for authenticated STAFF, scoped by role.
-- No policy is granted to `anon`. No broad write policy is granted to anyone —
-- all mutations go through the service role (server) or the SECURITY DEFINER
-- RPCs. Read-only staff visibility below supports the admin dashboard.
-- =============================================================================

-- Financial + card data: any staff member may READ (dashboard, redemption UI).
-- Sensitive columns (code/token/balance) are still never exposed to anon.
CREATE POLICY staff_read_gift_cards ON gift_cards
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_ledger ON gift_card_ledger_entries
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_redemptions ON gift_card_redemptions
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_reversals ON redemption_reversals
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_payments ON payments
  FOR SELECT TO authenticated
  USING (auth_has_role(ARRAY['owner','admin','finance','read_only']::app_role[]));

CREATE POLICY staff_read_payment_events ON payment_events
  FOR SELECT TO authenticated
  USING (auth_has_role(ARRAY['owner','admin','finance','read_only']::app_role[]));

CREATE POLICY staff_read_refunds ON refunds
  FOR SELECT TO authenticated
  USING (auth_has_role(ARRAY['owner','admin','finance','read_only']::app_role[]));

CREATE POLICY staff_read_adjustments ON balance_adjustments
  FOR SELECT TO authenticated
  USING (auth_has_role(ARRAY['owner','admin','finance','read_only']::app_role[]));

CREATE POLICY staff_read_accounting_docs ON accounting_documents
  FOR SELECT TO authenticated
  USING (auth_has_role(ARRAY['owner','admin','finance','read_only']::app_role[]));

CREATE POLICY staff_read_delivery_jobs ON delivery_jobs
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_delivery_attempts ON delivery_attempts
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_notes ON internal_notes
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_audit ON audit_logs
  FOR SELECT TO authenticated
  USING (auth_has_role(ARRAY['owner','admin','finance','read_only']::app_role[]));

-- Catalogue / reference data: any staff member may read.
CREATE POLICY staff_read_templates ON gift_card_templates
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_store_locations ON store_locations
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_settings ON system_settings
  FOR SELECT TO authenticated
  USING (auth_is_staff());

-- Identity: a user may read their OWN profile; owner/admin may read all.
CREATE POLICY self_read_profile ON profiles
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid()
         OR auth_has_role(ARRAY['owner','admin']::app_role[]));

CREATE POLICY staff_read_roles ON roles
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY self_read_user_roles ON user_roles
  FOR SELECT TO authenticated
  USING (profile_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
         OR auth_has_role(ARRAY['owner','admin']::app_role[]));

-- =============================================================================
-- WRITE policies: intentionally NONE for anon/authenticated.
--
-- Every INSERT/UPDATE/DELETE on financial data is performed either by:
--   (a) the service role (server code holding SUPABASE_SERVICE_ROLE_KEY), which
--       bypasses RLS entirely, or
--   (b) a SECURITY DEFINER RPC (redeem_gift_card / activate_gift_card_from_payment),
--       which runs with the definer's privileges and enforces its own checks.
--
-- Redemptions in particular must go through redeem_gift_card() so the row lock,
-- idempotency, and atomic ledger+balance update are guaranteed. We therefore do
-- NOT grant staff a direct UPDATE on gift_cards.balance_minor — a direct
-- read-modify-write from app code is forbidden (docs/redemption-security.md).
-- =============================================================================

-- Anon gets NOTHING on any table. The recipient page calls get_public_gift_card()
-- (SECURITY DEFINER), the ONLY sanctioned anon-facing read path. That function
-- and its `GRANT EXECUTE ... TO anon` live in 0003_functions.sql (which runs
-- after this file, once the function exists).

-- >>>>>>>>>>>>>>>>>>>> supabase/migrations/0003_functions.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- 0003_functions.sql — atomic financial operations (plpgsql)
-- -----------------------------------------------------------------------------
-- These functions are the ONLY sanctioned way to mutate a card's balance.
-- App code must never do read-modify-write on balance_minor (see
-- docs/redemption-security.md). Each function runs in a single transaction and
-- is idempotent on its natural key.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- redeem_gift_card — atomic in-store redemption.
--
-- Guarantees:
--   * SELECT ... FOR UPDATE row lock on the card (serializes concurrent redeems,
--     prevents double-spend / overspend races).
--   * Idempotency: if a redemption with p_idempotency_key already exists, its
--     prior result is returned with out_status carrying the original card status
--     and code 'duplicate' (via out_code path below) — the caller never
--     double-charges.
--   * Validates: amount > 0, card exists, status redeemable, not expired,
--     sufficient balance.
--   * On success, in ONE transaction: insert ledger debit + redemption row +
--     update cached balance_minor + recompute status + insert audit log.
--
-- Returns one row. out_code is one of:
--   ok | duplicate | invalid_amount | not_found | not_redeemable |
--   expired | insufficient_balance
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS redeem_gift_card(uuid, bigint, uuid, uuid, text, text, text, text);
CREATE OR REPLACE FUNCTION redeem_gift_card(
  p_gift_card_id     uuid,
  p_amount_minor     bigint,
  p_employee_id      uuid,
  p_store_location_id uuid,
  p_idempotency_key  text,
  p_sale_reference   text,
  p_receipt_number   text,
  p_note             text
)
RETURNS TABLE (
  out_code          text,
  out_balance_after bigint,
  out_redemption_id uuid,
  out_status        gift_card_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card        gift_cards%ROWTYPE;
  v_existing    gift_card_redemptions%ROWTYPE;
  v_before      bigint;
  v_after       bigint;
  v_new_status  gift_card_status;
  v_redemption_id uuid;
BEGIN
  -- Idempotency: a replayed request returns the ORIGINAL result, no re-charge.
  -- Checked before locking so duplicates are cheap.
  SELECT * INTO v_existing
  FROM gift_card_redemptions
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    SELECT status INTO v_new_status FROM gift_cards WHERE id = v_existing.gift_card_id;
    RETURN QUERY SELECT 'duplicate'::text,
                        v_existing.balance_after_minor,
                        v_existing.id,
                        v_new_status;
    RETURN;
  END IF;

  -- Validate amount.
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RETURN QUERY SELECT 'invalid_amount'::text, NULL::bigint, NULL::uuid, NULL::gift_card_status;
    RETURN;
  END IF;

  -- Lock the card row. Everything below is serialized per-card.
  SELECT * INTO v_card
  FROM gift_cards
  WHERE id = p_gift_card_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::bigint, NULL::uuid, NULL::gift_card_status;
    RETURN;
  END IF;

  -- Only active / partially_redeemed cards can be spent.
  IF v_card.status NOT IN ('active', 'partially_redeemed') THEN
    RETURN QUERY SELECT 'not_redeemable'::text, v_card.balance_minor, NULL::uuid, v_card.status;
    RETURN;
  END IF;

  -- Expiry check (null expires_at == never expires).
  IF v_card.expires_at IS NOT NULL AND v_card.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, v_card.balance_minor, NULL::uuid, v_card.status;
    RETURN;
  END IF;

  -- Sufficient balance?
  IF p_amount_minor > v_card.balance_minor THEN
    RETURN QUERY SELECT 'insufficient_balance'::text, v_card.balance_minor, NULL::uuid, v_card.status;
    RETURN;
  END IF;

  v_before := v_card.balance_minor;
  v_after  := v_before - p_amount_minor;
  v_new_status := CASE WHEN v_after = 0 THEN 'fully_redeemed'::gift_card_status
                       ELSE 'partially_redeemed'::gift_card_status END;

  -- Insert the redemption (UNIQUE idempotency_key is the hard double-spend guard;
  -- a concurrent duplicate that slipped past the pre-check raises here).
  INSERT INTO gift_card_redemptions (
    gift_card_id, amount_minor, balance_before_minor, balance_after_minor,
    employee_id, store_location_id, idempotency_key, sale_reference,
    receipt_number, note
  ) VALUES (
    p_gift_card_id, p_amount_minor, v_before, v_after,
    p_employee_id, p_store_location_id, p_idempotency_key, p_sale_reference,
    p_receipt_number, p_note
  )
  RETURNING id INTO v_redemption_id;

  -- Immutable ledger debit (signed negative).
  INSERT INTO gift_card_ledger_entries (
    gift_card_id, type, amount_minor, currency, balance_after_minor,
    reference_type, reference_id, reason, created_by, idempotency_key
  ) VALUES (
    p_gift_card_id, 'redemption_debit', -p_amount_minor, v_card.currency, v_after,
    'redemption', v_redemption_id, 'in-store redemption', p_employee_id,
    'ledger:' || p_idempotency_key
  );

  -- Update the cached balance + status atomically in the same tx.
  UPDATE gift_cards
     SET balance_minor = v_after,
         status = v_new_status,
         updated_at = now()
   WHERE id = p_gift_card_id;

  -- Audit trail.
  INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, reason, metadata)
  VALUES (
    p_employee_id, 'store_employee', 'giftcard.redeemed', 'gift_card',
    p_gift_card_id::text, 'in-store redemption',
    jsonb_build_object(
      'amount_minor', p_amount_minor,
      'balance_after_minor', v_after,
      'redemption_id', v_redemption_id,
      'store_location_id', p_store_location_id,
      'sale_reference', p_sale_reference,
      'receipt_number', p_receipt_number
    )
  );

  RETURN QUERY SELECT 'ok'::text, v_after, v_redemption_id, v_new_status;
END;
$$;

-- -----------------------------------------------------------------------------
-- activate_gift_card_from_payment — idempotent activation on a verified payment
-- webhook. Keyed on the provider event id (payment_events unique constraint).
--
-- Steps (single tx):
--   1. Insert the payment_event; ON CONFLICT (provider, event_id) DO NOTHING.
--      If nothing inserted -> already processed -> return 'already_processed'.
--   2. Load + lock the card. Missing -> 'not_found'.
--   3. Reconcile amount against the card's authoritative initial_amount_minor.
--      Mismatch -> 'amount_mismatch' (NEVER trust the client amount).
--   4. Only activatable from draft/awaiting_payment/payment_processing/failed.
--   5. Insert initial_credit ledger + set balance + status active + issued_at,
--      mark the event processed. Return 'activated'.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS activate_gift_card_from_payment(uuid, text, text, text, bigint, text, jsonb);
CREATE OR REPLACE FUNCTION activate_gift_card_from_payment(
  p_gift_card_id       uuid,
  p_provider           text,
  p_event_id           text,
  p_provider_payment_id text,
  p_amount_minor       bigint,
  p_currency           text,
  p_raw_event          jsonb
)
RETURNS TABLE (
  out_code          text,
  out_balance_minor bigint,
  out_status        gift_card_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card       gift_cards%ROWTYPE;
  v_payment_id uuid;
  v_rowcount   integer := 0;
BEGIN
  -- Step 1: dedupe the provider event.
  INSERT INTO payment_events (
    gift_card_id, provider, event_id, event_type, amount_minor, currency, raw
  ) VALUES (
    p_gift_card_id, p_provider, p_event_id, 'payment.paid', p_amount_minor, p_currency, COALESCE(p_raw_event, '{}'::jsonb)
  )
  ON CONFLICT (provider, event_id) DO NOTHING;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    SELECT status, balance_minor INTO v_card.status, v_card.balance_minor
    FROM gift_cards WHERE id = p_gift_card_id;
    RETURN QUERY SELECT 'already_processed'::text, v_card.balance_minor, v_card.status;
    RETURN;
  END IF;

  -- Step 2: lock the card.
  SELECT * INTO v_card FROM gift_cards WHERE id = p_gift_card_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::bigint, NULL::gift_card_status;
    RETURN;
  END IF;

  -- Already active (e.g. a different event already activated it): idempotent.
  IF v_card.status IN ('active', 'partially_redeemed', 'fully_redeemed') THEN
    UPDATE payment_events SET processed_at = now()
      WHERE provider = p_provider AND event_id = p_event_id;
    RETURN QUERY SELECT 'already_processed'::text, v_card.balance_minor, v_card.status;
    RETURN;
  END IF;

  -- Step 3: reconcile the amount against our authoritative stored amount.
  IF p_amount_minor IS DISTINCT FROM v_card.initial_amount_minor THEN
    RETURN QUERY SELECT 'amount_mismatch'::text, v_card.balance_minor, v_card.status;
    RETURN;
  END IF;

  -- Step 4: must be in a pre-activation state.
  IF v_card.status NOT IN ('draft', 'awaiting_payment', 'payment_processing', 'failed') THEN
    RETURN QUERY SELECT 'not_activatable'::text, v_card.balance_minor, v_card.status;
    RETURN;
  END IF;

  -- Ensure a payment row exists / is marked paid.
  SELECT id INTO v_payment_id FROM payments WHERE gift_card_id = p_gift_card_id LIMIT 1;
  IF v_payment_id IS NULL THEN
    INSERT INTO payments (gift_card_id, provider, provider_payment_id, amount_minor, currency, status)
    VALUES (p_gift_card_id, p_provider, p_provider_payment_id, p_amount_minor, p_currency, 'paid')
    RETURNING id INTO v_payment_id;
  ELSE
    UPDATE payments
       SET status = 'paid',
           provider_payment_id = COALESCE(p_provider_payment_id, provider_payment_id),
           updated_at = now()
     WHERE id = v_payment_id;
  END IF;

  UPDATE payment_events SET payment_id = v_payment_id, processed_at = now()
    WHERE provider = p_provider AND event_id = p_event_id;

  -- Step 5: initial credit + activation, atomically.
  INSERT INTO gift_card_ledger_entries (
    gift_card_id, type, amount_minor, currency, balance_after_minor,
    reference_type, reference_id, reason, idempotency_key
  ) VALUES (
    p_gift_card_id, 'initial_credit', v_card.initial_amount_minor, v_card.currency,
    v_card.initial_amount_minor, 'payment', v_payment_id, 'initial gift card credit',
    'activate:' || p_provider || ':' || p_event_id
  );

  UPDATE gift_cards
     SET status = 'active',
         balance_minor = initial_amount_minor,
         payment_id = v_payment_id,
         issued_at = COALESCE(issued_at, now()),
         updated_at = now()
   WHERE id = p_gift_card_id
   RETURNING * INTO v_card;

  INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, reason, metadata)
  VALUES (
    NULL, 'system', 'giftcard.activated', 'gift_card', p_gift_card_id::text,
    'verified payment',
    jsonb_build_object('provider', p_provider, 'event_id', p_event_id,
                       'payment_id', v_payment_id, 'amount_minor', p_amount_minor)
  );

  RETURN QUERY SELECT 'activated'::text, v_card.balance_minor, v_card.status;
END;
$$;

-- -----------------------------------------------------------------------------
-- get_public_gift_card — the ONLY anon-facing read path (recipient page / QR).
-- SECURITY DEFINER so it can read gift_cards despite deny-by-default RLS, but it
-- returns a PII-MINIMIZED projection: no db id, no buyer PII, no payment data.
-- sender_name is suppressed when the card is anonymous. Lookup is by public
-- token only (never by code or id). Void/expired states are reflected honestly.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_public_gift_card(text);
CREATE OR REPLACE FUNCTION get_public_gift_card(p_token text)
RETURNS TABLE (
  status               gift_card_status,
  code                 text,
  recipient_name       text,
  sender_name          text,
  greeting             text,
  initial_amount_minor bigint,
  balance_minor        bigint,
  currency             text,
  language             language,
  template_id          uuid,
  issued_at            timestamptz,
  expires_at           timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- Reflect expiry even if a cron hasn't flipped the status yet.
    CASE WHEN gc.expires_at IS NOT NULL AND gc.expires_at <= now()
              AND gc.status IN ('active', 'partially_redeemed')
         THEN 'expired'::gift_card_status
         ELSE gc.status END              AS status,
    gc.code,
    gc.recipient_name,
    CASE WHEN gc.is_anonymous THEN NULL ELSE gc.buyer_name END AS sender_name,
    gc.greeting,
    gc.initial_amount_minor,
    gc.balance_minor,
    gc.currency,
    gc.recipient_language                AS language,
    gc.template_id,
    gc.issued_at,
    gc.expires_at
  FROM gift_cards gc
  WHERE gc.public_token = p_token
    -- Never surface a card that hasn't been issued or has been voided/reissued.
    AND gc.status NOT IN ('draft', 'awaiting_payment', 'payment_processing',
                          'failed', 'cancelled', 'reissued', 'refunded');
END;
$$;

-- Anon may execute ONLY the public lookup. The mutating RPCs are callable by the
-- service role (which owns them via SECURITY DEFINER) and are not granted to anon.
REVOKE ALL ON FUNCTION get_public_gift_card(text) FROM public;
REVOKE ALL ON FUNCTION redeem_gift_card(uuid, bigint, uuid, uuid, text, text, text, text) FROM public;
REVOKE ALL ON FUNCTION activate_gift_card_from_payment(uuid, text, text, text, bigint, text, jsonb) FROM public;

GRANT EXECUTE ON FUNCTION get_public_gift_card(text) TO anon, authenticated;
-- redeem / activate are invoked server-side with the service role; grant to
-- authenticated as well so an authenticated employee session can call redeem via
-- RPC (the function still enforces all business rules and idempotency).
GRANT EXECUTE ON FUNCTION redeem_gift_card(uuid, bigint, uuid, uuid, text, text, text, text) TO authenticated;

-- =============================================================================
-- Additional atomic operations used by lib/data/supabase-store.ts.
-- Same contract as above: plpgsql, SECURITY DEFINER, SET search_path=public,
-- lock the gift_cards row FOR UPDATE where balance changes, write a ledger row
-- and an audit row on every balance change, keep the cached balance_minor equal
-- to SUM(ledger.amount_minor), and recompute status with the redeem rules
-- (fully_redeemed at 0, partially_redeemed when < initial, active when == initial).
-- -----------------------------------------------------------------------------
-- Balance-cap note: apply_ledger_adjustment(manual_increase) and reversals can
-- legitimately raise the balance, and a manual increase may exceed the original
-- initial_amount_minor. The HARD invariant is balance_minor >= 0 (per the brief);
-- the "<= initial" cap is therefore dropped here so credits are not blocked.
-- =============================================================================
ALTER TABLE gift_cards DROP CONSTRAINT IF EXISTS chk_gc_balance_within_cap;

-- -----------------------------------------------------------------------------
-- Shared helper: balance-driven status recompute (mirrors statusForBalance in
-- lib/gift-cards/status.ts). Sticky statuses (suspended/cancelled/…) unchanged.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gc_status_for_balance(
  p_current gift_card_status, p_balance bigint, p_initial bigint
)
RETURNS gift_card_status
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_current NOT IN ('active', 'partially_redeemed') THEN p_current
    WHEN p_balance <= 0 THEN 'fully_redeemed'::gift_card_status
    WHEN p_balance < p_initial THEN 'partially_redeemed'::gift_card_status
    ELSE 'active'::gift_card_status
  END;
$$;

-- =============================================================================
-- 1) reverse_redemption — credit a redemption back (manager-approved).
-- =============================================================================
CREATE OR REPLACE FUNCTION reverse_redemption(
  p_redemption_id uuid,
  p_reason        text,
  p_requested_by  uuid,
  p_approved_by   uuid
)
RETURNS TABLE (out_code text, out_message text, out_reversal_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_red         gift_card_redemptions%ROWTYPE;
  v_card        gift_cards%ROWTYPE;
  v_after       bigint;
  v_new_status  gift_card_status;
  v_reversal_id uuid;
  v_ledger_id   uuid;
BEGIN
  SELECT * INTO v_red FROM gift_card_redemptions WHERE id = p_redemption_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, 'redemption not found'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_red.reversed_by_reversal_id IS NOT NULL THEN
    RETURN QUERY SELECT 'already_reversed'::text, 'redemption already reversed'::text,
                        v_red.reversed_by_reversal_id;
    RETURN;
  END IF;

  -- Lock the card; the reversal credits its balance back.
  SELECT * INTO v_card FROM gift_cards WHERE id = v_red.gift_card_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, 'gift card not found'::text, NULL::uuid;
    RETURN;
  END IF;

  v_after := v_card.balance_minor + v_red.amount_minor;
  -- A reversal credits balance back, so the card is spendable again. Un-stick a
  -- fully_redeemed card (the balance is now > 0): active if the full amount is
  -- restored, else partially_redeemed. Non-balance statuses (suspended/expired/
  -- cancelled/…) are left untouched — a reversal must not silently reactivate them.
  v_new_status := CASE
    WHEN v_card.status IN ('active', 'partially_redeemed', 'fully_redeemed')
      THEN CASE WHEN v_after >= v_card.initial_amount_minor
                THEN 'active'::gift_card_status
                ELSE 'partially_redeemed'::gift_card_status END
    ELSE v_card.status
  END;

  INSERT INTO redemption_reversals (redemption_id, gift_card_id, amount_minor, reason, requested_by, approved_by)
  VALUES (p_redemption_id, v_red.gift_card_id, v_red.amount_minor, p_reason, p_requested_by, p_approved_by)
  RETURNING id INTO v_reversal_id;

  INSERT INTO gift_card_ledger_entries (
    gift_card_id, type, amount_minor, currency, balance_after_minor,
    reference_type, reference_id, reason, created_by, approved_by, idempotency_key
  ) VALUES (
    v_red.gift_card_id, 'redemption_reversal_credit', v_red.amount_minor, v_card.currency, v_after,
    'reversal', v_reversal_id, p_reason, p_requested_by, p_approved_by,
    'reversal:' || v_reversal_id::text
  ) RETURNING id INTO v_ledger_id;

  UPDATE redemption_reversals SET ledger_entry_id = v_ledger_id WHERE id = v_reversal_id;
  UPDATE gift_card_redemptions SET reversed_by_reversal_id = v_reversal_id WHERE id = p_redemption_id;

  UPDATE gift_cards
     SET balance_minor = v_after, status = v_new_status, updated_at = now()
   WHERE id = v_red.gift_card_id;

  INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, reason, metadata)
  VALUES (p_approved_by, 'store_manager', 'redemption.reversed', 'gift_card',
          v_red.gift_card_id::text, p_reason,
          jsonb_build_object('redemption_id', p_redemption_id, 'reversal_id', v_reversal_id,
                             'amount_minor', v_red.amount_minor, 'balance_after_minor', v_after,
                             'requested_by', p_requested_by));

  RETURN QUERY SELECT 'ok'::text, NULL::text, v_reversal_id;
END;
$$;

-- =============================================================================
-- 2) apply_ledger_adjustment — manual credit/debit through the ledger.
-- =============================================================================
CREATE OR REPLACE FUNCTION apply_ledger_adjustment(
  p_gift_card_id    uuid,
  p_type            ledger_entry_type,
  p_magnitude_minor bigint,
  p_reason          text,
  p_created_by      uuid,
  p_approved_by     uuid,
  p_idempotency_key text
)
RETURNS TABLE (out_code text, out_balance_after bigint, out_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card       gift_cards%ROWTYPE;
  v_existing   gift_card_ledger_entries%ROWTYPE;
  v_signed     bigint;
  v_after      bigint;
  v_new_status gift_card_status;
BEGIN
  IF p_magnitude_minor IS NULL OR p_magnitude_minor <= 0 THEN
    RETURN QUERY SELECT 'invalid_amount'::text, NULL::bigint, 'magnitude must be > 0'::text;
    RETURN;
  END IF;

  -- Idempotency: replaying a keyed adjustment is a no-op that returns success.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM gift_card_ledger_entries WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN QUERY SELECT 'ok'::text, v_existing.balance_after_minor, 'duplicate'::text;
      RETURN;
    END IF;
  END IF;

  -- Sign the amount from the entry type.
  v_signed := CASE p_type
    WHEN 'manual_increase'             THEN  p_magnitude_minor
    WHEN 'redemption_reversal_credit'  THEN  p_magnitude_minor
    WHEN 'initial_credit'              THEN  p_magnitude_minor
    WHEN 'manual_decrease'             THEN -p_magnitude_minor
    WHEN 'refund_debit'                THEN -p_magnitude_minor
    WHEN 'expiration_adjustment'       THEN -p_magnitude_minor
    WHEN 'cancellation_adjustment'     THEN -p_magnitude_minor
    WHEN 'reissue_transfer'            THEN -p_magnitude_minor
    WHEN 'redemption_debit'            THEN -p_magnitude_minor
    ELSE NULL
  END;
  IF v_signed IS NULL THEN
    RETURN QUERY SELECT 'invalid_type'::text, NULL::bigint, 'unknown ledger entry type'::text;
    RETURN;
  END IF;

  SELECT * INTO v_card FROM gift_cards WHERE id = p_gift_card_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::bigint, 'gift card not found'::text;
    RETURN;
  END IF;

  v_after := v_card.balance_minor + v_signed;
  IF v_after < 0 THEN
    RETURN QUERY SELECT 'insufficient_balance'::text, v_card.balance_minor,
                        'adjustment would drive balance below zero'::text;
    RETURN;
  END IF;

  v_new_status := gc_status_for_balance(v_card.status, v_after, v_card.initial_amount_minor);

  INSERT INTO gift_card_ledger_entries (
    gift_card_id, type, amount_minor, currency, balance_after_minor,
    reason, created_by, approved_by, idempotency_key
  ) VALUES (
    p_gift_card_id, p_type, v_signed, v_card.currency, v_after,
    p_reason, p_created_by, p_approved_by, p_idempotency_key
  );

  UPDATE gift_cards
     SET balance_minor = v_after, status = v_new_status, updated_at = now()
   WHERE id = p_gift_card_id;

  INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, reason, metadata)
  VALUES (p_created_by, 'admin', 'giftcard.adjusted', 'gift_card', p_gift_card_id::text, p_reason,
          jsonb_build_object('type', p_type, 'amount_minor', v_signed,
                             'balance_after_minor', v_after, 'approved_by', p_approved_by));

  RETURN QUERY SELECT 'ok'::text, v_after, NULL::text;
END;
$$;

-- =============================================================================
-- 3) transition_gift_card_status — guarded lifecycle change (no balance change).
--    Transition map mirrors ALLOWED in lib/gift-cards/status.ts.
-- =============================================================================
CREATE OR REPLACE FUNCTION transition_gift_card_status(
  p_gift_card_id uuid,
  p_to           gift_card_status,
  p_actor_id     uuid,
  p_actor_role   text,
  p_reason       text
)
RETURNS TABLE (out_code text, out_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card    gift_cards%ROWTYPE;
  v_allowed gift_card_status[];
BEGIN
  SELECT * INTO v_card FROM gift_cards WHERE id = p_gift_card_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, 'gift card not found'::text;
    RETURN;
  END IF;

  v_allowed := CASE v_card.status
    WHEN 'draft'              THEN ARRAY['awaiting_payment','cancelled','failed']
    WHEN 'awaiting_payment'   THEN ARRAY['payment_processing','active','failed','cancelled']
    WHEN 'payment_processing' THEN ARRAY['active','failed','cancelled']
    WHEN 'active'             THEN ARRAY['partially_redeemed','fully_redeemed','suspended','cancelled','refunded','reissued','expired']
    WHEN 'partially_redeemed' THEN ARRAY['partially_redeemed','fully_redeemed','suspended','cancelled','refunded','reissued','expired']
    WHEN 'fully_redeemed'     THEN ARRAY['refunded','reissued']
    WHEN 'suspended'          THEN ARRAY['active','partially_redeemed','cancelled','refunded','expired']
    WHEN 'cancelled'          THEN ARRAY[]::text[]
    WHEN 'refunded'           THEN ARRAY[]::text[]
    WHEN 'reissued'           THEN ARRAY[]::text[]
    WHEN 'expired'            THEN ARRAY['suspended','active','partially_redeemed','reissued']
    WHEN 'failed'             THEN ARRAY['awaiting_payment','cancelled']
    ELSE ARRAY[]::text[]
  END::gift_card_status[];

  IF NOT (p_to = ANY (v_allowed)) THEN
    RETURN QUERY SELECT 'illegal_transition'::text,
      format('illegal transition %s -> %s', v_card.status, p_to)::text;
    RETURN;
  END IF;

  UPDATE gift_cards SET status = p_to, updated_at = now() WHERE id = p_gift_card_id;

  INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, reason, metadata)
  VALUES (p_actor_id, p_actor_role, 'giftcard.status.' || p_to::text, 'gift_card',
          p_gift_card_id::text, p_reason,
          jsonb_build_object('from', v_card.status, 'to', p_to));

  RETURN QUERY SELECT 'ok'::text, NULL::text;
END;
$$;

-- =============================================================================
-- 4) reissue_gift_card — void a card and mint a replacement carrying its balance.
-- =============================================================================
CREATE OR REPLACE FUNCTION reissue_gift_card(
  p_gift_card_id uuid,
  p_new_code     text,
  p_new_token    text,
  p_actor_id     uuid,
  p_actor_role   text,
  p_reason       text
)
RETURNS TABLE (out_code text, out_message text, out_new_card_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old        gift_cards%ROWTYPE;
  v_new_id     uuid;
  v_remaining  bigint;
  v_new_status gift_card_status;
BEGIN
  SELECT * INTO v_old FROM gift_cards WHERE id = p_gift_card_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, 'gift card not found'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_old.status NOT IN ('active','partially_redeemed','suspended','expired','fully_redeemed') THEN
    RETURN QUERY SELECT 'not_reissuable'::text,
      format('cannot reissue a card in status %s', v_old.status)::text, NULL::uuid;
    RETURN;
  END IF;

  v_remaining  := v_old.balance_minor;
  v_new_status := CASE WHEN v_remaining < v_old.initial_amount_minor
                       THEN 'partially_redeemed'::gift_card_status
                       ELSE 'active'::gift_card_status END;

  -- Mint the new card, copying identity/recipient/design and carrying the balance.
  INSERT INTO gift_cards (
    code, public_token, status, currency, initial_amount_minor, balance_minor,
    template_id, buyer_name, buyer_email, buyer_phone, buyer_company, buyer_tax_id,
    wants_invoice, is_anonymous, recipient_name, recipient_email, recipient_phone,
    recipient_language, delivery_channel, greeting, scheduled_delivery_at,
    sender_timezone, issued_at, expires_at
  ) VALUES (
    p_new_code, p_new_token, v_new_status, v_old.currency, v_old.initial_amount_minor, v_remaining,
    v_old.template_id, v_old.buyer_name, v_old.buyer_email, v_old.buyer_phone, v_old.buyer_company,
    v_old.buyer_tax_id, v_old.wants_invoice, v_old.is_anonymous, v_old.recipient_name,
    v_old.recipient_email, v_old.recipient_phone, v_old.recipient_language, v_old.delivery_channel,
    v_old.greeting, v_old.scheduled_delivery_at, v_old.sender_timezone, now(), v_old.expires_at
  ) RETURNING id INTO v_new_id;

  -- New card gets an initial_credit ledger for the transferred balance.
  INSERT INTO gift_card_ledger_entries (
    gift_card_id, type, amount_minor, currency, balance_after_minor,
    reference_type, reference_id, reason, created_by
  ) VALUES (
    v_new_id, 'initial_credit', v_remaining, v_old.currency, v_remaining,
    'reissue', p_gift_card_id, 'balance transferred from reissued card', p_actor_id
  );

  -- Old card: transfer its remaining balance out (debit to zero) and void it.
  IF v_remaining > 0 THEN
    INSERT INTO gift_card_ledger_entries (
      gift_card_id, type, amount_minor, currency, balance_after_minor,
      reference_type, reference_id, reason, created_by
    ) VALUES (
      p_gift_card_id, 'reissue_transfer', -v_remaining, v_old.currency, 0,
      'reissue', v_new_id, 'balance transferred to reissued card', p_actor_id
    );
  END IF;

  UPDATE gift_cards
     SET balance_minor = 0, status = 'reissued', superseded_by_card_id = v_new_id, updated_at = now()
   WHERE id = p_gift_card_id;

  INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, reason, metadata)
  VALUES (p_actor_id, p_actor_role, 'giftcard.reissued', 'gift_card', p_gift_card_id::text, p_reason,
          jsonb_build_object('new_card_id', v_new_id, 'transferred_minor', v_remaining,
                             'new_code', p_new_code));

  RETURN QUERY SELECT 'ok'::text, NULL::text, v_new_id;
END;
$$;

-- =============================================================================
-- 5) claim_due_delivery_jobs — atomic work-queue claim (FOR UPDATE SKIP LOCKED).
-- =============================================================================
CREATE OR REPLACE FUNCTION claim_due_delivery_jobs(
  p_now   timestamptz,
  p_limit integer
)
RETURNS SETOF delivery_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE delivery_jobs dj
     SET status = 'processing', attempts = dj.attempts + 1, updated_at = now()
   WHERE dj.id IN (
     SELECT d.id FROM delivery_jobs d
      WHERE (d.status = 'pending'   AND (d.scheduled_for IS NULL OR d.scheduled_for <= p_now))
         OR (d.status = 'scheduled' AND d.scheduled_for <= p_now)
         OR (d.status = 'failed'    AND d.attempts < 5)
      ORDER BY d.scheduled_for NULLS FIRST, d.created_at
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
   )
  RETURNING dj.*;
END;
$$;

-- Grants: server calls these with the service role (bypasses RLS); also allow an
-- authenticated staff session to invoke them (the functions enforce their own rules).
REVOKE ALL ON FUNCTION reverse_redemption(uuid, text, uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION apply_ledger_adjustment(uuid, ledger_entry_type, bigint, text, uuid, uuid, text) FROM public;
REVOKE ALL ON FUNCTION transition_gift_card_status(uuid, gift_card_status, uuid, text, text) FROM public;
REVOKE ALL ON FUNCTION reissue_gift_card(uuid, text, text, uuid, text, text) FROM public;
REVOKE ALL ON FUNCTION claim_due_delivery_jobs(timestamptz, integer) FROM public;

GRANT EXECUTE ON FUNCTION reverse_redemption(uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION apply_ledger_adjustment(uuid, ledger_entry_type, bigint, text, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION transition_gift_card_status(uuid, gift_card_status, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION reissue_gift_card(uuid, text, text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION claim_due_delivery_jobs(timestamptz, integer) TO authenticated;

-- >>>>>>>>>>>>>>>>>>>> supabase/seed.sql >>>>>>>>>>>>>>>>>>>>
-- =============================================================================
-- seed.sql — demo data mirroring lib/data/seed-data.ts
-- -----------------------------------------------------------------------------
-- Deterministic UUIDs so re-running is stable and cross-referenceable. No real
-- personal data. Money is integer minor units (agorot): ₪100 -> 10000.
-- Safe to run repeatedly (ON CONFLICT DO NOTHING everywhere).
--
-- Apply AFTER 0001/0002/0003. Run as the service role / owner (RLS is FORCEd;
-- seeding via psql as the db owner with service_role, or with RLS bypass).
-- =============================================================================

-- Amounts (agorot):
--   ₪300 = 30000   ₪500 = 50000   ₪100 = 10000   ₪200 = 20000
--   ₪250 = 25000   ₪180 = 18000   (₪500 - ₪180 = ₪320 = 32000)

-- -----------------------------------------------------------------------------
-- Staff profiles (owner / admin / manager / 2 employees / finance)
-- -----------------------------------------------------------------------------
INSERT INTO profiles (id, email, full_name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner@justasecond.example',     'נועה ברנט'),
  ('00000000-0000-0000-0000-000000000002', 'admin@justasecond.example',     'מנהל/ת מערכת'),
  ('00000000-0000-0000-0000-000000000003', 'manager@justasecond.example',   'מנהל/ת חנות'),
  ('00000000-0000-0000-0000-000000000004', 'employee1@justasecond.example', 'עובד/ת א'),
  ('00000000-0000-0000-0000-000000000005', 'employee2@justasecond.example', 'עובד/ת ב'),
  ('00000000-0000-0000-0000-000000000006', 'finance@justasecond.example',   'הנהלת חשבונות')
ON CONFLICT (id) DO NOTHING;

-- Role grants (roles catalogue is inserted by 0001_init.sql).
INSERT INTO user_roles (profile_id, role) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner'),
  ('00000000-0000-0000-0000-000000000002', 'admin'),
  ('00000000-0000-0000-0000-000000000003', 'store_manager'),
  ('00000000-0000-0000-0000-000000000004', 'store_employee'),
  ('00000000-0000-0000-0000-000000000005', 'store_employee'),
  ('00000000-0000-0000-0000-000000000006', 'finance')
ON CONFLICT (profile_id, role) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Store location (Tel Aviv)
-- -----------------------------------------------------------------------------
INSERT INTO store_locations (id, name, address, timezone, is_active) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Just A Second · תל אביב',
   'מנחם בגין 34, תל אביב', 'Asia/Jerusalem', true)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Templates (4)
-- -----------------------------------------------------------------------------
INSERT INTO gift_card_templates
  (id, name, occasion, language, background_color, text_color, accent_color, is_active, is_default) VALUES
  ('20000000-0000-0000-0000-000000000001', 'חגיגה',   'celebration', 'he', '#333D36', '#FFFCF5', '#E88225', true, true),
  ('20000000-0000-0000-0000-000000000002', 'יום הולדת','birthday',    'he', '#B5C9AD', '#333D36', '#C96A17', true, false),
  ('20000000-0000-0000-0000-000000000003', 'חג שמח',   'holiday',     'he', '#8FA688', '#FFFCF5', '#F4A866', true, false),
  ('20000000-0000-0000-0000-000000000005', 'תודה',     'general',     'he', '#F6F1E4', '#333D36', '#E88225', true, false),
  ('20000000-0000-0000-0000-000000000006', 'מכל הלב',  'celebration', 'he', '#4A524D', '#FFFCF5', '#F4A866', true, false),
  ('20000000-0000-0000-0000-000000000004', 'With Love','general',     'en', '#FFFCF5', '#333D36', '#E88225', true, false)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Gift cards (active / partially_redeemed / fully_redeemed / expired / suspended)
-- Each has a matching payment + initial_credit ledger entry; the two spent cards
-- also have a redemption row + redemption_debit ledger entry.
-- -----------------------------------------------------------------------------

-- 1) Active, full ₪300 balance
INSERT INTO gift_cards (
  id, code, public_token, status, currency, initial_amount_minor, balance_minor,
  template_id, buyer_name, buyer_email, buyer_phone, is_anonymous,
  recipient_name, recipient_email, recipient_phone, recipient_language, delivery_channel,
  greeting, sender_timezone, issued_at, expires_at, created_at
) VALUES (
  '30000000-0000-0000-0000-000000000001', 'JAS-7F3K-QP2M-9',
  'demo-token-active-2f8a9c1e5b7d3a4f6e0c', 'active', 'ILS', 30000, 30000,
  '20000000-0000-0000-0000-000000000001', 'דנה כהן', 'dana.buyer@example.com', '0501234567', false,
  'יעל לוי', 'yael.recipient@example.com', '0527654321', 'he', 'email',
  E'מזל טוב יעל!\nמגיע לך משהו יפה מהחנות.\nבאהבה, דנה', 'Asia/Jerusalem',
  now() - interval '10 days', now() + interval '355 days', now() - interval '10 days'
) ON CONFLICT (id) DO NOTHING;

-- 2) Partially redeemed: ₪500 -> ₪180 redeemed -> ₪320 remaining
INSERT INTO gift_cards (
  id, code, public_token, status, currency, initial_amount_minor, balance_minor,
  template_id, buyer_name, buyer_email, buyer_phone, is_anonymous,
  recipient_name, recipient_email, recipient_phone, recipient_language, delivery_channel,
  greeting, sender_timezone, issued_at, expires_at, created_at
) VALUES (
  '30000000-0000-0000-0000-000000000002', 'JAS-3M9T-XK4P-2',
  'demo-token-partial-6b1d8e2f4a9c3e7b5d0f', 'partially_redeemed', 'ILS', 50000, 32000,
  '20000000-0000-0000-0000-000000000002', 'דנה כהן', 'dana.buyer@example.com', '0501234567', false,
  'נועם ברק', 'yael.recipient@example.com', '0527654321', 'he', 'email',
  E'מזל טוב!\nמגיע לך משהו יפה מהחנות.\nבאהבה, דנה', 'Asia/Jerusalem',
  now() - interval '10 days', now() + interval '355 days', now() - interval '10 days'
) ON CONFLICT (id) DO NOTHING;

-- 3) Fully redeemed: ₪100 -> ₪100 redeemed -> ₪0
INSERT INTO gift_cards (
  id, code, public_token, status, currency, initial_amount_minor, balance_minor,
  template_id, buyer_name, buyer_email, is_anonymous,
  recipient_name, recipient_email, recipient_language, delivery_channel,
  greeting, sender_timezone, issued_at, expires_at, created_at
) VALUES (
  '30000000-0000-0000-0000-000000000003', 'JAS-8P2W-RT6N-5',
  'demo-token-full-1a2b3c4d5e6f7a8b9c0d', 'fully_redeemed', 'ILS', 10000, 0,
  '20000000-0000-0000-0000-000000000003', 'דנה כהן', 'dana.buyer@example.com', false,
  'יעל לוי', 'yael.recipient@example.com', 'he', 'email',
  E'מזל טוב יעל!\nבאהבה, דנה', 'Asia/Jerusalem',
  now() - interval '30 days', now() + interval '335 days', now() - interval '30 days'
) ON CONFLICT (id) DO NOTHING;

-- 4) Expired (unused ₪200, past expiry)
INSERT INTO gift_cards (
  id, code, public_token, status, currency, initial_amount_minor, balance_minor,
  template_id, buyer_name, buyer_email, is_anonymous,
  recipient_name, recipient_email, recipient_language, delivery_channel,
  greeting, sender_timezone, issued_at, expires_at, created_at
) VALUES (
  '30000000-0000-0000-0000-000000000004', 'JAS-QW1E-AS2D-7',
  'demo-token-expired-9f8e7d6c5b4a3f2e1d0c', 'expired', 'ILS', 20000, 20000,
  '20000000-0000-0000-0000-000000000001', 'דנה כהן', 'dana.buyer@example.com', false,
  'יעל לוי', 'yael.recipient@example.com', 'he', 'email',
  E'מזל טוב יעל!\nבאהבה, דנה', 'Asia/Jerusalem',
  now() - interval '400 days', now() - interval '5 days', now() - interval '400 days'
) ON CONFLICT (id) DO NOTHING;

-- 5) Suspended (₪250 balance frozen)
INSERT INTO gift_cards (
  id, code, public_token, status, currency, initial_amount_minor, balance_minor,
  template_id, buyer_name, buyer_email, is_anonymous,
  recipient_name, recipient_email, recipient_language, delivery_channel,
  greeting, sender_timezone, issued_at, expires_at, created_at
) VALUES (
  '30000000-0000-0000-0000-000000000005', 'JAS-ZX3C-VB4N-8',
  'demo-token-suspended-3c2b1a0f9e8d7c6b5a4f', 'suspended', 'ILS', 25000, 25000,
  '20000000-0000-0000-0000-000000000001', 'דנה כהן', 'dana.buyer@example.com', false,
  'יעל לוי', 'yael.recipient@example.com', 'he', 'email',
  E'מזל טוב יעל!\nבאהבה, דנה', 'Asia/Jerusalem',
  now() - interval '20 days', now() + interval '345 days', now() - interval '20 days'
) ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Payments (one per card, all 'paid') + link back to the card
-- -----------------------------------------------------------------------------
INSERT INTO payments (id, gift_card_id, provider, provider_payment_id, provider_checkout_id, amount_minor, currency, status) VALUES
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'mock', 'mock_pay_JAS-7F3K-QP2M-9', 'mock_cs_JAS-7F3K-QP2M-9', 30000, 'ILS', 'paid'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'mock', 'mock_pay_JAS-3M9T-XK4P-2', 'mock_cs_JAS-3M9T-XK4P-2', 50000, 'ILS', 'paid'),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'mock', 'mock_pay_JAS-8P2W-RT6N-5', 'mock_cs_JAS-8P2W-RT6N-5', 10000, 'ILS', 'paid'),
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', 'mock', 'mock_pay_JAS-QW1E-AS2D-7', 'mock_cs_JAS-QW1E-AS2D-7', 20000, 'ILS', 'paid'),
  ('40000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000005', 'mock', 'mock_pay_JAS-ZX3C-VB4N-8', 'mock_cs_JAS-ZX3C-VB4N-8', 25000, 'ILS', 'paid')
ON CONFLICT (id) DO NOTHING;

UPDATE gift_cards gc SET payment_id = p.id
FROM payments p
WHERE p.gift_card_id = gc.id AND gc.payment_id IS NULL;

-- -----------------------------------------------------------------------------
-- Ledger: initial_credit for every card
-- -----------------------------------------------------------------------------
INSERT INTO gift_card_ledger_entries
  (id, gift_card_id, type, amount_minor, currency, balance_after_minor, reference_type, reference_id, reason) VALUES
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'initial_credit', 30000, 'ILS', 30000, 'payment', '40000000-0000-0000-0000-000000000001', 'initial gift card credit'),
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'initial_credit', 50000, 'ILS', 50000, 'payment', '40000000-0000-0000-0000-000000000002', 'initial gift card credit'),
  ('50000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'initial_credit', 10000, 'ILS', 10000, 'payment', '40000000-0000-0000-0000-000000000003', 'initial gift card credit'),
  ('50000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', 'initial_credit', 20000, 'ILS', 20000, 'payment', '40000000-0000-0000-0000-000000000004', 'initial gift card credit'),
  ('50000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000005', 'initial_credit', 25000, 'ILS', 25000, 'payment', '40000000-0000-0000-0000-000000000005', 'initial gift card credit')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Redemptions + matching redemption_debit ledger entries (partial + full cards)
-- -----------------------------------------------------------------------------
INSERT INTO gift_card_redemptions
  (id, gift_card_id, amount_minor, balance_before_minor, balance_after_minor, employee_id, store_location_id, idempotency_key, sale_reference, created_at) VALUES
  ('60000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 18000, 50000, 32000,
   '00000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'seed-JAS-3M9T-XK4P-2-0', 'SALE-1000', now() - interval '3 days'),
  ('60000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', 10000, 10000, 0,
   '00000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'seed-JAS-8P2W-RT6N-5-1', 'SALE-1001', now() - interval '3 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO gift_card_ledger_entries
  (id, gift_card_id, type, amount_minor, currency, balance_after_minor, reference_type, reference_id, reason, created_by, created_at) VALUES
  ('50000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000002', 'redemption_debit', -18000, 'ILS', 32000, 'redemption', '60000000-0000-0000-0000-000000000001', 'in-store redemption', '00000000-0000-0000-0000-000000000004', now() - interval '3 days'),
  ('50000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000003', 'redemption_debit', -10000, 'ILS', 0,     'redemption', '60000000-0000-0000-0000-000000000002', 'in-store redemption', '00000000-0000-0000-0000-000000000005', now() - interval '3 days')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Delivery jobs (one per card; the active/partial/full delivered)
-- -----------------------------------------------------------------------------
INSERT INTO delivery_jobs (id, gift_card_id, channel, status, attempts, provider_message_id) VALUES
  ('70000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'email', 'delivered', 1, 'log_JAS-7F3K-QP2M-9'),
  ('70000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'email', 'delivered', 1, 'log_JAS-3M9T-XK4P-2'),
  ('70000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'email', 'delivered', 1, 'log_JAS-8P2W-RT6N-5'),
  ('70000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', 'email', 'delivered', 1, 'log_JAS-QW1E-AS2D-7'),
  ('70000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000005', 'email', 'delivered', 1, 'log_JAS-ZX3C-VB4N-8')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Audit trail for the activations + redemptions
-- -----------------------------------------------------------------------------
INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, reason) VALUES
  (NULL, 'system', 'giftcard.activated', 'gift_card', '30000000-0000-0000-0000-000000000001', 'verified payment'),
  (NULL, 'system', 'giftcard.activated', 'gift_card', '30000000-0000-0000-0000-000000000002', 'verified payment'),
  (NULL, 'system', 'giftcard.activated', 'gift_card', '30000000-0000-0000-0000-000000000003', 'verified payment'),
  (NULL, 'system', 'giftcard.activated', 'gift_card', '30000000-0000-0000-0000-000000000004', 'verified payment'),
  (NULL, 'system', 'giftcard.activated', 'gift_card', '30000000-0000-0000-0000-000000000005', 'verified payment'),
  ('00000000-0000-0000-0000-000000000004', 'store_employee', 'giftcard.redeemed', 'gift_card', '30000000-0000-0000-0000-000000000002', 'in-store redemption'),
  ('00000000-0000-0000-0000-000000000005', 'store_employee', 'giftcard.redeemed', 'gift_card', '30000000-0000-0000-0000-000000000003', 'in-store redemption')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- System settings (singleton, id=1). Presets [₪100,₪250,₪500,₪1000], min ₪50,
-- max ₪5000, expiry 12 months, partial redemption allowed.
-- -----------------------------------------------------------------------------
INSERT INTO system_settings (
  id, business_name, business_email, business_phone, store_address, currency, timezone,
  preset_amounts_minor, min_amount_minor, max_amount_minor, allow_custom_amount,
  expiry_months, allow_partial_redemption, greeting_max_length, terms_url, default_language
) VALUES (
  1, 'Just A Second · ג׳אסט א סקונד', 'hello@justasecond.example', '03-5555555',
  'מנחם בגין 34, תל אביב', 'ILS', 'Asia/Jerusalem',
  ARRAY[10000, 25000, 50000, 100000]::bigint[], 5000, 500000, true,
  12, true, 500, '/terms', 'he'
) ON CONFLICT (id) DO NOTHING;

