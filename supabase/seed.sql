-- =============================================================================
-- seed.sql — demo data mirroring lib/data/seed-data.ts
-- -----------------------------------------------------------------------------
-- Deterministic UUIDs so re-running is stable and cross-referenceable. No real
-- personal data. Money is integer minor units (agorot): ₪100 -> 10000.
-- Safe to run repeatedly (ON CONFLICT DO NOTHING everywhere).
--
-- Apply AFTER 0001/0002/0003. Run as the service role / owner (RLS is FORCEd;
-- seeding via psql as the db owner with service_role, or with RLS bypass).
-- =============================================================================

-- Amounts (agorot):
--   ₪300 = 30000   ₪500 = 50000   ₪100 = 10000   ₪200 = 20000
--   ₪250 = 25000   ₪180 = 18000   (₪500 - ₪180 = ₪320 = 32000)

-- -----------------------------------------------------------------------------
-- Staff profiles (owner / admin / manager / 2 employees / finance)
-- -----------------------------------------------------------------------------
INSERT INTO profiles (id, email, full_name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner@justasecond.example',     'נועה ברנט'),
  ('00000000-0000-0000-0000-000000000002', 'admin@justasecond.example',     'מנהל/ת מערכת'),
  ('00000000-0000-0000-0000-000000000003', 'manager@justasecond.example',   'מנהל/ת חנות'),
  ('00000000-0000-0000-0000-000000000004', 'employee1@justasecond.example', 'עובד/ת א'),
  ('00000000-0000-0000-0000-000000000005', 'employee2@justasecond.example', 'עובד/ת ב'),
  ('00000000-0000-0000-0000-000000000006', 'finance@justasecond.example',   'הנהלת חשבונות')
ON CONFLICT (id) DO NOTHING;

-- Role grants (roles catalogue is inserted by 0001_init.sql).
INSERT INTO user_roles (profile_id, role) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner'),
  ('00000000-0000-0000-0000-000000000002', 'admin'),
  ('00000000-0000-0000-0000-000000000003', 'store_manager'),
  ('00000000-0000-0000-0000-000000000004', 'store_employee'),
  ('00000000-0000-0000-0000-000000000005', 'store_employee'),
  ('00000000-0000-0000-0000-000000000006', 'finance')
ON CONFLICT (profile_id, role) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Store location (Tel Aviv)
-- -----------------------------------------------------------------------------
INSERT INTO store_locations (id, name, address, timezone, is_active) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Just A Second · תל אביב',
   'מנחם בגין 34, תל אביב', 'Asia/Jerusalem', true)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Templates (4)
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
-- Gift cards (active / partially_redeemed / fully_redeemed / expired / suspended)
-- Each has a matching payment + initial_credit ledger entry; the two spent cards
-- also have a redemption row + redemption_debit ledger entry.
-- -----------------------------------------------------------------------------

-- 1) Active, full ₪300 balance
INSERT INTO gift_cards (
  id, code, public_token, status, currency, initial_amount_minor, balance_minor,
  template_id, buyer_name, buyer_email, buyer_phone, is_anonymous,
  recipient_name, recipient_email, recipient_phone, recipient_language, delivery_channel,
  greeting, sender_timezone, issued_at, expires_at, created_at
) VALUES (
  '30000000-0000-0000-0000-000000000001', 'JAS-7F3K-QP2M-9',
  'demo-token-active-2f8a9c1e5b7d3a4f6e0c', 'active', 'ILS', 30000, 30000,
  '20000000-0000-0000-0000-000000000001', 'דנה כהן', 'dana.buyer@example.com', '0501234567', false,
  'יעל לוי', 'yael.recipient@example.com', '0527654321', 'he', 'email',
  E'מזל טוב יעל!\nמגיע לך משהו יפה מהחנות.\nבאהבה, דנה', 'Asia/Jerusalem',
  now() - interval '10 days', now() + interval '355 days', now() - interval '10 days'
) ON CONFLICT (id) DO NOTHING;

-- 2) Partially redeemed: ₪500 -> ₪180 redeemed -> ₪320 remaining
INSERT INTO gift_cards (
  id, code, public_token, status, currency, initial_amount_minor, balance_minor,
  template_id, buyer_name, buyer_email, buyer_phone, is_anonymous,
  recipient_name, recipient_email, recipient_phone, recipient_language, delivery_channel,
  greeting, sender_timezone, issued_at, expires_at, created_at
) VALUES (
  '30000000-0000-0000-0000-000000000002', 'JAS-3M9T-XK4P-2',
  'demo-token-partial-6b1d8e2f4a9c3e7b5d0f', 'partially_redeemed', 'ILS', 50000, 32000,
  '20000000-0000-0000-0000-000000000002', 'דנה כהן', 'dana.buyer@example.com', '0501234567', false,
  'נועם ברק', 'yael.recipient@example.com', '0527654321', 'he', 'email',
  E'מזל טוב!\nמגיע לך משהו יפה מהחנות.\nבאהבה, דנה', 'Asia/Jerusalem',
  now() - interval '10 days', now() + interval '355 days', now() - interval '10 days'
) ON CONFLICT (id) DO NOTHING;

-- 3) Fully redeemed: ₪100 -> ₪100 redeemed -> ₪0
INSERT INTO gift_cards (
  id, code, public_token, status, currency, initial_amount_minor, balance_minor,
  template_id, buyer_name, buyer_email, is_anonymous,
  recipient_name, recipient_email, recipient_language, delivery_channel,
  greeting, sender_timezone, issued_at, expires_at, created_at
) VALUES (
  '30000000-0000-0000-0000-000000000003', 'JAS-8P2W-RT6N-5',
  'demo-token-full-1a2b3c4d5e6f7a8b9c0d', 'fully_redeemed', 'ILS', 10000, 0,
  '20000000-0000-0000-0000-000000000003', 'דנה כהן', 'dana.buyer@example.com', false,
  'יעל לוי', 'yael.recipient@example.com', 'he', 'email',
  E'מזל טוב יעל!\nבאהבה, דנה', 'Asia/Jerusalem',
  now() - interval '30 days', now() + interval '335 days', now() - interval '30 days'
) ON CONFLICT (id) DO NOTHING;

-- 4) Expired (unused ₪200, past expiry)
INSERT INTO gift_cards (
  id, code, public_token, status, currency, initial_amount_minor, balance_minor,
  template_id, buyer_name, buyer_email, is_anonymous,
  recipient_name, recipient_email, recipient_language, delivery_channel,
  greeting, sender_timezone, issued_at, expires_at, created_at
) VALUES (
  '30000000-0000-0000-0000-000000000004', 'JAS-QW1E-AS2D-7',
  'demo-token-expired-9f8e7d6c5b4a3f2e1d0c', 'expired', 'ILS', 20000, 20000,
  '20000000-0000-0000-0000-000000000001', 'דנה כהן', 'dana.buyer@example.com', false,
  'יעל לוי', 'yael.recipient@example.com', 'he', 'email',
  E'מזל טוב יעל!\nבאהבה, דנה', 'Asia/Jerusalem',
  now() - interval '400 days', now() - interval '5 days', now() - interval '400 days'
) ON CONFLICT (id) DO NOTHING;

-- 5) Suspended (₪250 balance frozen)
INSERT INTO gift_cards (
  id, code, public_token, status, currency, initial_amount_minor, balance_minor,
  template_id, buyer_name, buyer_email, is_anonymous,
  recipient_name, recipient_email, recipient_language, delivery_channel,
  greeting, sender_timezone, issued_at, expires_at, created_at
) VALUES (
  '30000000-0000-0000-0000-000000000005', 'JAS-ZX3C-VB4N-8',
  'demo-token-suspended-3c2b1a0f9e8d7c6b5a4f', 'suspended', 'ILS', 25000, 25000,
  '20000000-0000-0000-0000-000000000001', 'דנה כהן', 'dana.buyer@example.com', false,
  'יעל לוי', 'yael.recipient@example.com', 'he', 'email',
  E'מזל טוב יעל!\nבאהבה, דנה', 'Asia/Jerusalem',
  now() - interval '20 days', now() + interval '345 days', now() - interval '20 days'
) ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Payments (one per card, all 'paid') + link back to the card
-- -----------------------------------------------------------------------------
INSERT INTO payments (id, gift_card_id, provider, provider_payment_id, provider_checkout_id, amount_minor, currency, status) VALUES
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'mock', 'mock_pay_JAS-7F3K-QP2M-9', 'mock_cs_JAS-7F3K-QP2M-9', 30000, 'ILS', 'paid'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'mock', 'mock_pay_JAS-3M9T-XK4P-2', 'mock_cs_JAS-3M9T-XK4P-2', 50000, 'ILS', 'paid'),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'mock', 'mock_pay_JAS-8P2W-RT6N-5', 'mock_cs_JAS-8P2W-RT6N-5', 10000, 'ILS', 'paid'),
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', 'mock', 'mock_pay_JAS-QW1E-AS2D-7', 'mock_cs_JAS-QW1E-AS2D-7', 20000, 'ILS', 'paid'),
  ('40000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000005', 'mock', 'mock_pay_JAS-ZX3C-VB4N-8', 'mock_cs_JAS-ZX3C-VB4N-8', 25000, 'ILS', 'paid')
ON CONFLICT (id) DO NOTHING;

UPDATE gift_cards gc SET payment_id = p.id
FROM payments p
WHERE p.gift_card_id = gc.id AND gc.payment_id IS NULL;

-- -----------------------------------------------------------------------------
-- Ledger: initial_credit for every card
-- -----------------------------------------------------------------------------
INSERT INTO gift_card_ledger_entries
  (id, gift_card_id, type, amount_minor, currency, balance_after_minor, reference_type, reference_id, reason) VALUES
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'initial_credit', 30000, 'ILS', 30000, 'payment', '40000000-0000-0000-0000-000000000001', 'initial gift card credit'),
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'initial_credit', 50000, 'ILS', 50000, 'payment', '40000000-0000-0000-0000-000000000002', 'initial gift card credit'),
  ('50000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'initial_credit', 10000, 'ILS', 10000, 'payment', '40000000-0000-0000-0000-000000000003', 'initial gift card credit'),
  ('50000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', 'initial_credit', 20000, 'ILS', 20000, 'payment', '40000000-0000-0000-0000-000000000004', 'initial gift card credit'),
  ('50000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000005', 'initial_credit', 25000, 'ILS', 25000, 'payment', '40000000-0000-0000-0000-000000000005', 'initial gift card credit')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Redemptions + matching redemption_debit ledger entries (partial + full cards)
-- -----------------------------------------------------------------------------
INSERT INTO gift_card_redemptions
  (id, gift_card_id, amount_minor, balance_before_minor, balance_after_minor, employee_id, store_location_id, idempotency_key, sale_reference, created_at) VALUES
  ('60000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 18000, 50000, 32000,
   '00000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'seed-JAS-3M9T-XK4P-2-0', 'SALE-1000', now() - interval '3 days'),
  ('60000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', 10000, 10000, 0,
   '00000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'seed-JAS-8P2W-RT6N-5-1', 'SALE-1001', now() - interval '3 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO gift_card_ledger_entries
  (id, gift_card_id, type, amount_minor, currency, balance_after_minor, reference_type, reference_id, reason, created_by, created_at) VALUES
  ('50000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000002', 'redemption_debit', -18000, 'ILS', 32000, 'redemption', '60000000-0000-0000-0000-000000000001', 'in-store redemption', '00000000-0000-0000-0000-000000000004', now() - interval '3 days'),
  ('50000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000003', 'redemption_debit', -10000, 'ILS', 0,     'redemption', '60000000-0000-0000-0000-000000000002', 'in-store redemption', '00000000-0000-0000-0000-000000000005', now() - interval '3 days')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Delivery jobs (one per card; the active/partial/full delivered)
-- -----------------------------------------------------------------------------
INSERT INTO delivery_jobs (id, gift_card_id, channel, status, attempts, provider_message_id) VALUES
  ('70000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'email', 'delivered', 1, 'log_JAS-7F3K-QP2M-9'),
  ('70000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'email', 'delivered', 1, 'log_JAS-3M9T-XK4P-2'),
  ('70000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'email', 'delivered', 1, 'log_JAS-8P2W-RT6N-5'),
  ('70000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', 'email', 'delivered', 1, 'log_JAS-QW1E-AS2D-7'),
  ('70000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000005', 'email', 'delivered', 1, 'log_JAS-ZX3C-VB4N-8')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Audit trail for the activations + redemptions
-- -----------------------------------------------------------------------------
INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, reason) VALUES
  (NULL, 'system', 'giftcard.activated', 'gift_card', '30000000-0000-0000-0000-000000000001', 'verified payment'),
  (NULL, 'system', 'giftcard.activated', 'gift_card', '30000000-0000-0000-0000-000000000002', 'verified payment'),
  (NULL, 'system', 'giftcard.activated', 'gift_card', '30000000-0000-0000-0000-000000000003', 'verified payment'),
  (NULL, 'system', 'giftcard.activated', 'gift_card', '30000000-0000-0000-0000-000000000004', 'verified payment'),
  (NULL, 'system', 'giftcard.activated', 'gift_card', '30000000-0000-0000-0000-000000000005', 'verified payment'),
  ('00000000-0000-0000-0000-000000000004', 'store_employee', 'giftcard.redeemed', 'gift_card', '30000000-0000-0000-0000-000000000002', 'in-store redemption'),
  ('00000000-0000-0000-0000-000000000005', 'store_employee', 'giftcard.redeemed', 'gift_card', '30000000-0000-0000-0000-000000000003', 'in-store redemption')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- System settings (singleton, id=1). Presets [₪100,₪250,₪500,₪1000], min ₪50,
-- max ₪5000, expiry 12 months, partial redemption allowed.
-- -----------------------------------------------------------------------------
INSERT INTO system_settings (
  id, business_name, business_email, business_phone, store_address, currency, timezone,
  preset_amounts_minor, min_amount_minor, max_amount_minor, allow_custom_amount,
  expiry_months, allow_partial_redemption, greeting_max_length, terms_url, default_language
) VALUES (
  1, 'Just A Second · ג׳אסט א סקונד', 'hello@justasecond.example', '03-5555555',
  'מנחם בגין 34, תל אביב', 'ILS', 'Asia/Jerusalem',
  ARRAY[10000, 25000, 50000, 100000]::bigint[], 5000, 500000, true,
  12, true, 500, '/terms', 'he'
) ON CONFLICT (id) DO NOTHING;
