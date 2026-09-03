-- =============================================================================
-- seed.sql — baseline REFERENCE DATA (mirrors lib/data/seed-data.ts)
-- -----------------------------------------------------------------------------
-- Configuration only: the store location, the card designs and the singleton
-- system_settings row. Money is integer minor units (agorot): ₪100 -> 10000.
--
-- ⚠️ NO SAMPLE GIFT CARDS, PAYMENTS, LEDGER ENTRIES, REDEMPTIONS OR STAFF ARE
-- SEEDED. Every figure in /admin (sales, outstanding balance, redemption rate)
-- is computed from the gift_cards / ledger tables, so seeding demo rows makes
-- the dashboard report money that was never taken. A fresh database therefore
-- starts at a true zero and only ever shows real purchases.
-- Staff are created per-environment via Supabase Auth (see CLAUDE.md → "Adding
-- staff"); demo logins exist only in the offline dev auth layer.
--
-- Safe to run repeatedly (ON CONFLICT DO NOTHING everywhere).
-- Apply AFTER 0001/0002/0003. Run as the service role / owner (RLS is FORCEd;
-- seeding via psql as the db owner with service_role, or with RLS bypass).
--
-- Already ran an older seed that DID insert demo cards? Purge it with
-- supabase/cleanup-demo-data.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Store location (Tel Aviv) — the physical store cards are redeemed at.
-- -----------------------------------------------------------------------------
INSERT INTO store_locations (id, name, address, timezone, is_active) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Just A Second · תל אביב',
   'מנחם בגין 34, תל אביב', 'Asia/Jerusalem', true)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Card designs offered in the purchase funnel
-- -----------------------------------------------------------------------------
INSERT INTO gift_card_templates
  (id, name, occasion, language, background_color, text_color, accent_color, is_active, is_default) VALUES
  ('20000000-0000-0000-0000-000000000001', 'חגיגה',   'celebration', 'he', '#333D36', '#FFFCF5', '#E88225', true, true),
  ('20000000-0000-0000-0000-000000000002', 'יום הולדת','birthday',    'he', '#B5C9AD', '#333D36', '#C96A17', true, false),
  ('20000000-0000-0000-0000-000000000003', 'חג שמח',   'holiday',     'he', '#8FA688', '#FFFCF5', '#F4A866', true, false),
  ('20000000-0000-0000-0000-000000000005', 'תודה',     'general',     'he', '#F6F1E4', '#333D36', '#E88225', true, false),
  ('20000000-0000-0000-0000-000000000006', 'מכל הלב',  'celebration', 'he', '#4A524D', '#FFFCF5', '#F4A866', true, false),
  ('20000000-0000-0000-0000-000000000004', 'With Love','general',     'en', '#FFFCF5', '#333D36', '#E88225', true, false)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- System settings (singleton, id=1). Real business values — real contact
-- details, presets [₪100,₪250,₪500,₪1000], min ₪50, max ₪5000, expiry 12 months
-- (matching the landing-page copy), partial redemption allowed. Every contact
-- detail the customer sees is read from this row; change it in /admin → הגדרות.
-- -----------------------------------------------------------------------------
INSERT INTO system_settings (
  id, business_name, business_email, business_phone, store_address, currency, timezone,
  preset_amounts_minor, min_amount_minor, max_amount_minor, allow_custom_amount,
  expiry_months, allow_partial_redemption, greeting_max_length, terms_url, default_language
) VALUES (
  1, 'Just A Second · ג׳אסט א סקונד', 'justasecondil2@gmail.com', '058-787-6549',
  'מנחם בגין 34, תל אביב', 'ILS', 'Asia/Jerusalem',
  ARRAY[10000, 25000, 50000, 100000]::bigint[], 5000, 500000, true,
  12, true, 500, '/terms', 'he'
) ON CONFLICT (id) DO NOTHING;
