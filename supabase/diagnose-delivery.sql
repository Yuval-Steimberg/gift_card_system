-- =============================================================================
-- diagnose-delivery.sql — "they paid and never got the card": which step broke?
--
-- HOW TO USE: put the addresses in the emails array below (buyer OR recipient —
-- both are matched) and run PART 1 in the Supabase SQL Editor. It is READ-ONLY.
-- One row per gift card, with a verdict column that names the exact failure and
-- the fix. PART 2 at the bottom lists payments that matched NO card at all —
-- run it too (the editor only shows the LAST statement's result, so highlight
-- one part at a time).
--
-- NO ROWS AT ALL for an address  =>  the purchase never reached us: the card was
-- never created. The money (if any) was taken at Grow with no order behind it —
-- check the Grow dashboard for that payer and issue the card manually.
--
-- The verdicts, and what each one means:
--   NOT PAID ........... no payment ever confirmed. The buyer abandoned checkout
--                        (or paid at Grow and the callback never arrived — check
--                        Grow → transactions for the payer; if the money IS
--                        there, activate with /admin → "סימון כשולם והפעלה").
--   PAID, NOT ACTIVATED  Grow's callback DID land but did not activate the card
--                        (amount mismatch, or it matched a different card). See
--                        webhook_outcomes; fix with "סימון כשולם והפעלה".
--   NO DELIVERY JOB .... card is active but nothing was ever queued. Use the
--                        admin resend action.
--   SCHEDULED .......... not due yet — nothing is wrong; it goes out at its time.
--   STUCK ............ the worker died mid-send (Vercel timeout / deploy). Since
--                        migration 0004 the cron re-claims these automatically;
--                        POST /api/cron/deliver to flush it now.
--   FAILED ............. the provider rejected the send. Read delivery_error.
--   SENT ............... WE handed it to SendGrid successfully. If the recipient
--                        still has nothing, the loss is AFTER us: check SendGrid
--                        → Activity for this address (bounce / blocked / drop),
--                        and have the recipient's IT check quarantine. Corporate
--                        Microsoft 365 / Google Workspace tenants routinely
--                        quarantine a first-time sender with a PDF attachment,
--                        and SendGrid's 202 only means "accepted", never
--                        "delivered to the human".
-- =============================================================================

WITH params AS (
  SELECT ARRAY[
    'zahiasa@1to1landscape.com',
    'jorden@1to1landscape.com',
    'yoav@1to1landscape.com'
  ]::text[] AS emails
),
matched AS (
  SELECT gc.*
  FROM gift_cards gc, params p
  WHERE lower(gc.recipient_email) = ANY (SELECT lower(e) FROM unnest(p.emails) e)
     OR lower(gc.buyer_email)     = ANY (SELECT lower(e) FROM unnest(p.emails) e)
),
last_job AS (
  SELECT DISTINCT ON (dj.gift_card_id)
         dj.gift_card_id, dj.status, dj.attempts, dj.last_error,
         dj.provider_message_id, dj.scheduled_for, dj.updated_at
  FROM delivery_jobs dj
  JOIN matched m ON m.id = dj.gift_card_id
  ORDER BY dj.gift_card_id, dj.created_at DESC
)
SELECT
  m.code,
  m.recipient_email,
  m.buyer_email,
  round(m.initial_amount_minor::numeric / 100, 2) AS amount_ils,
  m.status                                  AS card_status,
  m.created_at,
  m.issued_at,
  (SELECT pay.status FROM payments pay WHERE pay.gift_card_id = m.id
    ORDER BY pay.created_at DESC LIMIT 1)   AS payment_status,
  (SELECT count(*) FROM payment_events pe WHERE pe.gift_card_id = m.id)
                                            AS provider_callbacks,
  j.status                                  AS delivery_status,
  j.attempts                                AS delivery_attempts,
  j.last_error                              AS delivery_error,
  j.provider_message_id                     AS sendgrid_message_id,
  j.scheduled_for,
  -- Every activation outcome the webhook recorded for this card (an unmatched
  -- or rejected callback shows up here and nowhere else).
  (SELECT string_agg(a.action || ' @ ' || to_char(a.created_at, 'DD/MM HH24:MI'), ' | '
                     ORDER BY a.created_at)
     FROM audit_logs a
    WHERE a.entity_id = m.id::text
      AND a.action LIKE 'payment.%')        AS webhook_outcomes,
  CASE
    WHEN m.status IN ('draft', 'awaiting_payment', 'payment_processing', 'failed')
         AND NOT EXISTS (SELECT 1 FROM payment_events pe WHERE pe.gift_card_id = m.id)
      THEN 'NOT PAID — no provider callback ever arrived for this card'
    WHEN m.status IN ('draft', 'awaiting_payment', 'payment_processing', 'failed')
      THEN 'PAID, NOT ACTIVATED — a callback arrived but did not activate; see webhook_outcomes'
    WHEN j.gift_card_id IS NULL
      THEN 'NO DELIVERY JOB — card is active but nothing was queued; use the admin resend'
    WHEN j.status = 'scheduled' AND j.scheduled_for > now()
      THEN 'SCHEDULED — not due yet, goes out at scheduled_for'
    WHEN j.status IN ('pending', 'scheduled')
      THEN 'DUE, NOT SENT — run POST /api/cron/deliver'
    WHEN j.status = 'processing' AND j.updated_at < now() - interval '15 minutes'
      THEN 'STUCK — worker died mid-send; run POST /api/cron/deliver to retry'
    WHEN j.status = 'processing'
      THEN 'IN FLIGHT — being sent right now'
    WHEN j.status = 'failed'
      THEN 'FAILED — the email provider rejected it; read delivery_error'
    ELSE 'SENT — SendGrid accepted it. The loss is after us: check SendGrid Activity '
         || 'for this address and the recipient''s spam/quarantine'
  END                                       AS verdict
FROM matched m
LEFT JOIN last_job j ON j.gift_card_id = m.id
ORDER BY m.created_at DESC;

-- =============================================================================
-- PART 2 — payments that matched NO gift card (highlight and run separately).
--
-- A callback that cannot be tied to an order is the worst case: the customer
-- was charged and no card exists to deliver. Each row is real money to place by
-- hand — find the order (by payer address + amount + time) and use /admin →
-- "סימון כשולם והפעלה" on it, or issue a card manually.
--
-- Empty result = every callback we received was matched to a card. Good.
-- =============================================================================
SELECT
  pe.created_at,
  pe.provider,
  pe.event_id,
  round(pe.amount_minor::numeric / 100, 2) AS amount_ils,
  pe.raw ->> 'payerEmail'                  AS payer_email,
  pe.raw ->> 'transactionCode'             AS grow_transaction,
  a.reason                                 AS why
FROM payment_events pe
LEFT JOIN audit_logs a
  ON a.entity_type = 'payment_event' AND a.entity_id = pe.event_id
WHERE pe.gift_card_id IS NULL
ORDER BY pe.created_at DESC
LIMIT 100;
