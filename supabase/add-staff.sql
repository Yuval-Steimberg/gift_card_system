-- =============================================================================
-- add-staff.sql — give a person access to /admin and /employee
-- -----------------------------------------------------------------------------
-- The app has no staff-management screen yet, so a new team member is added in
-- two steps:
--
--   STEP 1 (Supabase dashboard) — create the login:
--     Authentication → Users → Add user
--       Email:    the person's email
--       Password: pick one (they can change it later via "Forgot password")
--       ✅ Auto Confirm User   ← without this they cannot sign in
--
--   STEP 2 (this file) — SQL Editor → paste → Run. It links that login to a
--   staff profile and grants the role. If step 1 was skipped the script stops
--   with a clear message and changes nothing.
--
-- Fill in the three values at the top of the block. Re-running is safe: the same
-- person is updated, not duplicated.
--
-- ROLES (`staff_role`), from least to most access:
--   store_employee  עובד חנות   — redeem cards, look cards up. Nothing else.
--   store_manager   מנהל חנות   — the above + reverse a redemption, add notes,
--                                 manage employees, read the audit log.
--   finance         כספים       — read cards, financial reports, CSV export.
--   admin           מנהל מערכת  — everything: settings, refunds, reissue,
--                                 suspend/cancel, balance adjustments, exports.
--   owner           בעלים       — same as admin.
--   read_only       צפייה בלבד  — look, don't touch.
--
-- Everything lives in ONE `DO` block on purpose: the Supabase SQL Editor commits
-- each statement on its own, so a multi-statement script is not atomic. A DO
-- block is a single statement — it either fully applies or fully rolls back.
--
-- TO REMOVE SOMEONE: delete their user under Authentication → Users, or run
--   UPDATE profiles SET is_active = false WHERE email = 'them@example.com';
-- =============================================================================

DO $$
DECLARE
  ---------------------------------------------------------------- fill these in
  staff_email   text     := 'liattrik@gmail.com';
  staff_name    text     := 'ליאת';
  staff_role    app_role := 'store_manager';
  -- true  = this becomes their ONLY role (any other role is removed)
  -- false = the role is added alongside whatever they already have
  replace_roles boolean  := true;
  -----------------------------------------------------------------------------
  v_auth_id uuid;
  v_prof_id uuid;
BEGIN
  staff_email := lower(trim(staff_email));

  -- The Supabase Auth user must exist first (STEP 1 above).
  SELECT id INTO v_auth_id FROM auth.users WHERE lower(email) = staff_email;
  IF v_auth_id IS NULL THEN
    RAISE EXCEPTION
      'No Supabase Auth user found for %. Create it under Authentication → Users → Add user (tick Auto Confirm User), then run this again. Nothing was changed.',
      staff_email;
  END IF;

  -- Reuse an existing profile whether it was found by login or by email
  -- (profiles.auth_user_id and profiles.email are both unique).
  SELECT id INTO v_prof_id FROM profiles WHERE auth_user_id = v_auth_id;
  IF v_prof_id IS NULL THEN
    SELECT id INTO v_prof_id FROM profiles WHERE lower(email) = staff_email;
  END IF;

  IF v_prof_id IS NULL THEN
    INSERT INTO profiles (auth_user_id, email, full_name, is_active)
    VALUES (v_auth_id, staff_email, staff_name, true)
    RETURNING id INTO v_prof_id;
    RAISE NOTICE 'Created staff profile for % (%).', staff_name, staff_email;
  ELSE
    UPDATE profiles
    SET auth_user_id = v_auth_id, email = staff_email, full_name = staff_name, is_active = true
    WHERE id = v_prof_id;
    RAISE NOTICE 'Updated existing staff profile for % (%).', staff_name, staff_email;
  END IF;

  IF replace_roles THEN
    DELETE FROM user_roles WHERE profile_id = v_prof_id AND role <> staff_role;
  END IF;

  INSERT INTO user_roles (profile_id, role)
  VALUES (v_prof_id, staff_role)
  ON CONFLICT (profile_id, role) DO NOTHING;

  RAISE NOTICE 'Granted role % — they can sign in at /employee/login.', staff_role;
END $$;

-- -----------------------------------------------------------------------------
-- Verify: the whole staff list with roles. The person you just added should be
-- here, active, with the expected role.
-- -----------------------------------------------------------------------------
SELECT p.full_name,
       p.email,
       string_agg(ur.role::text, ', ' ORDER BY ur.role::text) AS roles,
       p.is_active,
       (p.auth_user_id IS NOT NULL)                           AS can_sign_in
FROM profiles p
LEFT JOIN user_roles ur ON ur.profile_id = p.id
GROUP BY p.id, p.full_name, p.email, p.is_active, p.auth_user_id
ORDER BY p.full_name;
