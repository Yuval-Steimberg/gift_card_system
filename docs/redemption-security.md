# Redemption security

How the gift-card system prevents double-spend, overspend, forged activation, and
data leakage. This is a **financial** system: the guarantees below live in the
database (`supabase/migrations/0003_functions.sql` + `0002_rls.sql`), not in
best-effort application code.

---

## 1. The atomic redemption guarantee

Every in-store redemption goes through **one database function**,
`redeem_gift_card(...)`, and nothing else. Inside a single transaction it:

1. **Locks the card row** — `SELECT ... FROM gift_cards WHERE id = ... FOR UPDATE`.
   All concurrent redemptions of the same card serialize on this lock, so no two
   can read the same balance and both spend it.
2. **Short-circuits duplicates** — if a `gift_card_redemptions` row already exists
   for the request's `idempotency_key`, it returns that **prior** result
   (`out_code = 'duplicate'`) without charging again.
3. **Validates** amount > 0, card exists, status ∈ {`active`,`partially_redeemed`},
   not past `expires_at`, and `amount <= balance`.
4. **Writes atomically** — inserts the immutable ledger debit, inserts the
   redemption row, updates the cached `balance_minor`, recomputes `status`
   (`fully_redeemed` at zero, else `partially_redeemed`), and writes an audit log.
5. **Returns** `(out_code, out_balance_after, out_redemption_id, out_status)`.

Because steps 3–4 share one transaction, the card balance and the ledger can
**never** diverge, and a partial failure rolls the whole thing back.

Outcome codes (mirror `RedeemOutcomeCode` in `lib/data/store.ts`):
`ok | duplicate | invalid_amount | not_found | not_redeemable | expired | insufficient_balance`.

> **Verified:** two concurrent 10000-agorot redemptions against a 15000 balance
> yield exactly one `ok` (balance 5000) and one `insufficient_balance`, with a
> single ledger debit written. The `FOR UPDATE` lock does its job.

---

## 2. Double-spend prevention (idempotency)

Two independent layers stop the same redemption from being applied twice:

- **`gift_card_redemptions.idempotency_key` is `UNIQUE`.** Even if two requests
  race past the pre-check simultaneously, the second `INSERT` violates the unique
  constraint and its transaction aborts — the money is only ever moved once.
- **The ledger debit carries `idempotency_key = 'ledger:' || <key>`** under the
  ledger's partial-unique index, so the ledger side is idempotent too.

The client supplies a stable `idempotency_key` per intended charge (e.g. derived
from the POS sale + card). Retries reuse the same key and safely return
`duplicate` with the original result.

Payment activation has its own idempotency anchor: `payment_events(provider,
event_id)` is `UNIQUE`. `activate_gift_card_from_payment` inserts the event
`ON CONFLICT DO NOTHING`; a replayed webhook inserts nothing and returns
`already_processed`, so duplicate provider callbacks never double-credit a card.

---

## 3. Read-modify-write in app code is forbidden

The classic bug (and the reference site's non-atomic inventory decrement — see
`docs/just-website-repository-audit.md` §7) is:

```
balance = SELECT balance FROM card      -- read
newBalance = balance - amount           -- modify (in app memory)
UPDATE card SET balance = newBalance     -- write
```

Between the read and the write, another request can read the **same** balance and
both spend it → overspend. We eliminate this by construction:

- App code **never** issues an `UPDATE gift_cards SET balance_minor = ...`.
- RLS grants **no** direct write policy on `gift_cards` to `anon` or
  `authenticated`. Balance only changes inside the definer functions.
- The only sanctioned mutation path is `redeem_gift_card()` (and the other
  ledger-writing functions), which do the read-modify-write **inside** a single
  locked transaction in the database.

The `MemoryStore` used for offline dev mirrors this with a mutex so tests exercise
the same atomic contract.

---

## 4. Code vs. token separation

A card has **two** unrelated identifiers, and neither exposes the database id,
balance, or PII:

| Identifier | Purpose | Properties |
| --- | --- | --- |
| `code` (`JAS-7F3K-QP2M-9`) | Manual entry at the till | Human-readable, checksum-protected, `UNIQUE` |
| `public_token` | Links / QR codes | Long, cryptographically random, `UNIQUE`, **revocable** |

- The **code** is what an employee types; it is not embedded in shared links.
- The **token** is what appears in the recipient URL / QR. If a link leaks, the
  token can be **rotated** (and is rotated on reissue) **without** reprinting the
  card's code. A revoked/superseded card's token stops resolving.
- Neither value is derived from the primary key, so guessing one tells an
  attacker nothing about others or about internal ids.

---

## 5. Codes / balances / tokens are never anon-readable

The reference site shipped `orders` with `anon read using(true)` — anyone could
read every order. We do the opposite:

- **RLS is `ENABLE`d and `FORCE`d on every table, deny-by-default.** No policy ==
  no access. There is deliberately **no `anon` SELECT policy** on `gift_cards`,
  `gift_card_ledger_entries`, `gift_card_redemptions`, or `payments`.
- The recipient's public view is served **only** through the `SECURITY DEFINER`
  function **`get_public_gift_card(token)`**, which returns a **PII-minimized**
  projection: `status`, `code`, `recipient_name`, `sender_name` (suppressed when
  the card is anonymous), `greeting`, `initial`/`balance` minor, `currency`,
  `language`, `template_id`, `issued_at`, `expires_at`. It exposes **no database
  id, no buyer PII, no payment data**, and only resolves cards that have actually
  been issued (draft/failed/cancelled/reissued/refunded tokens return nothing).
- Authenticated **staff** reads are scoped by role via `auth_has_role(...)` /
  `auth_is_staff()` against `user_roles` (finance/refund tables restricted to
  `owner/admin/finance/read_only`).
- The **service role** (server code with `SUPABASE_SERVICE_ROLE_KEY`) bypasses
  RLS for privileged writes; the app **refuses** privileged operations without an
  explicit service-role key (it never silently falls back to the anon key, unlike
  the reference site).

---

## 6. QR / link safety

- The QR encodes a URL containing the **`public_token` only** — never the code,
  the balance, PII, or the internal id.
- Because the token is a bearer credential, treat the printed/emailed card like
  cash. Mitigations: the token is **revocable and rotatable**; balance is shown
  only through the minimized definer function; and redemption still requires a
  **signed-in employee** to call `redeem_gift_card` — scanning a QR alone can
  never move money.
- A suspended/expired/reissued card's token resolves to a non-redeemable state,
  so a leaked-but-frozen card is inert.

---

## 7. Rate limiting & abuse resistance

Enforced in the application layer (route handlers / middleware), on top of the DB
guarantees:

- **Public token lookups** (`get_public_gift_card`) are rate-limited per IP to
  blunt token-guessing. Tokens are long and random, so brute force is
  impractical, but throttling removes the incentive and protects the DB.
- **Redemption endpoints** are limited per employee/terminal, and every call is
  authenticated (staff session) and audited. Repeated `insufficient_balance` /
  `not_found` responses are surfaced for monitoring.
- **Payment webhooks** must pass mandatory HMAC/secret verification
  (`lib/security/webhook.ts`) **before** `activate_gift_card_from_payment` is
  called. A browser redirect is **never** proof of payment — activation happens
  only on a verified server-side event, and the webhook amount is reconciled
  against the authoritative stored amount (`amount_mismatch` otherwise).
- Generic one-shot server operations can register a key in `idempotency_keys` to
  guarantee at-most-once execution.

---

## Summary

| Threat | Defense |
| --- | --- |
| Two tills spend the same balance | `SELECT ... FOR UPDATE` row lock in `redeem_gift_card` |
| Retried/duplicated redemption charges twice | `UNIQUE` redemption `idempotency_key` + ledger partial-unique key |
| Overspend past balance | In-transaction balance check + `CHECK (balance_minor >= 0)` |
| App-code read-modify-write race | Balance only mutated inside the locked DB function; no direct write policy |
| Forged "paid" activation | Verified webhook + `payment_events` unique + amount reconciliation |
| Duplicate webhook double-credits | `ON CONFLICT DO NOTHING` on `payment_events(provider, event_id)` |
| Anyone reads all cards/balances | RLS deny-by-default; no anon SELECT; PII-minimized definer function only |
| Leaked link drains the card | Token ≠ code; token revocable/rotatable; redemption needs an authed employee |
