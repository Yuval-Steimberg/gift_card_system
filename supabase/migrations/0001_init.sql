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
