# Wix integration

How to connect the existing **Just A Second** Wix site to this standalone
gift-card app. Short version: the app runs on its own branded subdomain and Wix
simply **links** to it. There is no embedding and no runtime dependency between
the two.

---

## 1. The app is standalone

`gift_card_system` is a self-contained Next.js application (see
`docs/architecture.md`). It has its own database (Supabase), its own payment
webhook, and its own delivery pipeline. It does **not** depend on Wix for
anything and can outlive a future migration off Wix — nothing here breaks if the
marketing site is rebuilt on another platform.

Deploy it to a **branded subdomain**, for example:

```
gift.justasecond.co.il
```

Point `APP_BASE_URL` at that host (it is used in emails, QR links, and webhook
URLs — see `.env.example`).

---

## 2. Link from Wix, don't embed

Add a **"Buy a Gift Card" button** on the Wix site that links to the purchase
funnel entry point:

```
https://gift.justasecond.co.il/gift-cards
```

(the `app/gift-cards/page.tsx` route).

**Do not embed the app in an iframe.** Payment happens on the provider's hosted
page and the whole flow relies on server-side webhooks and secure cookies;
iframing it inside Wix would break cookie/session behavior and undermine payment
security. A plain outbound link (optionally opening in a new tab) is the correct,
secure integration.

### Optional tracking parameters

To measure Wix-sourced traffic, append UTM params to the link:

```
https://gift.justasecond.co.il/gift-cards?utm_source=wix&utm_medium=button&utm_campaign=gift_cards
```

These are ordinary query params; they do not change app behavior.

### Optional return-to-Wix after purchase

If you want buyers to land back on the Wix site after a successful purchase, you
can direct them there from the confirmation experience (e.g. a "Back to
justasecond.co.il" link). The core flow does not require this — the confirmation
page (`app/checkout/confirmation/page.tsx`) already shows the code and a link to
the recipient view.

---

## 3. Matching visual identity

The gift-card app reuses the **same Just A Second design tokens** as the main site
(the palette, typography, spacing, and RTL rules documented in the brand
`CLAUDE.md`, re-expressed in `app/globals.css` + `tailwind.config.ts` — see
`docs/just-website-repository-audit.md` §2). Style the Wix button to match:
cream ground, forest text, and the single orange accent for the primary call to
action, so the handoff between sites feels seamless.

---

## 4. Concrete Wix editor steps

1. Open the Wix **Editor** and go to the page/header where the button should live.
2. Click **Add (+) → Button** and drop a **Button** element onto the page.
3. Set its label, e.g. **"קנו שובר מתנה"** / "Buy a Gift Card".
4. Select the button → click the **Link** icon.
5. Choose **Web Address** (external URL).
6. Paste `https://gift.justasecond.co.il/gift-cards` (add `?utm_source=wix` if you
   want tracking).
7. Optionally set it to **open in a new tab**.
8. Style the button to the brand tokens (cream/forest/orange) so it matches §3.
9. **Publish** the Wix site.

That's the whole integration — one button, one link. The gift-card app handles
everything from there.
