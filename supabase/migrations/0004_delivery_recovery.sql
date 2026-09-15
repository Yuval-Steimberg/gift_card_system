-- =============================================================================
-- 0004 — delivery recovery
--
-- WHY: a paid card could go undelivered FOREVER, silently.
--
-- `deliverDueJobs` claims a job (status -> 'processing') and only writes the
-- final status after the email provider call returns. If that request dies in
-- between — a Vercel function timeout while generating the PDF / calling
-- SendGrid, a deploy mid-flight, an unhandled crash — the row is left in
-- 'processing'. The old claim function re-claimed 'pending' / 'scheduled' /
-- 'failed' jobs ONLY, so such a row was never retried by the cron, never
-- retried by the next purchase's opportunistic sweep, and never counted by
-- /admin's failed-delivery badge. The buyer paid, the card is active, and
-- nobody is told the email never went out.
--
-- FIX: treat a job that has been 'processing' for longer than a worker could
-- plausibly still be running (15 min; a Vercel function caps out far below
-- that) as crashed, and re-claim it. `attempts` keeps incrementing, so the
-- existing attempts < 5 ceiling still stops an infinite loop.
--
-- Re-running this file is safe (CREATE OR REPLACE / idempotent ALTERs).
-- =============================================================================

-- Stale-claim recovery needs to know WHEN the job was claimed. updated_at is
-- already set on every claim, and an index keeps the scan cheap.
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_stuck
  ON delivery_jobs(updated_at) WHERE status = 'processing';

-- delivery_attempts.attempt_number is NOT NULL with no default, and the app
-- inserted attempt rows without it — so EVERY attempt insert failed (silently:
-- the error was never checked) and the per-attempt history was always empty,
-- which is exactly the history you need to debug "the card never arrived".
-- The app now sends the real attempt number; the default keeps older/other
-- writers from failing the insert outright.
ALTER TABLE delivery_attempts ALTER COLUMN attempt_number SET DEFAULT 0;

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
         -- Crashed worker: claimed but never finished. Retry it.
         OR (d.status = 'processing' AND d.attempts < 5
             AND d.updated_at < p_now - interval '15 minutes')
      ORDER BY d.scheduled_for NULLS FIRST, d.created_at
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
   )
  RETURNING dj.*;
END;
$$;

REVOKE ALL ON FUNCTION claim_due_delivery_jobs(timestamptz, integer) FROM public;
GRANT EXECUTE ON FUNCTION claim_due_delivery_jobs(timestamptz, integer) TO authenticated;
