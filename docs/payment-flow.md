# Payment flow

How a gift card gets paid for and activated. The governing rule: **a gift card is
activated only by a signature-verified, server-side webhook.** A browser redirect
to the confirmation page is never proof of payment. This document covers the
provider interface, the mock provider, the Grow adapter, the idempotent
activation sequence, and how to switch to Grow.

Related: `docs/architecture.md` (§8 purchase flow), `docs/redemption-security.md`
(webhook + idempotency guarantees), `docs/database.md` (payment tables + RPCs).

---

## 1. The `PaymentProvider` interface

Defined in `lib/payments/types.ts`. Every provider implements four methods:

```ts
interface PaymentProvider {
  readonly name: string
  createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSession>
  verifyWebhook(request: Request): Promise<VerifiedPaymentEvent>
  refundPayment(input: RefundPaymentInput): Promise<RefundResult>
  getPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentStatus>
}
```

- **`createCheckoutSession`** — takes our `orderRef` (the gift card id), amount in
  **minor units**, currency, customer, and the `successUrl` / `cancelUrl` /
  `notifyUrl`. Returns a `CheckoutSession { checkoutId, redirectUrl, provider }`.
- **`verifyWebhook`** — verifies the provider's callback signature and normalizes
  it to a `VerifiedPaymentEvent { provider, eventId, orderRef, providerPaymentId,
  status, amountMinor, currency, raw }`. Throws `WebhookVerificationError` on a
  bad/missing signature — the handler then returns `400` and never acts.
- **`refundPayment`** / **`getPaymentStatus`** — refunds and status polling.

The factory `getPaymentProvider()` (`lib/payments/index.ts`) constructs the mock
or Grow provider from env as a singleton. It is `server-only`.

---

## 2. The mock provider (default, no credentials)

`MockPaymentProvider` (`lib/payments/mock.ts`). The "hosted checkout" is our own
page, `app/checkout/mock/page.tsx`, rendered via `components/checkout/mock-checkout.tsx`.

- `createCheckoutSession` returns a `redirectUrl` of `/checkout/mock?...` carrying
  the checkout id, order ref, amount, and the success/cancel/notify URLs.
- On the dev "Approve" action the mock checkout posts a **signed** webhook (HMAC
  via `buildSignedWebhook` / `signBody`, header `x-mock-signature`) to the real
  `/api/webhooks/payment` endpoint.
- `verifyWebhook` recomputes the signature with `PAYMENT_WEBHOOK_SECRET` and
  rejects any mismatch (`WebhookVerificationError('invalid_signature')`).

The point: **the browser redirect is never proof of payment.** Even in dev,
activation happens through the exact same signature-verified webhook path as
production, so the mock is a faithful stand-in.

---

## 3. The Grow adapter (intended production provider)

`GrowPaymentProvider` (`lib/payments/grow.ts`) — Grow (grow.link / Meshulam), the
Israeli aggregator used by the reference site (Israeli cards, Bit, Apple/Google
Pay via Grow's hosted page). It is **hardened** relative to the reference site
(see `docs/just-website-repository-audit.md` §7):

- **HMAC-verified webhooks** (`verifySignature` in `lib/security/webhook.ts`) —
  the reference verified nothing.
- **Amount reconciled** against the stored order inside
  `activate_gift_card_from_payment` before activation (`amount_mismatch`
  otherwise) — the reference trusted the client amount.
- **Minor-unit money** across the boundary; Grow's major-unit `sum` is converted
  explicitly (`toMajor` on the way out, `Math.round(sum * 100)` on the way in).

`createCheckoutSession` POSTs a form to
`${GROW_API_URL}/api/light/server/createPaymentProcess` with `pageCode`,
`userId`/`apiKey`, `sum` (major units), customer `pageField[...]`, the callback
URLs, and `cField1 = orderRef` (which round-trips back on the webhook).

> **UNVERIFIED against a live account.** The adapter is written to Grow's
> *documented* shapes but has not been exercised against a real Grow account.
> **Before go-live, confirm with Grow:** the exact webhook field names
> (`transactionCode` / `asmachta` / `statusCode` / `sum` / `cField1` …) and the
> **webhook signature scheme + header** (the adapter currently reads
> `x-grow-signature` / `x-signature`). Until confirmed, keep `PAYMENT_PROVIDER=mock`.

---

## 4. The 16-step safe, idempotent activation sequence

From `lib/gift-cards/service.ts` (`createPurchase` → `processVerifiedPaymentEvent`)
and `supabase/migrations/0003_functions.sql`:

1. Customer completes the funnel; `createPurchase` runs (`app/actions/purchase.ts`).
2. The amount is validated **server-side** against `system_settings`
   (`validateAmountAgainstSettings`) — the client amount is never trusted.
3. A gift card is created in **draft (inactive)** state (`store.createGiftCard`),
   with a fresh `code` and `public_token`.
4. A `pending` payment row is attached (`store.attachPayment`).
5. `getPaymentProvider().createCheckoutSession(...)` opens the hosted checkout;
   `notifyUrl` points at `/api/webhooks/payment`.
6. The checkout id is recorded (`store.setCheckoutOpened`) and an audit entry
   (`giftcard.purchase_started`) is written.
7. The browser is redirected to the hosted payment page (mock or Grow).
8. The customer pays on the provider's page.
9. The provider POSTs a webhook to `/api/webhooks/payment`.
10. `handlePaymentWebhook` (`lib/payments/webhook-handler.ts`) calls
    `provider.verifyWebhook` — a bad signature returns **400** and nothing changes.
11. The verified event goes to `processVerifiedPaymentEvent`. Non-`paid` statuses
    are only audited, never activated.
12. `store.activateFromPayment(...)` calls `activate_gift_card_from_payment`,
    which is idempotent on `payment_events(provider, event_id)` and **reconciles
    the amount** against `initial_amount_minor`.
13. On success it activates **exactly one** card and writes **exactly one**
    `initial_credit` ledger entry (balance cached atomically).
14. Post-activation side-effects run **only the first time** (guarded by outcome
    code `activated`): a receipt is issued via `getReceiptProvider()`.
15. The buyer confirmation email is sent (`idempotencyKey: buyer-confirm:<id>`).
16. A recipient `delivery_job` is enqueued (immediate or scheduled); immediate
    jobs are flushed inline via `deliverDueJobs`, otherwise the cron worker sends
    them.

Replays are safe at every step: a duplicate webhook inserts no new
`payment_events` row and returns `already_processed`, so no second card, ledger
entry, receipt, or email is produced.

---

## 5. Idempotency guarantees

- **`payment_events(provider, event_id)` is `UNIQUE`.**
  `activate_gift_card_from_payment` inserts the event `ON CONFLICT DO NOTHING`; a
  replayed webhook inserts nothing and returns `already_processed`.
- **Amount reconciliation.** The webhook `amountMinor` is compared to the stored
  `initial_amount_minor`; a mismatch returns `amount_mismatch` and the card is not
  activated.
- **Email idempotency keys** (`buyer-confirm:<id>`, `recipient:<id>`) stop
  duplicate sends.
- **Delivery jobs** are claimed with `FOR UPDATE SKIP LOCKED` (`claim_due_delivery_jobs`).

---

## 6. Confirmation-page polling

After paying, the browser lands on `app/checkout/confirmation/page.tsx`
(`?ref=<giftCardId>`). The `Confirmation` client component
(`components/checkout/confirmation.tsx`) **polls** the `getPurchaseStatus` server
action every ~1.5s, up to ~20 attempts, until the card reports `paid`. It shows a
"processing" state until the verified webhook has activated the card, then reveals
the code and a link to the recipient view. The page updates itself; the redirect
is never treated as payment.

---

## 7. Switching to `PAYMENT_PROVIDER=grow`

Set in the server environment (never `NEXT_PUBLIC_`):

```
PAYMENT_PROVIDER=grow
GROW_API_URL=https://restapi.grow.link
GROW_API_KEY=<your Grow user id>
GROW_API_SECRET=<your Grow api key>
GROW_PAGE_CODE=<your Grow page code>
PAYMENT_WEBHOOK_SECRET=<the HMAC secret used to verify Grow callbacks>
```

`getPaymentProvider()` then constructs `GrowPaymentProvider`. Before flipping the
switch in production, run a real transaction and verify amount reconciliation, and
**confirm the webhook field names and signature scheme with Grow** (see §3 and
`docs/production-checklist.md`).
