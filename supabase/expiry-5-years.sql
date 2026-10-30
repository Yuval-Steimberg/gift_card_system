-- =============================================================================
-- expiry-5-years.sql — gift cards valid for 5 years (60 months)
-- -----------------------------------------------------------------------------
-- Israeli consumer law requires gift vouchers to be valid for at least five
-- years. The settings row decides the validity of every NEW card; cards already
-- issued keep the expiry they got at issue, so this also extends those.
--
-- 1. system_settings.expiry_months = 60 (what /admin → הגדרות shows).
-- 2. Active and partially redeemed cards whose expiry is earlier than 5 years
--    after issue get expires_at = issued_at + 5 years. Only ever extends: a card
--    already valid for longer, with no expiry, or not yet issued is untouched.
--    Each change is written to audit_logs (action 'giftcard.expiry_extended').
--
-- HOW: Supabase → SQL Editor → paste the WHOLE file → Run (service role / owner;
-- RLS is FORCEd). One DO block, so it fully applies or fully rolls back.
-- Idempotent: a second run changes nothing.
-- =============================================================================

DO $$
DECLARE
  extended integer;
BEGIN
  UPDATE system_settings SET expiry_months = 60 WHERE id = 1;

  WITH changed AS (
    UPDATE gift_cards gc
       SET expires_at = gc.issued_at + interval '5 years',
           updated_at = now()
     WHERE gc.status IN ('active', 'partially_redeemed')
       AND gc.issued_at IS NOT NULL
       AND gc.expires_at IS NOT NULL
       AND gc.expires_at < gc.issued_at + interval '5 years'
    RETURNING gc.id, gc.expires_at
  ), before AS (
    -- CTEs read the table as it was before the UPDATE: each card's previous expiry.
    SELECT id, expires_at FROM gift_cards
  )
  INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, reason, metadata)
  SELECT NULL, 'system', 'giftcard.expiry_extended', 'gift_card', c.id::text,
         'validity extended to 5 years from issue (Israeli consumer law)',
         jsonb_build_object('from', b.expires_at, 'to', c.expires_at)
    FROM changed c JOIN before b ON b.id = c.id;

  GET DIAGNOSTICS extended = ROW_COUNT;
  RAISE NOTICE 'expiry_months = 60; % issued card(s) extended to 5 years', extended;
END $$;

-- Check: the setting, and the cards still expiring within 5 years of issue (should be none).
SELECT expiry_months FROM system_settings WHERE id = 1;
SELECT count(*) AS cards_under_5_years
  FROM gift_cards
 WHERE status IN ('active', 'partially_redeemed')
   AND issued_at IS NOT NULL AND expires_at IS NOT NULL
   AND expires_at < issued_at + interval '5 years';
