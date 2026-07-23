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
