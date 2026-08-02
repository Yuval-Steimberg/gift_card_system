-- =============================================================================
-- reset-gift-cards.sql — DELETE EVERY GIFT CARD AND ALL ITS HISTORY
-- -----------------------------------------------------------------------------
-- ⚠️ DESTRUCTIVE AND IRREVERSIBLE. Run it on a test/demo database, or when the
-- store is deliberately starting from a clean slate before going public.
--
-- Removes: every row of gift_cards, plus the payments, payment events, refunds,
-- ledger entries, redemptions, reversals, balance adjustments, delivery jobs and
-- attempts, accounting documents, internal notes, gift-card audit entries and
-- idempotency keys that belong to them.
--
-- KEEPS: system_settings, gift_card_templates (designs), store_locations, and
-- staff (profiles / user_roles). The store stays configured and ready to sell —
-- only the sales history goes.
--
-- AFTER RUNNING: /admin reads its figures straight from these tables, so the
-- dashboard drops to ₪0 sales / ₪0 outstanding / ₪0 redeemed and 0 cards in
-- every status, and the שוברים list is empty. Reload the page (no redeploy).
--
-- HOW: Supabase → SQL Editor → paste the WHOLE file → Run (service role / owner;
-- RLS is FORCEd). Idempotent: running it twice deletes nothing the second time.
--
-- Everything lives in ONE `DO` block on purpose: the Supabase SQL Editor commits
-- each statement on its own, so a script built from separate statements (or from
-- temp tables) is neither atomic nor able to pass state along. A DO block is a
-- single statement — it either fully applies or fully rolls back.
--
-- WANT TO KEEP SOME CARDS? Put their codes in `keep_codes` on the first line of
-- the block — those cards and their history survive. Leave it empty to delete
-- everything.
-- =============================================================================

DO $$
DECLARE
  -- e.g. ARRAY['JAS-4ZKX-QRT0-C', 'JAS-FTT1-R3GV-C']
  keep_codes  text[] := ARRAY[]::text[];
  doomed      uuid[];
  n_cards     integer;
  v_sales     bigint;
BEGIN
  SELECT array_agg(id), count(*), coalesce(sum(initial_amount_minor), 0)
    INTO doomed, n_cards, v_sales
  FROM gift_cards
  WHERE NOT (code = ANY (keep_codes));

  IF doomed IS NULL THEN
    RAISE NOTICE 'No gift cards to delete — nothing changed.';
    RETURN;
  END IF;

  RAISE NOTICE 'Deleting % gift card(s), % ILS of recorded value.', n_cards, v_sales / 100.0;

  -- 1) Audit trail for those cards. audit_logs.entity_id is TEXT and is not a
  --    foreign key, so nothing cascades to it and the ids need an explicit cast.
  DELETE FROM audit_logs
  WHERE entity_type = 'gift_card'
    AND entity_id IN (SELECT unnest(doomed)::text);

  -- 2) Break the two pointers that would otherwise block the delete: the card ->
  --    payment link, and the reissue chain (card -> superseding card).
  UPDATE gift_cards SET payment_id = NULL            WHERE id = ANY (doomed);
  UPDATE gift_cards SET superseded_by_card_id = NULL WHERE superseded_by_card_id = ANY (doomed);

  -- 3) Rows whose FK is ON DELETE SET NULL — they would survive as orphans, so
  --    delete them explicitly.
  DELETE FROM payment_events       WHERE gift_card_id = ANY (doomed);
  DELETE FROM accounting_documents WHERE gift_card_id = ANY (doomed);

  -- 4) The cards themselves. ON DELETE CASCADE removes payments, refunds, ledger
  --    entries, redemptions, reversals, balance adjustments, delivery jobs (and
  --    their attempts) and internal notes along with them.
  DELETE FROM gift_cards WHERE id = ANY (doomed);

  -- 5) Standalone rows with no FK to a card: idempotency keys guarding replays of
  --    the purchases just deleted, and provider callbacks that never matched a
  --    card (gift_card_id IS NULL). Cleared only when nothing was kept.
  IF coalesce(array_length(keep_codes, 1), 0) = 0 THEN
    DELETE FROM idempotency_keys;
    DELETE FROM payment_events;
  END IF;

  RAISE NOTICE 'Done. Settings, designs, store locations and staff were kept.';
END $$;

-- -----------------------------------------------------------------------------
-- Verify: every count should be 0 (or only the cards you chose to keep).
-- These are exactly the figures /admin shows on the סקירה screen.
-- -----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM gift_cards)                                  AS cards,
  (SELECT count(*) FROM payments)                                    AS payments,
  (SELECT count(*) FROM gift_card_ledger_entries)                    AS ledger_entries,
  (SELECT count(*) FROM gift_card_redemptions)                       AS redemptions,
  (SELECT count(*) FROM delivery_jobs)                               AS delivery_jobs,
  -- same status set getAdminStats() counts as "sold"
  (SELECT coalesce(sum(initial_amount_minor), 0) / 100.0 FROM gift_cards
     WHERE status IN ('active', 'partially_redeemed', 'fully_redeemed',
                      'expired', 'suspended'))                       AS total_sales_ils,
  (SELECT coalesce(sum(balance_minor), 0) / 100.0 FROM gift_cards
     WHERE status IN ('active', 'partially_redeemed', 'suspended'))  AS outstanding_ils,
  (SELECT count(*) FROM gift_card_templates)                         AS designs_kept,
  (SELECT count(*) FROM store_locations)                             AS stores_kept,
  (SELECT count(*) FROM system_settings)                             AS settings_kept;
