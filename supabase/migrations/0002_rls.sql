-- =============================================================================
-- 0002_rls.sql — Row-Level Security. DENY BY DEFAULT.
-- -----------------------------------------------------------------------------
-- Threat model (see docs/just-website-repository-audit.md §6/§7): the reference
-- site shipped `anon read using(true)` on `orders`, so anyone could read every
-- order. We must NOT repeat that. For gift cards specifically:
--
--   * Gift-card CODES, PUBLIC TOKENS, and BALANCES must NEVER be readable by the
--     anon role through a table policy. There is deliberately NO anon SELECT
--     policy on gift_cards (or ledger / redemptions / payments).
--   * The recipient's public view is served ONLY through the SECURITY DEFINER
--     function get_public_gift_card(token) (defined in 0003_functions.sql),
--     which returns a PII-minimized projection and never leaks the db id.
--   * Authenticated STAFF read/write is scoped by role via user_roles, checked
--     by the helper auth_has_role(app_role[]).
--   * The SERVICE ROLE (server-side, service_role key) has the BYPASSRLS
--     attribute in Supabase, so ALL privileged server writes bypass these
--     policies. We never grant broad write policies to anon/authenticated.
--
-- Model: enable RLS on every table. Add NO permissive policy unless a specific
-- authenticated read is required. Absence of a policy == access denied.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: does the current authenticated user hold ANY of the given roles?
-- SECURITY DEFINER so it can read user_roles/profiles regardless of the caller's
-- own RLS. Maps auth.uid() -> profiles.auth_user_id -> user_roles.role.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_has_role(p_roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN profiles p ON p.id = ur.profile_id
    WHERE p.auth_user_id = auth.uid()
      AND p.is_active
      AND ur.role = ANY (p_roles)
  );
$$;

-- Convenience: current user is any kind of staff (has at least one role).
CREATE OR REPLACE FUNCTION auth_is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN profiles p ON p.id = ur.profile_id
    WHERE p.auth_user_id = auth.uid() AND p.is_active
  );
$$;

REVOKE ALL ON FUNCTION auth_has_role(app_role[]) FROM public;
REVOKE ALL ON FUNCTION auth_is_staff() FROM public;
GRANT EXECUTE ON FUNCTION auth_has_role(app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION auth_is_staff() TO authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS + FORCE it on every table. FORCE means even the table owner is
-- subject to policies; only BYPASSRLS roles (service_role) skip them.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'roles', 'user_roles', 'store_locations', 'gift_card_templates',
    'gift_cards', 'payments', 'payment_events', 'refunds',
    'gift_card_ledger_entries', 'gift_card_redemptions', 'redemption_reversals',
    'balance_adjustments', 'delivery_jobs', 'delivery_attempts',
    'accounting_documents', 'internal_notes', 'audit_logs', 'system_settings',
    'idempotency_keys'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- Drop any policy we might be re-creating (idempotent re-runs).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;',
                   r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- =============================================================================
-- READ policies for authenticated STAFF, scoped by role.
-- No policy is granted to `anon`. No broad write policy is granted to anyone —
-- all mutations go through the service role (server) or the SECURITY DEFINER
-- RPCs. Read-only staff visibility below supports the admin dashboard.
-- =============================================================================

-- Financial + card data: any staff member may READ (dashboard, redemption UI).
-- Sensitive columns (code/token/balance) are still never exposed to anon.
CREATE POLICY staff_read_gift_cards ON gift_cards
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_ledger ON gift_card_ledger_entries
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_redemptions ON gift_card_redemptions
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_reversals ON redemption_reversals
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_payments ON payments
  FOR SELECT TO authenticated
  USING (auth_has_role(ARRAY['owner','admin','finance','read_only']::app_role[]));

CREATE POLICY staff_read_payment_events ON payment_events
  FOR SELECT TO authenticated
  USING (auth_has_role(ARRAY['owner','admin','finance','read_only']::app_role[]));

CREATE POLICY staff_read_refunds ON refunds
  FOR SELECT TO authenticated
  USING (auth_has_role(ARRAY['owner','admin','finance','read_only']::app_role[]));

CREATE POLICY staff_read_adjustments ON balance_adjustments
  FOR SELECT TO authenticated
  USING (auth_has_role(ARRAY['owner','admin','finance','read_only']::app_role[]));

CREATE POLICY staff_read_accounting_docs ON accounting_documents
  FOR SELECT TO authenticated
  USING (auth_has_role(ARRAY['owner','admin','finance','read_only']::app_role[]));

CREATE POLICY staff_read_delivery_jobs ON delivery_jobs
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_delivery_attempts ON delivery_attempts
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_notes ON internal_notes
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_audit ON audit_logs
  FOR SELECT TO authenticated
  USING (auth_has_role(ARRAY['owner','admin','finance','read_only']::app_role[]));

-- Catalogue / reference data: any staff member may read.
CREATE POLICY staff_read_templates ON gift_card_templates
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_store_locations ON store_locations
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY staff_read_settings ON system_settings
  FOR SELECT TO authenticated
  USING (auth_is_staff());

-- Identity: a user may read their OWN profile; owner/admin may read all.
CREATE POLICY self_read_profile ON profiles
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid()
         OR auth_has_role(ARRAY['owner','admin']::app_role[]));

CREATE POLICY staff_read_roles ON roles
  FOR SELECT TO authenticated
  USING (auth_is_staff());

CREATE POLICY self_read_user_roles ON user_roles
  FOR SELECT TO authenticated
  USING (profile_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
         OR auth_has_role(ARRAY['owner','admin']::app_role[]));

-- =============================================================================
-- WRITE policies: intentionally NONE for anon/authenticated.
--
-- Every INSERT/UPDATE/DELETE on financial data is performed either by:
--   (a) the service role (server code holding SUPABASE_SERVICE_ROLE_KEY), which
--       bypasses RLS entirely, or
--   (b) a SECURITY DEFINER RPC (redeem_gift_card / activate_gift_card_from_payment),
--       which runs with the definer's privileges and enforces its own checks.
--
-- Redemptions in particular must go through redeem_gift_card() so the row lock,
-- idempotency, and atomic ledger+balance update are guaranteed. We therefore do
-- NOT grant staff a direct UPDATE on gift_cards.balance_minor — a direct
-- read-modify-write from app code is forbidden (docs/redemption-security.md).
-- =============================================================================

-- Anon gets NOTHING on any table. The recipient page calls get_public_gift_card()
-- (SECURITY DEFINER), the ONLY sanctioned anon-facing read path. That function
-- and its `GRANT EXECUTE ... TO anon` live in 0003_functions.sql (which runs
-- after this file, once the function exists).
