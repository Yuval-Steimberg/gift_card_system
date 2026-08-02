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
-- HOW: Supabase → SQL Editor → paste → Run (service role / owner; RLS is FORCEd).
-- Idempotent: running it twice simply deletes nothing the second time.
--
-- WANT TO KEEP SOME CARDS? Fill in the KEEP_CODES list below — those codes and
-- their history survive. Leave it empty to delete everything.
-- =============================================================================

BEGIN;

-- Codes to PRESERVE, e.g. VALUES ('JAS-4ZKX-QRT0-C'), ('JAS-FTT1-R3GV-C').
-- Leave the "WHERE false" row as the only entry to keep nothing.
CREATE TEMP TABLE keep_codes (code text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO keep_codes (code)
SELECT code FROM (VALUES ('')) AS v(code) WHERE false;

-- The cards being removed.
CREATE TEMP TABLE doomed_cards (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO doomed_cards (id)
SELECT id FROM gift_cards WHERE code NOT IN (SELECT code FROM keep_codes);

-- What is about to go (shown in the SQL Editor output).
SELECT count(*) AS cards_to_delete,
       coalesce(sum(gc.initial_amount_minor), 0) / 100.0 AS sales_value_ils
FROM gift_cards gc JOIN doomed_cards d ON d.id = gc.id;

-- 1) Audit trail for those cards (audit_logs.entity_id is not a FK, so nothing
--    cascades to it).
DELETE FROM audit_logs
WHERE entity_type = 'gift_card'
  AND entity_id IN (SELECT id::text FROM doomed_cards);  -- entity_id is text

-- 2) Break the two pointers that would otherwise block the delete: the card ->
--    payment link, and the reissue chain (card -> superseding card).
UPDATE gift_cards SET payment_id = NULL
WHERE id IN (SELECT id FROM doomed_cards);

UPDATE gift_cards SET superseded_by_card_id = NULL
WHERE superseded_by_card_id IN (SELECT id FROM doomed_cards);

-- 3) Rows whose FK is ON DELETE SET NULL — they would survive as orphans, so
--    delete them explicitly.
DELETE FROM payment_events       WHERE gift_card_id IN (SELECT id FROM doomed_cards);
DELETE FROM accounting_documents WHERE gift_card_id IN (SELECT id FROM doomed_cards);

-- 4) The cards themselves. ON DELETE CASCADE removes payments, refunds, ledger
--    entries, redemptions, reversals, balance adjustments, delivery jobs (and
--    their attempts) and internal notes along with them.
DELETE FROM gift_cards WHERE id IN (SELECT id FROM doomed_cards);

-- 5) Standalone rows with no FK to a card: the idempotency keys guarding replays
--    of the purchases just deleted, and provider callbacks that never matched a
--    card (gift_card_id IS NULL). Cleared only when nothing was kept.
DELETE FROM idempotency_keys
WHERE NOT EXISTS (SELECT 1 FROM keep_codes);

DELETE FROM payment_events
WHERE NOT EXISTS (SELECT 1 FROM keep_codes);

COMMIT;

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
  (SELECT count(*) FROM system_settings)                             AS settings_kept;
