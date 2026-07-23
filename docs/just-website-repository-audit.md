# Just A Second Website — Reference Repository Audit

> Audit of `just-a-second-website` (the existing Wix-adjacent storefront) performed to
> inform the design and payment architecture of the standalone `gift_card_system`.
> **The reference repo was read-only. Nothing in it was modified.**

## 1. Existing technology stack

| Concern | Reference site | Decision for gift_card_system |
| --- | --- | --- |
| Framework | **Vite + React 19 + React Router / wouter** (SPA) | **Next.js (App Router)** — we need server-side webhooks, server actions, and secure server-only secrets, which a static SPA can't give us safely. Rebuilt cleanly, not ported. |
| Language | TypeScript (`~5.9`) | TypeScript strict. |
| Styling | Tailwind CSS **v4** + CSS-var design tokens (`src/index.css`) | Tailwind CSS v3.4 + the **same token values** re-expressed as CSS vars. v3 chosen for build stability + shadcn compatibility. |
| UI kit | shadcn-style primitives in `src/components/ui/*` (Radix + CVA + `cn`) | Same pattern, re-authored (Button/Input/Card/Label/Badge/Dialog…). |
| Data | Supabase (`@supabase/supabase-js`), single anon client | Supabase with **server-side service-role** access for privileged writes + RLS. In-memory seeded fallback for offline local dev. |
| Hosting | Netlify functions (mirrored to Vercel via `api/` adapter) | Next.js route handlers / server actions (host-agnostic; Vercel-friendly). |
| Payments | **Grow (grow.link / Meshulam)** via a **Make.com webhook**, plus a direct Grow REST fallback. Stripe is a dependency but **unused**. | Payment **abstraction** with a mock provider (default) and a **Grow adapter** modeled on the reference flow — but hardened (see §7). |
| Email | Resend (`send-order-receipt.ts`) | Email **abstraction**: dev-log adapter (default) + Resend adapter. |

## 2. Design patterns found (the parts worth reusing)

The brand system is fully specified in the reference `CLAUDE.md` and `src/index.css`. These
**token values are reused verbatim** in `gift_card_system` (`app/globals.css` + `tailwind.config.ts`):

- **Palette:** `--jas-orange #E88225` (one accent per screen), `--jas-cream #FFFCF5` (page bg, never pure white), `--jas-sage #B5C9AD`, `--jas-slate #626B65` (body), `--jas-forest #333D36` (headlines), plus the documented tints.
- **Semantic HSL tokens:** `--background 42 100% 98%`, `--foreground 138 9% 22%`, `--primary 29 80% 53%`, `--secondary 105 22% 85%`, `--muted 43 42% 87%`, `--muted-foreground 140 4% 40%`, `--accent 105 22% 73%`, `--destructive 11 61% 44%`, `--border/--input 43 26% 82%`, `--ring 29 80% 53%`, `--radius 0.875rem`.
- **Type:** Heebo (body + Hebrew, Google Fonts), Antidot (licensed display, English hero/wordmark only). H1 64/1.05, H2 44/1.10, H3 28/1.20, body 16/1.55; `.eyebrow` 12px 600 tracking .14em uppercase.
- **Spacing:** 4pt grid. **Radii:** xs4/sm8/md14/lg22/xl32/pill. **Shadows:** warm forest-alpha, low contrast. **Motion:** 120/220/420ms, fades over slides, gate on `prefers-reduced-motion`.
- **RTL-first:** Hebrew-first `dir="rtl"`, logical properties (`ms/me`), `dir="ltr"` embeds for phone/price/codes.

**Reused as-is:** the token file, the shadcn primitive pattern, RTL rules.
**NOT copied:** pages hardcode hex (`bg-[#FFFCF5]`) and use native `<input>`/`<button>` instead of the `ui/*` primitives — we use semantic tokens + primitives consistently instead.

## 3. Payment provider found & flow

**Provider: Grow (grow.link, Israeli aggregator), reached indirectly through Make.com.**

- `netlify/functions/create-payplus-payment.ts` (misnamed): upserts an `orders` row (`pending`),
  then either (a) returns `{demo:true}` when no payment env is set, (b) POSTs `MAKE_WEBHOOK_URL`
  and returns the Grow hosted-page URL, or (c) calls Grow REST directly
  (`https://restapi.grow.link/api/light/server/createPaymentProcess`).
- Client (`src/pages/Checkout.tsx`) redirects the browser to the Grow page.
- `netlify/functions/grow-webhook.ts` receives Grow's callback, flips the order to `paid`,
  decrements inventory, and triggers the receipt email.
- A **third, client-driven** path `process-pending-orders.ts` marks orders paid when the user
  merely returns to `/order-success` — **with no payment proof**.

Env vars in play (only Supabase+Stripe are in `.env.example`; the rest are undocumented):
`MAKE_WEBHOOK_URL`, `GROW_API_KEY`, `GROW_API_SECRET`, `GROW_PAGE_CODE`, `GROW_API_URL`,
`SUPABASE_SERVICE_ROLE_KEY` (falls back to anon), `VITE_SUPABASE_URL/ANON_KEY`, `RESEND_*`,
`SITE_URL`, `WEBHOOK_SECRET` (defined in `_security.ts` but **never used**).

## 4. Reusable components & assets

- **Reusable (adapted):** design tokens, `ui/*` primitive pattern, `cn()` util, RTL conventions,
  phone-normalization logic (Israeli numbers), origin-resolution logic.
- **Brand assets available:** `public/logo.png`, `public/favicon.svg`, `public/icons.svg` (pictogram
  sprite), real photography (`jas-*.jpeg`), and the **licensed Antidot font**
  (`public/fonts/Antidot-{Light,Bold}.{woff2,otf}`). These may be copied when suitable.
- **NOT brand (do not copy):** `src/assets/react.svg`, `vite.svg`, the Unsplash gift-card image,
  hotlinked Wikimedia payment logos.

## 5. Existing gift-card work

Commit `be8c406` "gift card as purchasable shop product" is a **front-end-only UX shell**:
`src/lib/giftCard.ts` builds a synthetic cart line (negative product id, per-purchase price),
`src/pages/GiftCard.tsx` collects amount/sender/recipient/message with a live preview, and the
order carries it as JSON metadata inside `orders.items`. **There is no `gift_cards` table, no code,
no token, no balance, no redemption, and the recipient is never actually emailed a card.** Every
capability the brief asks for is net-new.

## 6. Supabase state

Tables: `categories, products, orders, reviews, newsletter, site_content, blog_posts`. RLS is enabled
but **dangerously permissive** — e.g. `orders` has `anon read using(true)` (anyone can read every
order), `newsletter` allows anon delete, `blog_posts` has `anon full access using(true)`. **No gift
card tables exist.** We deliberately do **not** follow this RLS pattern — gift card codes/balances
must never be anon-readable (see `docs/redemption-security.md`).

## 7. Security concerns found → how gift_card_system improves them

| Weakness in reference | Impact | Our fix |
| --- | --- | --- |
| Webhook verifies **no signature/secret** (`grow-webhook.ts` accepts any POST; `verifyWebhookToken` exists but is never called) | Anyone knowing a guessable `order_ref` can forge `paid` | **Mandatory HMAC/secret verification** on every webhook (`lib/security/webhook.ts`); reject unverified. A gift card is activated **only** after a verified server-side event. |
| Amount **trusted from client**, never reconciled against webhook `sum` | Underpayment / free goods | Server stores the authoritative amount at order creation; webhook amount is **reconciled** before activation. |
| Client-side "payment success" bypass + `process-pending-orders` | Fulfillment with no payment | Browser redirect is **never** proof of payment. Confirmation page **polls** server state; activation happens only on verified webhook. |
| **Float money** (`numeric(10,2)`, `parseFloat`) | Rounding errors | **Integer minor units (agorot)** everywhere; DB `bigint`; no floats. |
| Idempotency = `status !== 'paid'` check only | Duplicate webhooks double-process | Dedicated `idempotency_keys` + `payment_events` unique constraint; ledger insert is idempotent. |
| Non-atomic inventory decrement (select→update) | Race conditions | Redemption is a **single atomic DB operation** (`redeem_gift_card()` with `FOR UPDATE`), never read-modify-write in app code. |
| Service-role key silently falls back to anon | Silent privilege confusion | Server refuses privileged operations without an explicit service-role key; env validation enforces this. |

## 8. Recommended reuse summary

- **Reuse:** brand tokens, UI primitive pattern, RTL rules, phone/origin helpers, brand assets & fonts.
- **Reimplement cleanly (don't port):** the SPA architecture, the payment flow (behind our
  `PaymentProvider` interface, hardened), any Supabase access (server-side + strict RLS).
- **Do not copy:** permissive RLS, float money, client-trusted amounts, unverified webhooks,
  the client-driven "paid" reconciliation path, stock/scaffold assets, hotlinked logos.
