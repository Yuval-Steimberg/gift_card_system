-- =============================================================================
-- 0006 — email provider delivery events
--
-- The SendGrid Event Webhook (/api/webhooks/email) reports what happened to a
-- message AFTER the send API returned 202 — delivered, bounced, blocked,
-- spam-dropped. Those events carry our delivery_job id in custom_args, but
-- messages sent before that existed can only be matched on the provider's
-- message id, so that column needs an index.
--
-- A rejection is recorded as status 'cancelled', NOT 'failed': claim_due_
-- delivery_jobs retries 'failed', and re-sending to an address that hard-bounced
-- only burns sender reputation. 'cancelled' means "a human has to fix this".
--
-- Re-running this file is safe.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_delivery_jobs_provider_message_id
  ON delivery_jobs(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Cards needing attention are read by status; the reconciliation sweep and the
-- /admin badge both filter on the non-terminal ones.
CREATE INDEX IF NOT EXISTS idx_payment_events_unmatched
  ON payment_events(created_at)
  WHERE gift_card_id IS NULL;
