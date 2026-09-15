# Souk — Lebanese grocery e-commerce for France

Web storefront + Android/iOS app for importing and selling shelf-stable
Lebanese groceries across France.

> **Working name.** `souk` is a placeholder until the brand is decided.
> Only the directory name and `apps/*/app.config` carry it.

---

## Architecture

One TypeScript monorepo. The domain logic lives in a shared package so a
price, a tax total or a delivery promise can never differ between the
website and the app.

```
souk/
├─ packages/
│  ├─ core/      domain logic — money, VAT, INCO, shipping, cart, orders
│  └─ db/        Prisma schema + client (PostgreSQL)
└─ apps/
   ├─ web/       Next.js — storefront, admin, and the API both clients call
   └─ mobile/    Expo — Android first, iOS from the same source
```

### Why this shape

**Next.js for the web, not Expo Web.** A new store lives or dies on being
found. Next.js server-renders real HTML for every product page; React Native
Web ships a JS bundle a crawler has to execute, and adds ~30–40 KB gzipped
before any of your own code. The catalogue is the marketing.

**Expo for mobile, not a webview wrapper.** Apple's Guideline 4.2 rejects
apps that are a repackaged website, and it is one of the most common
rejection reasons. Expo gives genuinely native navigation, push
notifications, offline catalogue caching and a native relay-point map — the
things that both pass review and make the app worth installing. It also
builds iOS binaries in the cloud, so no Mac is needed.

**The website is a full PWA.** Installable from the browser, works offline,
no download ever forced. The app store listing is an option for customers,
not a toll gate.

**No Medusa, no Shopify backend.** For a few hundred SKUs and one warehouse,
a headless commerce platform is a second runtime to maintain, a second
upgrade treadmill — and its product model knows nothing about allergens,
durability dates or lot numbers, so it would need extending anyway. The
custom model in `packages/core` is smaller than the integration would be.

**Every price is an integer number of cents.** Never a float.

---

## Status

| Area | State |
|---|---|
| `packages/core` — money, VAT, allergens, INCO, shipping, cart, orders | **Done**, 38 tests passing |
| `packages/db` — Prisma schema + seed | **Done**, verified against PostgreSQL 16 |
| `apps/web` — storefront (home, catalogue, product, cart) | **Done**, builds and renders |
| `apps/web` — checkout + admin | Next |
| `apps/mobile` — Expo Android app | Not started |
| Stripe payments, carrier APIs, transactional email | Not started |

The storefront prerenders every product and category page as static HTML, so
the catalogue is crawlable without executing JavaScript.

## Commands

```bash
pnpm install
pnpm --filter @souk/core typecheck
pnpm --filter @souk/core build && node --test "packages/core/dist/**/*.test.js"

# Database (needs DATABASE_URL — see packages/db/.env.example)
pnpm --filter @souk/db deploy    # apply migrations
pnpm --filter @souk/db seed      # categories + starter catalogue
pnpm --filter @souk/db smoke     # end-to-end pricing/compliance check

# Storefront on http://localhost:3100
pnpm --filter @souk/web dev
```

---

## Decisions already locked

- **No alcohol.** Avoids licensing, indirect-contribution accounting and
  age verification.
- **Franchise en base de TVA.** No VAT charged; import VAT is a cost, not a
  credit. The engine is switchable because the 85 000 € / 93 500 € ceiling
  is automatic. See [`docs/compliance-france.md`](docs/compliance-france.md).
- **Carriers: Mondial Relay + Colissimo.** Relay points for cheap, Colissimo
  to the door for speed.
- **Android first.** Google Play before the App Store.

### Two things to start now, because they have lead times

1. **Register the Play account as an organisation, not a personal one.**
   Personal accounts opened after 13 Nov 2023 must run a closed test with
   **12 testers for 14 consecutive days** before production access.
   Organisation accounts verified with a D-U-N-S number are exempt — but
   verification takes 2–4 weeks. The same D-U-N-S covers Apple later, where
   the company name must match the D&B record *exactly*, accents included.
2. **Join Citeo** and obtain the IDU. It is mandatory, it must be displayed
   on the site, and it belongs in the landed-cost calculation.

## Rates to replace before launch

`packages/core/src/shipping.ts` ships indicative public rates so checkout
works end to end. Swap in the negotiated grid — from the carriers directly,
or via Boxtal (no subscription, suits low volume) or Sendcloud (more
automation, pays off at higher volume). The engine does not change.
