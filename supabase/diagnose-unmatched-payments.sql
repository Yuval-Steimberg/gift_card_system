-- =============================================================================
-- "The daily sweep says N payments have no gift card" — are they even ours?
-- READ-ONLY. Paste into the Supabase SQL Editor.
--
-- Grow's webhook is account-wide (CLAUDE.md gotcha #8c / #22): it reports EVERY
-- charge — the shop's card terminal, the JAS website — not only gift cards.
-- Gift-card payment links carry "שובר מתנה" in their description (paymentDesc).
--
-- kind = 'shop sale (ignored)'   → not a gift card; the app now skips these.
-- kind = 'GIFT CARD — no match'  → a real gift-card payment with no card. Act on
--                                   it: find the buyer, "סימון כשולם והפעלה".
-- kind = 'unknown — check Grow'  → no description; look it up in Grow.
-- =============================================================================
SELECT
  CASE
    WHEN coalesce(raw->>'cField1', raw->>'order_ref', '') <> '' THEN 'GIFT CARD — no match'
    WHEN coalesce(nullif(trim(raw->>'paymentDesc'), ''), nullif(trim(raw->>'description'), '')) IS NULL
      THEN 'unknown — check Grow'
    WHEN coalesce(raw->>'paymentDesc', raw->>'description') ~* '(שובר\s*מתנה|gift\s*card)'
      THEN 'GIFT CARD — no match'
    ELSE 'shop sale (ignored)'
  END                                    AS kind,
  created_at,
  amount_minor / 100.0                   AS amount_ils,
  raw->>'payerEmail'                     AS payer_email,
  raw->>'paymentDesc'                    AS payment_desc,
  raw->>'paymentSource'                  AS payment_source,
  event_id
FROM payment_events
WHERE gift_card_id IS NULL
  AND created_at >= now() - interval '30 days'
ORDER BY kind, created_at DESC;
