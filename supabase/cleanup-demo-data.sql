-- =============================================================================
-- cleanup-demo-data.sql — purge the old demo/sample rows from a live database
-- -----------------------------------------------------------------------------
-- WHY: earlier versions of supabase/seed.sql inserted 5 sample gift cards (₪300,
-- ₪500, ₪100, ₪200, ₪250) with matching payments, ledger entries, redemptions,
-- delivery jobs and audit rows, plus 6 fake staff profiles. /admin computes every
-- figure it shows from those tables, so the dashboard reported ~₪1,150 of sales
-- and ₪280 redeemed that never happened. This script deletes them, leaving ONLY
-- real purchases behind.
--
-- HOW: paste into Supabase → SQL Editor → Run (service role / owner; RLS is
-- FORCEd). Safe to run more than once, and safe on a database that was never
-- seeded — every statement targets the seed's deterministic UUIDs only. Real
-- cards have random UUIDs and are never matched.
--
-- Verify afterwards with the SELECT at the bottom, or /api/health (per-table
-- counts), then reload /admin — the numbers should reflect real sales only.
-- =============================================================================

BEGIN;

-- Demo gift-card ids (from the old seed).
CREATE TEMP TABLE demo_cards (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO demo_cards (id) VALUES
  ('30000000-0000-0000-0000-000000000001'),  -- JAS-7F3K-QP2M-9  active ₪300
  ('30000000-0000-0000-0000-000000000002'),  -- JAS-3M9T-XK4P-2  partial ₪500
  ('30000000-0000-0000-0000-000000000003'),  -- JAS-8P2W-RT6N-5  fully redeemed ₪100
  ('30000000-0000-0000-0000-000000000004'),  -- JAS-QW1E-AS2D-7  expired ₪200
  ('30000000-0000-0000-0000-000000000005');  -- JAS-ZX3C-VB4N-8  suspended ₪250

-- Demo staff profile ids (from the old seed).
CREATE TEMP TABLE demo_profiles (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO demo_profiles (id) VALUES
  ('00000000-0000-0000-0000-000000000001'),  -- owner@justasecond.example
  ('00000000-0000-0000-0000-000000000002'),  -- admin@justasecond.example
  ('00000000-0000-0000-0000-000000000003'),  -- manager@justasecond.example
  ('00000000-0000-0000-0000-000000000004'),  -- employee1@justasecond.example
  ('00000000-0000-0000-0000-000000000005'),  -- employee2@justasecond.example
  ('00000000-0000-0000-0000-000000000006');  -- finance@justasecond.example

-- Never touch a profile that a REAL Supabase Auth user was later linked to.
DELETE FROM demo_profiles dp
USING profiles p
WHERE p.id = dp.id AND p.auth_user_id IS NOT NULL;

-- 1) Audit rows about the demo cards (audit_logs.entity_id is not a FK, so
--    these are not removed by the cascade below).
DELETE FROM audit_logs
WHERE entity_type = 'gift_card'
  AND entity_id IN (SELECT id FROM demo_cards);

-- 2) Any remaining audit rows authored by a demo profile (FK: actor_id).
DELETE FROM audit_logs
WHERE actor_id IN (SELECT id FROM demo_profiles);

-- 3) Drop the payment_id pointer so the payments rows can go with the cards.
UPDATE gift_cards SET payment_id = NULL
WHERE id IN (SELECT id FROM demo_cards);

-- 4) Delete the demo cards. ON DELETE CASCADE takes payments, ledger entries,
--    redemptions, reversals, balance adjustments, delivery jobs (+ attempts)
--    and internal notes with them; payment_events / accounting_documents are
--    SET NULL by FK, so clear any that pointed at a demo card.
DELETE FROM payment_events        WHERE gift_card_id IN (SELECT id FROM demo_cards);
DELETE FROM accounting_documents  WHERE gift_card_id IN (SELECT id FROM demo_cards);
DELETE FROM gift_cards            WHERE id IN (SELECT id FROM demo_cards);

-- 5) Demo staff (user_roles cascade). Real staff — created via Supabase Auth —
--    have random ids and were filtered out above.
DELETE FROM profiles WHERE id IN (SELECT id FROM demo_profiles);

-- 6) Replace the placeholder contact details on the settings singleton. Keeps
--    whatever a human already set: only the old seeded placeholders are changed.
UPDATE system_settings
SET business_email = 'justasecondil2@gmail.com'
WHERE id = 1 AND business_email = 'hello@justasecond.example';

UPDATE system_settings
SET business_phone = '058-787-6549'
WHERE id = 1 AND business_phone IN ('03-5555555', '');

COMMIT;

-- -----------------------------------------------------------------------------
-- OPTIONAL — before going public, undo the ₪1 test mode and align the card
-- expiry with the landing-page copy ("תוקף השובר לארבעה חודשים").
-- Uncomment and run:
-- -----------------------------------------------------------------------------
-- UPDATE system_settings SET min_amount_minor = 5000 WHERE id = 1;  -- ₪50 minimum
-- UPDATE system_settings SET expiry_months   = 4    WHERE id = 1;

-- -----------------------------------------------------------------------------
-- Verify: what is left should be real purchases only (0 rows on a store that
-- has not sold a card yet).
-- -----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM gift_cards)                                   AS gift_cards,
  (SELECT count(*) FROM payments)                                     AS payments,
  (SELECT count(*) FROM gift_card_ledger_entries)                     AS ledger_entries,
  (SELECT count(*) FROM gift_card_redemptions)                        AS redemptions,
  (SELECT count(*) FROM delivery_jobs)                                AS delivery_jobs,
  (SELECT count(*) FROM profiles)                                     AS staff_profiles,
  (SELECT coalesce(sum(initial_amount_minor), 0) FROM gift_cards)     AS total_sales_minor,
  (SELECT coalesce(sum(balance_minor), 0) FROM gift_cards
    WHERE status IN ('active', 'partially_redeemed', 'suspended'))    AS outstanding_minor;
