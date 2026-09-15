-- =============================================================================
-- 0005 — resolve the paid card INSIDE the activation transaction
--
-- WHY: Grow's Payment-Links callback does not echo our order_ref (gotcha #8d),
-- so the payment has to be matched back to a card by payer email + amount. That
-- matching used to happen in the app, in a separate round-trip BEFORE calling
-- activate_gift_card_from_payment, with three holes — each of which ends as
-- "the customer paid and the recipient never got a card":
--
--   1. NOT ATOMIC. The lookup and the activation were two statements with no
--      lock between them, so two callbacks arriving together (a company buying
--      several cards in one sitting) could both resolve to the SAME newest
--      pending card. One activated it; the other got 'already_processed' and
--      its card stayed unpaid forever, silently.
--   2. BUYER EMAIL ONLY. A card bought for a colleague, or paid by an office
--      manager / bookkeeper whose address differs from the one typed into our
--      checkout, matched nothing at all.
--   3. ilike WITH A RAW ADDRESS. `_` and `%` are ilike WILDCARDS and `_` is
--      perfectly legal in an email local part, so `yoav_cohen@x.com` could match
--      a DIFFERENT buyer's card and activate the wrong one.
--
-- FIX: the function now takes the fallback match keys and resolves the card
-- itself, in the same transaction, with FOR UPDATE SKIP LOCKED — a concurrent
-- callback skips the row another one is already claiming and takes the next
-- candidate instead of colliding on it. Matching is case-insensitive EQUALITY
-- (no wildcards), accepts the buyer OR the recipient address, requires the exact
-- amount, and is bounded to a recent window so an ancient abandoned draft can
-- never absorb today's payment.
--
-- A callback that still matches nothing now returns 'unmatched' AND records the
-- event (gift_card_id NULL) instead of vanishing — so it is queryable, and the
-- provider's retry is still deduped.
--
-- Re-running this file is safe.
-- =============================================================================

-- Makes the fallback lookup an index scan instead of a seq scan over every card.
CREATE INDEX IF NOT EXISTS idx_gift_cards_match_buyer_email
  ON gift_cards(lower(buyer_email), initial_amount_minor);
CREATE INDEX IF NOT EXISTS idx_gift_cards_match_recipient_email
  ON gift_cards(lower(recipient_email), initial_amount_minor);

-- The return signature gains out_gift_card_id, so the old function must go.
DROP FUNCTION IF EXISTS activate_gift_card_from_payment(uuid, text, text, text, bigint, text, jsonb);

CREATE OR REPLACE FUNCTION activate_gift_card_from_payment(
  p_gift_card_id        uuid,
  p_provider            text,
  p_event_id            text,
  p_provider_payment_id text,
  p_amount_minor        bigint,
  p_currency            text,
  p_raw_event           jsonb,
  -- Fallback matching, used only when p_gift_card_id is NULL / unknown.
  p_match_email         text     DEFAULT NULL,
  p_match_window        interval DEFAULT interval '30 days'
)
RETURNS TABLE (
  out_code          text,
  out_balance_minor bigint,
  out_status        gift_card_status,
  out_gift_card_id  uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card       gift_cards%ROWTYPE;
  v_card_id    uuid := p_gift_card_id;
  v_payment_id uuid;
  v_rowcount   integer := 0;
BEGIN
  -- Step 0: resolve WHICH card this payment is for, and lock it, before doing
  -- anything else. Everything below runs in this same transaction, so the lock
  -- taken here is still held when the card is activated.
  IF v_card_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM gift_cards WHERE id = v_card_id) THEN
    v_card_id := NULL;  -- provider echoed a reference we don't know
  END IF;

  IF v_card_id IS NULL AND p_match_email IS NOT NULL AND btrim(p_match_email) <> '' THEN
    SELECT gc.id INTO v_card_id
      FROM gift_cards gc
     WHERE gc.status IN ('draft', 'awaiting_payment', 'payment_processing', 'failed')
       -- Exact amount: a match can never produce an amount_mismatch below.
       AND gc.initial_amount_minor = p_amount_minor
       -- EQUALITY, not ilike: '_' and '%' are wildcards in a LIKE pattern and
       -- both are legal in an email address.
       AND (lower(gc.buyer_email)     = lower(btrim(p_match_email))
         OR lower(gc.recipient_email) = lower(btrim(p_match_email)))
       AND gc.created_at > now() - p_match_window
     ORDER BY gc.created_at DESC
       FOR UPDATE SKIP LOCKED
     LIMIT 1;
  END IF;

  -- Step 1: dedupe the provider event. Recorded even when unmatched (gift_card_id
  -- is nullable) so the callback is not lost and a retry is still deduped.
  INSERT INTO payment_events (
    gift_card_id, provider, event_id, event_type, amount_minor, currency, raw
  ) VALUES (
    v_card_id, p_provider, p_event_id,
    CASE WHEN v_card_id IS NULL THEN 'payment.unmatched' ELSE 'payment.paid' END,
    p_amount_minor, p_currency, COALESCE(p_raw_event, '{}'::jsonb)
  )
  ON CONFLICT (provider, event_id) DO NOTHING;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    SELECT pe.gift_card_id INTO v_card_id
      FROM payment_events pe
     WHERE pe.provider = p_provider AND pe.event_id = p_event_id;
    SELECT status, balance_minor INTO v_card.status, v_card.balance_minor
      FROM gift_cards WHERE id = v_card_id;
    RETURN QUERY SELECT 'already_processed'::text, v_card.balance_minor, v_card.status, v_card_id;
    RETURN;
  END IF;

  IF v_card_id IS NULL THEN
    -- Money was taken and we cannot tell which order it belongs to. Loud, and
    -- queryable (see supabase/diagnose-delivery.sql).
    INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, reason, metadata)
    VALUES (
      NULL, 'system', 'payment.webhook_unmatched', 'payment_event', p_event_id,
      format('no card matched (email=%s amount=%s)', COALESCE(p_match_email, '—'), p_amount_minor),
      jsonb_build_object('provider', p_provider, 'event_id', p_event_id,
                         'amount_minor', p_amount_minor, 'match_email', p_match_email)
    );
    RETURN QUERY SELECT 'unmatched'::text, NULL::bigint, NULL::gift_card_status, NULL::uuid;
    RETURN;
  END IF;

  -- Step 2: lock the card (a no-op re-lock when Step 0 already locked it).
  SELECT * INTO v_card FROM gift_cards WHERE id = v_card_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::bigint, NULL::gift_card_status, v_card_id;
    RETURN;
  END IF;

  -- Already active (e.g. a different event already activated it): idempotent.
  IF v_card.status IN ('active', 'partially_redeemed', 'fully_redeemed') THEN
    UPDATE payment_events SET processed_at = now()
      WHERE provider = p_provider AND event_id = p_event_id;
    RETURN QUERY SELECT 'already_processed'::text, v_card.balance_minor, v_card.status, v_card_id;
    RETURN;
  END IF;

  -- Step 3: reconcile the amount against our authoritative stored amount.
  IF p_amount_minor IS DISTINCT FROM v_card.initial_amount_minor THEN
    RETURN QUERY SELECT 'amount_mismatch'::text, v_card.balance_minor, v_card.status, v_card_id;
    RETURN;
  END IF;

  -- Step 4: must be in a pre-activation state.
  IF v_card.status NOT IN ('draft', 'awaiting_payment', 'payment_processing', 'failed') THEN
    RETURN QUERY SELECT 'not_activatable'::text, v_card.balance_minor, v_card.status, v_card_id;
    RETURN;
  END IF;

  -- Ensure a payment row exists / is marked paid.
  SELECT id INTO v_payment_id FROM payments WHERE gift_card_id = v_card_id LIMIT 1;
  IF v_payment_id IS NULL THEN
    INSERT INTO payments (gift_card_id, provider, provider_payment_id, amount_minor, currency, status)
    VALUES (v_card_id, p_provider, p_provider_payment_id, p_amount_minor, p_currency, 'paid')
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
    v_card_id, 'initial_credit', v_card.initial_amount_minor, v_card.currency,
    v_card.initial_amount_minor, 'payment', v_payment_id, 'initial gift card credit',
    'activate:' || p_provider || ':' || p_event_id
  );

  UPDATE gift_cards
     SET status = 'active',
         balance_minor = initial_amount_minor,
         payment_id = v_payment_id,
         issued_at = COALESCE(issued_at, now()),
         updated_at = now()
   WHERE id = v_card_id
   RETURNING * INTO v_card;

  INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, reason, metadata)
  VALUES (
    NULL, 'system', 'giftcard.activated', 'gift_card', v_card_id::text,
    'verified payment',
    jsonb_build_object('provider', p_provider, 'event_id', p_event_id,
                       'payment_id', v_payment_id, 'amount_minor', p_amount_minor,
                       'matched_by', CASE WHEN p_gift_card_id IS NULL THEN 'email+amount' ELSE 'order_ref' END)
  );

  RETURN QUERY SELECT 'activated'::text, v_card.balance_minor, v_card.status, v_card_id;
END;
$$;

-- Service role ONLY (it bypasses this): activating a card from a payment must
-- never be callable by a signed-in client. Mirrors 0003 — no grant to
-- `authenticated`, unlike the staff-facing functions.
REVOKE ALL ON FUNCTION activate_gift_card_from_payment(uuid, text, text, text, bigint, text, jsonb, text, interval) FROM public;
