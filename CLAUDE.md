# CLAUDE.md

This file provides mandatory development instructions for Claude Code when working in this repository.

# 1. Project Overview

**Project:** E-Commerce Storefront — Backend API

**Frontend:** `d:\react\e-commerce-store` (React 19 + Vite, JavaScript only)

**Admin app:** `d:\react\callixe-admin` (React 19 + Vite, JavaScript only, port 5174). Plan and phase status: [docs/admin-plan.md](docs/admin-plan.md).

**Production server, URLs and deploy steps:** [docs/server.md](docs/server.md) (Droplet, PM2 app, Hostinger folders, Stripe destinations, troubleshooting).

This backend serves a simple guest checkout. The customer flow is:

1. Browse products and add them to the cart (cart lives in the browser's localStorage).
2. Click "Shop now" / "Checkout" and enter email and delivery details.
3. Pay with Stripe.
4. See the order confirmation page.

Keep the backend as small as this flow needs. Do not invent features.

**Admin panel (in scope):** a single admin (credentials from env, no admin users table, no roles) manages products and images and views paid orders and customers. Scope and phases: [docs/admin-plan.md](docs/admin-plan.md).

**Out of scope unless I ask for it:** customer accounts or customer login, admin roles or multiple admins, server-side carts, inventory/stock, categories, tax, refunds, fulfillment beyond the admin's "Mark as shipped" (no tracking numbers, couriers, out-for-delivery or delivered steps), multiple shipping methods, PayPal as a separate integration.

## Technology Stack

- NestJS 11
- TypeScript
- Node.js
- PostgreSQL
- TypeORM (via `@nestjs/typeorm`) with the `pg` driver
- Stripe (Node SDK)
- class-validator / class-transformer (DTO validation)
- @nestjs/config (environment variables)
- @nestjs/throttler (rate limiting, applied per route: `POST /orders`, `POST /discounts/validate`, `POST /admin/login`)
- @nestjs/jwt + bcrypt (admin login only)
- Jest + Supertest (testing)

# 2. Strict Command Execution Rules

These rules are mandatory.

- NEVER execute commands in the background.
- NEVER start background processes without explicit permission.
- NEVER run terminal commands unless I explicitly ask you to execute them.
- NEVER install, uninstall, update, or upgrade packages without my permission.
- NEVER modify package versions independently.
- NEVER run database migrations, resets, or seeds without my instruction.
- NEVER execute build, lint, test, or development commands without my instruction.

When a package or command is required:
1. Explain why it is required.
2. Provide the exact command.
3. Reference the official documentation.
4. Wait for my permission before executing it.

I want to control all terminal operations.

# 3. Module Structure

Five feature modules: Products, Orders, Payments, Admin, and Email. Do not add more without my permission.

```
src/
├── common/
│   ├── middleware/
│   │   └── request-logger.middleware.ts  # global, registered with app.use()
│   └── validation/             # shared rules (slug pattern, Trim transforms)
├── config/
│   └── env.validation.ts       # validates required env variables at startup
├── database/
│   ├── database.module.ts      # the ONLY TypeOrmModule.forRootAsync() call
│   ├── typeorm.config.ts       # buildDataSourceOptions(): single source of connection options
│   ├── data-source.ts          # TypeORM DataSource for the migration CLI (reuses the options)
│   └── migrations/             # schema AND seed data (one `migration:run` does both)
├── products/
│   ├── dto/                    # product-slug-param, product-response
│   ├── entities/               # product, product-image, shop-hero, featured-card
│   ├── storage/                # ImageStorage interface, local + Spaces drivers, provider
│   ├── products.module.ts      # exports ProductsService (Orders, Admin), ProductImagesService, ShopHeroService and FeaturedCardsService (Admin)
│   ├── products.controller.ts
│   ├── products.service.ts     # public reads + admin CRUD; exports the types Admin uses
│   ├── product-images.service.ts # upload/replace/reorder/delete images (storage + DB order rules)
│   ├── shop-hero.controller.ts # GET /shop-hero
│   ├── shop-hero.service.ts    # Shop page hero text + image (same image rules)
│   ├── featured-cards.controller.ts # GET /featured-cards
│   ├── featured-cards.service.ts # the two Shop page product cards (product, image side, promo)
│   ├── image-type.ts           # detects JPEG/PNG/WebP from file bytes
│   └── *.spec.ts
├── orders/
│   ├── dto/                    # create-order, validate-discount, responses
│   ├── entities/               # order, order-item, discount-code
│   ├── emails/                 # order-confirmation / order-shipped .email.ts: pure HTML + text builders
│   ├── orders.module.ts        # imports ProductsModule, EmailModule; exports OrdersService, OrderReportsService
│   ├── orders.controller.ts    # POST /orders, GET /orders/:id
│   ├── discounts.controller.ts # POST /discounts/validate
│   ├── orders.service.ts       # checkout + webhook (money-critical writes)
│   ├── order-reports.service.ts # read-only paid-order/customer/dashboard queries for Admin
│   ├── order-emails.service.ts # customer emails about an order (confirmation); never throws
│   ├── orders.constants.ts     # shipping, limits, countries, rate limits
│   ├── pricing.ts              # pure functions: subtotal, discount, total
│   └── *.spec.ts
├── payments/
│   ├── payments.module.ts
│   ├── payments.controller.ts  # POST /payments/webhook
│   ├── payments.service.ts     # Stripe client wrapper: Checkout Sessions, webhook verification
│   └── *.spec.ts
├── email/
│   ├── email.module.ts         # exports EmailService
│   ├── email.service.ts        # Brevo API wrapper: send({ to, subject, html, text, tags })
│   └── *.spec.ts
├── admin/
│   ├── dto/                    # login, pagination, product create/update/list, slug param
│   ├── admin.module.ts         # JwtModule; imports ProductsModule
│   ├── admin.constants.ts      # login rate limit, token TTL, page sizes, product limits
│   ├── admin.guard.ts          # Bearer token check; @UseGuards(AdminGuard) per controller
│   ├── admin-auth.controller.ts     # POST /admin/login, GET /admin/me
│   ├── admin-auth.service.ts
│   ├── admin-products.controller.ts # /admin/products
│   ├── admin-product-images.controller.ts # /admin/products/:slug/images
│   ├── admin-shop-hero.controller.ts # /admin/shop-hero
│   ├── admin-featured-cards.controller.ts # /admin/featured-cards
│   ├── image-upload.options.ts # shared multer limits (5 MB, one file) for admin uploads
│   ├── admin-orders.controller.ts    # /admin/orders (paid only; read-only except POST :id/ship)
│   ├── admin-customers.controller.ts # /admin/customers
│   ├── admin-dashboard.controller.ts # /admin/dashboard
│   ├── admin-dashboard.service.ts    # combines ProductsService + OrderReportsService figures
│   └── *.spec.ts
├── app.module.ts
└── main.ts
```

Module responsibilities:

- **Products:** the product catalog and the source of truth for prices. Public routes are read-only; create/update happen only through the admin.
- **Admin:** admin login and the admin HTTP routes. Holds no repositories and imports no other module's entities or DTOs: it calls exported services (`ProductsService`, later `OrdersService`) and uses the types those service files export.
- **Orders:** create orders from checkout data, calculate totals, validate discount codes, return an order for the confirmation page.
- **Payments:** create Stripe Checkout Sessions (hosted payment page) and handle the Stripe webhook that marks orders as paid or failed.
- **Email:** sends transactional email through the Brevo API (`POST https://api.brevo.com/v3/smtp/email`, Node's built-in `fetch`, 10 s timeout). Knows nothing about orders; features build their own content.

Email rules:

- The order confirmation is sent only when the webhook **actually** changes an order to `paid` (`affected = 1`), so duplicate Stripe events never email twice. Failed/expired payments send nothing.
- It is started without `await` (fire-and-forget) so Stripe gets its 2xx quickly. `OrderEmailsService` never throws: a Brevo failure is logged and the order stays paid. No retry and no "sent" column yet (Phase 2).
- Every customer value put into email HTML goes through `escapeHtml`. Emails use table layout + inline CSS (email clients), plus a plain-text copy.
- Never log the API key, email bodies or customer email addresses; log the order number and Brevo's message id or error code.
- Stripe's own `receipt_email` is kept, so a paying customer gets both emails.
- `ORDER_NOTIFY_EMAIL` (optional) gets a hidden copy (BCC) of every confirmation: the same email, in the same send. Skipped when it equals the customer's email. If the send fails, neither copy arrives.
- **Shipping email** ("Your order #N is on its way"): sent by the admin's Mark as shipped / Resend (`POST /admin/orders/:id/ship`). Unlike the confirmation it is **awaited**, because the admin waits to see whether it went out: `sendShipped` returns the sent time or `null` (never throws), and `shipping_email_sent_at` is set only after a successful send. No link to the order page, no tracking details. Same BCC rule.
- **Database:** TypeORM data source and migrations (schema and seed data). Each feature module registers its own entities with `TypeOrmModule.forFeature([...])`.

Only create files and folders when they are actually needed.

# 4. API Contract

The frontend depends on these endpoints. Do not change their shape without telling me.

| Method | Path | Purpose |
|---|---|---|
| GET | `/products` | List active products: `{ slug, name, price, compareAtPrice, description, badge, secondUnitHalfOff, images: [{ url, isMain }] }` |
| GET | `/products/:slug` | One active product (same shape), 404 if not found |
| POST | `/discounts/validate` | Body `{ code }` → 200 `{ code, type, value }` or 400. 10/min per IP |
| POST | `/orders` | Create pending order, returns `{ orderId, orderNumber, total, checkoutUrl }`; the frontend redirects to `checkoutUrl` (Stripe-hosted page). 8/min per IP |
| GET | `/orders/:id` | Order for the confirmation page (UUID v4, 400 if malformed, 404 if missing). Includes `presentment: { amount, currency } \| null` (what the customer paid in their own currency, display only) |
| POST | `/payments/webhook` | Stripe webhook only |
| GET | `/featured-cards` | The two Shop page product cards: `[{ slot, slug, imagePosition, promo }]`, only cards with an active product. The storefront takes name/prices/image from `GET /products` by slug |
| GET | `/shop-hero` | Shop page hero: `{ eyebrow, title, image: { url, alt } \| null }`; `null` image = storefront uses its own. 404 if the row is missing |

Admin endpoints (used only by the admin app). Every route except login requires `Authorization: Bearer <token>` (`AdminGuard`):

| Method | Path | Purpose |
|---|---|---|
| POST | `/admin/login` | `{ email, password }` → `{ accessToken }` (JWT, 8h). Same 401 for wrong email or password. 5/min per IP |
| GET | `/admin/me` | `{ email }`; lets the admin app check a saved token |
| GET | `/admin/products` | `?search=&active=&sort=&page=&limit=` → `{ items, page, limit, total }`, includes inactive |
| GET | `/admin/products/:slug` | One product, including inactive; 404 if missing |
| POST | `/admin/products` | Create; 409 if the slug exists |
| PATCH | `/admin/products/:slug` | Update any field except the slug (including `secondUnitHalfOff: boolean`); `null` clears `compareAtPrice`/`description`/`badge` |
| POST | `/admin/products/:slug/images` | Multipart `file` (+ optional `isMain`) → `{ id, url, isMain, position }`. JPEG/PNG/WebP by file bytes, ≤ 5 MB (413), ≤ 10 per product |
| PATCH | `/admin/products/:slug/images/:imageId` | `{ isMain?: true, position? }` → all images in their new order |
| PUT | `/admin/products/:slug/images/:imageId/file` | Replace the file of the same image |
| DELETE | `/admin/products/:slug/images/:imageId` | 204; the next image becomes main if needed |
| GET | `/admin/shop-hero` | `{ eyebrow, title, imageAlt, image: { url } \| null, updatedAt }` |
| PATCH | `/admin/shop-hero` | `{ eyebrow?, title?, imageAlt? }` (eyebrow 1–150, title 1–100, imageAlt ≤ 200; `null`/blank clears imageAlt) |
| PUT | `/admin/shop-hero/image` | Multipart `file`: upload or replace the hero image. Same type/size rules as product images |
| DELETE | `/admin/shop-hero/image` | 204; the storefront shows its own image again |
| GET | `/admin/featured-cards` | Both cards: `[{ slot, imagePosition, promo, product: <admin product view> \| null, updatedAt }]` |
| PATCH | `/admin/featured-cards/:slot` | Slot 1 or 2. `{ productSlug?: slug, imagePosition?: 'left' \| 'right', promo?: string \| null }` (`productSlug` can't be `null`: both cards always show) (promo 1–30, blank/`null` removes it). Unknown product 404, inactive 400, product already in the other card 409. Product details are saved with `PATCH /admin/products/:slug` (the admin app calls it first) |

| GET | `/admin/orders` | `?email=&orderNumber=&shipped=&from=&to=&sort=&page=&limit=` (dates `YYYY-MM-DD`, UTC, `to` inclusive; `shipped` = `true`/`false`) → paid orders page, each with `shippedAt` |
| GET | `/admin/orders/:id` | One **paid** order (UUID v4); pending/failed → 404. Includes `fulfillment: { shippedAt, emailSentAt }` (`shipping` stays the shipping price) and `presentment` (also on each `/admin/orders` item) |
| POST | `/admin/orders/:id/ship` | No body. Paid orders only (else 404). Sets `shippedAt` the first time (never changes it after), then emails the customer; on a shipped order it only resends the email → `{ shippedAt, shippingEmailSentAt, emailSent }`. A failed email still leaves the order shipped (`emailSent: false`) |
| GET | `/admin/customers` | `?search=&sort=&page=&limit=` → customers = paid orders grouped by `lower(email)` |
| GET | `/admin/customers/detail` | `?email=&page=&limit=` → summary, latest contact details, paid orders; 404 if none |
| GET | `/admin/dashboard` | Product counts, paid orders, customers, revenue, average order, recent orders, top products |

Reports (`OrderReportsService`) are read-only and see **paid orders only**. All counting/summing is done in SQL with bound parameters; sort columns come from fixed maps; bigint results go through `toSafeInteger` (never a silently wrong number). Payment status still changes only through the Stripe webhook; the admin can only set `shipped_at` (`OrdersService.markShipped`).

Image rules (`ProductImagesService`): write the new file → change the DB in a transaction that locks the product row → on DB failure delete the new file → only after commit delete the old file. Failed deletes are logged, never thrown. The first image is always main; exactly one main image while any exist (partial unique index); positions stay 0, 1, 2, …

There is no product DELETE: `active: false` hides a product and keeps past orders and links intact. Admin responses never include the internal `id`.

`POST /orders` request body:

```json
{
  "email": "customer@example.com",
  "delivery": {
    "firstName": "", "lastName": "", "address": "", "apartment": "",
    "city": "", "postalCode": "", "country": "Pakistan", "phone": ""
  },
  "items": [{ "slug": "neck-pillow-2-0", "quantity": 1 }],
  "discountCode": "WELCOME10"
}
```

The client sends **only slugs and quantities**, never prices or totals.

Order rules:

- `apartment`, `postalCode`, `phone`, `discountCode` are optional; blank strings are treated as missing.
- `country` must be one of `ALLOWED_COUNTRIES` (same list as the frontend form).
- Quantity 1–10 per product, max 20 lines, each slug at most once.
- Unknown or inactive products, or an invalid/inactive discount code → 400, nothing saved.
- Marketing opt-in checkboxes ("Email me / Text me with news") are not stored.

# 5. Money and Pricing Rules

These rules are mandatory. Getting them wrong costs real money.

- All amounts are **integers in the smallest currency unit** (cents), matching the frontend (`36300` = 363.00). Never use floats for money.
- **The server always calculates prices and totals** from the database. Never trust a price, subtotal, discount amount, or total sent by the client.
- Reject unknown slugs, quantities below 1 or above a sensible maximum, and empty carts with a 400.
- Discount codes are case-insensitive. A discount can never exceed the subtotal.
- **Buy one, get one 50% off** (`products.second_unit_half_off`; no admin switch: the `EnableNeckPillowDeal` migration turns it on for `neck-pillow-2-0`): every second unit of that product costs half. `calculateDealDiscount` = `floor(qty / 2) × floor(price / 2)`; the line total is `price × qty − dealDiscount` (2 units = 1.5× price). The storefront cart uses the same formula for display. Discount codes apply to the subtotal after the deal. In Stripe the line is split into the full-price units and a `"<name> (2nd at 50% off)"` line, so `amount_total` still equals the order total.
- Shipping is a single free "Standard Shipping" option (price 0) until I say otherwise.
- Keep pricing logic in pure functions (`orders/pricing.ts`) so it is easy to unit test.

# 6. Stripe Rules

## 6.1 Read the official docs first (mandatory)

Before writing or changing any Stripe code, **read the relevant official Stripe documentation** and follow it. Stripe's API changes over time, so do not rely on memory. **This is especially important for webhooks.** Do not write webhook code without first reading:

- Webhooks overview: https://docs.stripe.com/webhooks
- Verifying signatures: https://docs.stripe.com/webhooks#verify-events
- Webhook best practices (duplicate events, event ordering, quick 2xx responses): https://docs.stripe.com/webhooks#best-practices
- Testing webhooks locally with the Stripe CLI: https://docs.stripe.com/webhooks#test-webhook
- Checkout quickstart (hosted page): https://docs.stripe.com/checkout/quickstart
- Checkout fulfillment (webhook events, `payment_status`, idempotency): https://docs.stripe.com/checkout/fulfillment
- Create a Checkout Session: https://docs.stripe.com/api/checkout/sessions/create
- Checkout Session object: https://docs.stripe.com/api/checkout/sessions/object
- Coupons (discounts in Checkout): https://docs.stripe.com/api/coupons/create and https://docs.stripe.com/payments/checkout/discounts
- Stripe Node SDK: https://github.com/stripe/stripe-node

When you implement Stripe code, say which doc pages you followed.

## 6.2 Rules

- Return a 2xx response to Stripe quickly. Do only the order status update in the webhook, not slow work.
- Only handle the event types we need, and ignore all others with a 2xx response.
- Use **Stripe hosted Checkout**: the backend creates a Checkout Session and returns its `url`; the frontend redirects there. The frontend needs no Stripe package and no publishable key.
- **Card details never touch this server.** Never accept, log, or store card numbers, CVC, or expiry.
- Create the Checkout Session from the saved order only: one `price_data` line per order item (server prices), the discount as a one-time coupon (`amount_off = discountAmount`, `max_redemptions: 1`), `customer_email`, `client_reference_id` and `metadata.orderId`, `payment_intent_data.receipt_email` and `payment_intent_data.metadata.orderId`, `expires_at` = 30 minutes. The session's `amount_total` must equal the order total.
- `success_url` = `${FRONTEND_URL}/order-confirmation/<orderId>`, `cancel_url` = `${FRONTEND_URL}/checkout`.
- An order becomes `paid` **only** from the webhook (`checkout.session.completed` with `payment_status = 'paid'`, or `checkout.session.async_payment_succeeded`), never from the success page or a frontend request. The session amount and currency must match the order.
- Verify every webhook signature with `STRIPE_WEBHOOK_SECRET` using the **raw request body** (`NestFactory.create(AppModule, { rawBody: true })`).
- Webhook handling must be **idempotent**: receiving the same event twice must not break anything or double-update.
- `checkout.session.async_payment_failed` and `checkout.session.expired` mark a `pending` order `failed`. A `paid` order is never changed by a later event (events can arrive out of order).
- Never hardcode Stripe keys. Use test keys (`sk_test_...`) in development.

## 6.3 Local currencies (Stripe Adaptive Pricing)

Docs: https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing and the `presentment_details` field of https://docs.stripe.com/api/checkout/sessions/object

- **One price currency.** Products, orders, totals, discounts and reports are all in `CURRENCY` (usd). Never store a price per currency and never sum different currencies.
- Customers pay in their own currency through **Adaptive Pricing**, switched on in the Stripe Dashboard (test and live mode separately), not in code. Sessions are still created in `CURRENCY`; Stripe converts on its page (rate guaranteed 24 h, customer pays the 2–4 % conversion fee, refunds go back at the original rate).
- Stripe keeps the session's `amount_total` / `currency` in `CURRENCY`, so the webhook amount check is unchanged. The customer's amount is in `presentment_details` (`presentment_amount`, `presentment_currency`), saved on the order with the paid status (`presentment_amount`, `presentment_currency`) **for display only** (confirmation page, email, admin). Never use it for pricing, checks or reports. Missing, malformed or same-currency details are stored as null.
- Presentment amounts use that currency's smallest unit (zero-decimal and three-decimal lists in `order-confirmation.email.ts`, storefront `formatPrice.js`, admin `format.js`).
- The storefront shows converted prices (no `≈` sign) from its own rate API; the cart and checkout notes say they are estimates and that Stripe's page shows the final amount.
- Admin prices are entered in USD; the forms warn above $5,000 (a local amount typed by mistake).
- Test locally with a `+location_XX` customer email (e.g. `test+location_PK@example.com`).
- Fixed prices per currency (Stripe manual currency prices) are out of scope unless I ask: they need per-currency prices, Price objects and multi-currency reports.

# 7. Data Model

Keep it minimal. The backend stores only what checkout and payment need.

- **Product:** id, slug (unique, never changes after creation), name, price, compareAtPrice (nullable, must be greater than price), description (nullable), badge (nullable), secondUnitHalfOff (boolean, default false: "buy one, get one 50% off"), active, createdAt, updatedAt.
- **ProductImage:** id, productId (FK, cascade), storageKey (unique; never returned), contentType (jpeg/png/webp), isMain (one per product), position, createdAt. No URL column: URLs are `STORAGE_PUBLIC_URL + '/' + storageKey`.
- **ShopHero:** exactly one row (`id = 1`, `CHK_shop_hero_single_row`): eyebrow, title, imageStorageKey + imageContentType (nullable, set and cleared together; never returned), imageAlt (nullable, falls back to title), updatedAt. Seeded by the `CreateShopHero` migration with the current storefront text and no image.
- **FeaturedCard:** exactly two rows (`slot` 1 and 2, `CHK_featured_cards_slot`): productId (nullable FK to products, `ON DELETE SET NULL`, unique so one product can't fill both cards). Both cards always show: the API can't set it to null; it is only null if the product was removed from the database, until the admin picks another one, imagePosition (`left` | `right`), promo (nullable, ≤ 30), updatedAt. A card only chooses a product and how to show it; name, prices, description, badge and image always come from that product. Seeded by the `CreateFeaturedCards` migration with the two cards the Shop page showed before.
- **DiscountCode:** code (unique, uppercase), type (`percent` | `fixed`), value, active.
- **Order:** id (UUID, used in URLs), orderNumber (short, from 1001, for display and emails), email, delivery fields (firstName, lastName, address, apartment, city, postalCode, country, phone), subtotal, discountCode, discountAmount, shipping, total, currency, presentmentAmount + presentmentCurrency (nullable, set together by the webhook with `paid`; what the customer paid in their own currency, display only, `CHK_orders_presentment`), status (`pending` | `paid` | `failed`), stripeCheckoutSessionId (unique, nullable; set when the Checkout Session is created), stripePaymentIntentId (unique, nullable; set when the order is paid), shippedAt (nullable; set once by the admin's Mark as shipped; null = unfulfilled), shippingEmailSentAt (nullable; last successful "on its way" email), createdAt, updatedAt. A database check enforces `total = subtotal - discount_amount + shipping`.
- **OrderItem:** orderId, slug, name, unitPrice, quantity, dealDiscount (what "buy one, get one 50% off" took off; 0 if none), lineTotal (copied at order time so later price changes do not alter past orders; `CHK_order_items_line_total`: `line_total = unit_price × quantity − deal_discount`). No image column.

**Display content is split.** The backend owns what the admin manages: `description`, `badge`, product images (`product_images` table), the Shop page hero (`shop_hero` table) and the two featured product cards with their `promo` and image side (`featured_cards` table). The frontend keeps the rest in `src/data/dummyData.js` (and uses its old `promo`/`featured`/`imagePosition` values only as a fallback when the backend can't be reached), matched by `slug`, and falls back to its own `image`/`alt`/`description`/`badge` while the backend value is null. Do not add other display fields to backend tables without my permission. The frontend fetches `GET /products` for name and prices and merges them by slug, so the price shown always equals the price charged.

Public API responses expose only `slug`, `name`, `price`, `compareAtPrice`, `description`, `badge`, `images` (`url`, `isMain`). Internal fields (`id`, `active`, timestamps) are never returned.

Use UUIDs for order IDs so they cannot be guessed from the confirmation page URL.

## 7.1 TypeORM rules

Docs: https://docs.nestjs.com/techniques/database and https://typeorm.io/

- **One database connection for the whole app.** `TypeOrmModule.forRootAsync()` is called exactly once, in `DatabaseModule`, which only `AppModule` imports. It creates a single shared `DataSource` (with one connection pool) that Nest closes on shutdown.
- Feature modules use `TypeOrmModule.forFeature([...])` only. Never call `forRoot`/`forRootAsync` elsewhere, and never create `new DataSource()` in application code. The migration CLI's `data-source.ts` is the only exception, and it must reuse `buildDataSourceOptions()`.
- Configure TypeORM using the injected `ConfigService`. Never hardcode connection details.
- **`synchronize` must always be `false`.** Schema changes go through migrations only, and I run them.
- One entity class per table, in the owning module's `entities/` folder.
- Store money columns as `integer` (cents). Never `float`, `decimal`, or `money`.
- Inject repositories with `@InjectRepository(Entity)` in services. Controllers never touch repositories.
- Creating an order and its items must happen in a single transaction (`DataSource.transaction()`), so a failure never leaves half an order.
- Use `uuid` primary keys for orders (`@PrimaryGeneratedColumn('uuid')`). UUIDs come from PostgreSQL's built-in `gen_random_uuid()` (PostgreSQL 13+); `installExtensions` is `false`, so the app never runs `CREATE EXTENSION`.
- Order items have no foreign key to products; they copy slug, name, and price at order time.

- Use explicit constraint names (`PK_products`, `UQ_products_slug`, `CHK_...`) in entities, and the same names in migrations.
- Use snake_case column names in the database (`compare_at_price`) via `@Column({ name })`; camelCase in TypeScript.

Seed data is inserted by a migration (e.g. `SeedProducts`), not a separate script, and must match `src/data/dummyData.js` in the frontend (products and the `WELCOME10` / `SAVE500` discount codes). Seed inserts use `ON CONFLICT DO NOTHING` so they are safe to run.

# 8. NestJS Development Standards

Official documentation: https://docs.nestjs.com/

Follow official NestJS best practices. Before using a NestJS feature you are unsure about, read its page in the official docs and follow it rather than guessing.

## 8.1 Module, controller, and service responsibilities

Every feature is its own module, and each module follows the same layout:

- **Module (`*.module.ts`):** wires the feature together. Declares its controllers and providers, imports what it needs, and exports only what other modules must use.
- **Controller (`*.controller.ts`):** the module's routes. Each module has its own controller; never put another module's routes in it. Controllers only handle HTTP: read params/body (already validated by pipes), call the service, and return the result. No business logic, no database calls, no Stripe calls.
- **Service (`*.service.ts`):** all business logic, database access (via injected TypeORM repositories), and external API calls (via `PaymentsService`).
- **DTOs (`dto/*.dto.ts`):** one class per request shape, validated with `class-validator`.

Modules talk to each other only through exported services, never by importing another module's internal files.

## 8.2 Dependency injection

Docs: https://docs.nestjs.com/providers and https://docs.nestjs.com/fundamentals/custom-providers

- Always use constructor injection (`constructor(private readonly ordersService: OrdersService) {}`).
- Never create services, repositories, a `DataSource`, or the Stripe client with `new` inside another class.
- Provide the Stripe client once as a custom provider (e.g. `useFactory` reading `STRIPE_SECRET_KEY` from `ConfigService`) and inject it where needed.
- Read configuration through the injected `ConfigService`, not `process.env`, except in `main.ts`.
- Keep providers at the default singleton scope unless there is a clear reason not to.

## 8.3 Request lifecycle

Docs: https://docs.nestjs.com/faq/request-lifecycle

Every request passes through these layers in this order. Put each concern in the correct layer:

1. **Middleware** — https://docs.nestjs.com/middleware
   Runs before routing. Use for raw request concerns such as request logging. Not for auth or validation.
   - Middleware for **every** route that needs no DI: a plain function registered with `app.use()` in `main.ts` (e.g. `requestLogger`).
   - Middleware that needs DI, or only some routes: a class implementing `NestMiddleware`, applied with `MiddlewareConsumer` in the module's `configure()`. In Nest 11 use named wildcards (`'{*path}'`), not a bare `'*'`.
   - Never log request bodies, headers or query strings (customer data such as `?email=`, Stripe signatures, secrets). `requestLogger` logs the path only.
2. **Guards** — https://docs.nestjs.com/guards
   Decide whether a request may continue (`canActivate`). Use for access checks. Not for transforming data.
   - Rate limiting: `ThrottlerModule.forRoot()` is registered once in `AppModule`; `ThrottlerGuard` + `@Throttle()` are applied **per route** only (`POST /orders`, `POST /discounts/validate`, `POST /admin/login`), never globally. Limits live in `orders.constants.ts` and `admin.constants.ts`.
   - Admin access: `AdminGuard` is applied with `@UseGuards(AdminGuard)` on each admin controller (on the route for `GET /admin/me`), never globally, so public routes are unaffected.
3. **Interceptors (before)** — https://docs.nestjs.com/interceptors
   Wrap the handler. Use for cross-cutting concerns such as timing/logging or consistent response mapping.
4. **Pipes** — https://docs.nestjs.com/pipes
   Validate and transform input. Use the global `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`, and built-in pipes such as `ParseUUIDPipe` for route params.
5. **Controller** → **Service** — the route handler calls the service, where the logic lives.
6. **Interceptors (after)** — map or log the response on the way out.
7. **Exception filters** — https://docs.nestjs.com/exception-filters
   Turn thrown errors into HTTP responses. Throw built-in exceptions (`NotFoundException`, `BadRequestException`, etc.) from services. Add a custom filter only if a consistent error format is needed. Never leak stack traces, internal errors, or secrets to the client.

Rules:

- Use each layer **only when it is actually needed**. Do not add empty or placeholder middleware, guards, or interceptors.
- Scope each one as narrowly as possible: route level → controller level → global, in that order of preference.
- Register global pipes, filters, and interceptors that need DI through the module system (`APP_PIPE`, `APP_FILTER`, `APP_INTERCEPTOR`) rather than `app.useGlobal*()`.

## 8.4 Lifecycle hooks

Docs: https://docs.nestjs.com/fundamentals/lifecycle-events

Use lifecycle hooks when a provider has setup or cleanup work, instead of doing it in constructors:

- `OnModuleInit` — startup work that a provider needs (e.g. checking that required data or configuration is present).
- `OnModuleDestroy` / `OnApplicationShutdown` — release resources at shutdown. `TypeOrmModule` already opens and closes the database connection itself; do not manage it manually.
- Call `app.enableShutdownHooks()` in `main.ts` so shutdown hooks run when the process stops.
- Constructors only assign injected dependencies; no async work or side effects.

## 8.5 General

- Use built-in Nest exceptions for errors.
- Use meaningful names. Avoid duplicated code and unnecessary abstractions.
- Prefer NestJS built-in features over writing custom equivalents.

# 9. Configuration

Use `@nestjs/config`. All configuration comes from environment variables.

Required variables:

```
NODE_ENV=development | production
PORT=3000
FRONTEND_URL=
DB_HOST=
DB_PORT=5432
DB_USERNAME=
DB_PASSWORD=
DB_NAME=
DB_SSL=false | true
DB_CA_CERT=             # PEM CA of the database (DigitalOcean); only with DB_SSL=true; "\n" on one line is accepted
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
CURRENCY=usd
TRUST_PROXY_HOPS=0 | 1
ADMIN_URL=              # admin app origin, no trailing slash (CORS)
ADMIN_EMAIL=
ADMIN_PASSWORD_HASH=    # bcrypt hash, never the plain password
JWT_SECRET=             # at least 32 characters
BREVO_API_KEY=          # Brevo API key (xkeysib-...)
EMAIL_FROM=             # sender verified in Brevo, e.g. orders@callixe.co
EMAIL_FROM_NAME=        # e.g. Callixe (max 70 characters)
EMAIL_REPLY_TO=         # optional; blank = replies go to EMAIL_FROM
ORDER_NOTIFY_EMAIL=     # optional; store owner's inbox, gets a BCC of every order confirmation
STORAGE_DRIVER=local | spaces
STORAGE_PUBLIC_URL=     # local: http://localhost:3000/uploads; spaces: the CDN URL. No trailing slash
SPACES_ENDPOINT=        # only when STORAGE_DRIVER=spaces
SPACES_REGION=
SPACES_BUCKET=
SPACES_KEY=
SPACES_SECRET=
```

Image storage: `local` writes to `./uploads` (git-ignored) and `main.ts` serves it at `/uploads` (read-only, no listing, `nosniff`). Production uses `local` too: the API runs on a DigitalOcean Droplet whose disk is permanent, so images live in `/home/callixe/callixe_backend/uploads` and survive restarts, `git pull` and rebuilds. Never run `git clean -x` there (it deletes ignored files, including `uploads/`). `local` must not be used on hosts with a wiped disk (e.g. App Platform). `spaces` uses DigitalOcean Spaces (public-read objects, private bucket). Switching is an env change only.

`FRONTEND_URL` and `ADMIN_URL` must be bare origins (`http://localhost:5173`): `validateEnv` rejects a trailing slash or path, because the browser's `Origin` header would never match it.

`TRUST_PROXY_HOPS` is the number of proxies in front of the app: `0` locally, `1` on DigitalOcean to start. After deploying, check the IP in the request log is the customer's real IP, not the proxy's; adjust if needed. Never use `trust proxy = true` (clients could fake their IP and bypass rate limits).

Env files:

- `.env.development` — local development, Stripe **test** keys. Loaded when `NODE_ENV=development` (the default).
- `.env.production` — live server, Stripe **live** keys. Loaded when `NODE_ENV=production`.
- `.env.example` — variable names only, no real values. The **only** env file committed to git.
- Load the file with `ConfigModule.forRoot({ envFilePath: `.env.${process.env.NODE_ENV ?? 'development'}` })`. Variables already set in the real environment (e.g. on the hosting platform) take priority over the file.
- When adding a variable, add it to all three files and to `env.validation.ts`.
- Never commit `.env.development` or `.env.production`.

How the environment is selected:

- `NODE_ENV` must come from **outside** the app (shell, npm script, or hosting platform). The app reads it first to decide which file to load, so `NODE_ENV` written inside an env file cannot select that file.
- Not set → `development`. Jest sets `test`.
- Production runs on **DigitalOcean**: set every variable, including `NODE_ENV=production`, in the app's environment settings. No env file is uploaded, and `npm run start:prod` / `migration:run:prod` rely on that platform `NODE_ENV`.
- `validateEnv` refuses to start if `NODE_ENV=production` uses a Stripe test key, or any other environment uses a live key.

Migrations (I run these; never run them without my instruction):

- Claude writes migration files by hand to match the entities, so I only run **one command**:
  - Development: `npm run migration:run`
  - Production: `npm run build` then `npm run migration:run:prod` (uses compiled `dist/`)
- Undo the last migration: `npm run migration:revert`. Check status: `npm run migration:show`.
- Migration file names start with a 13-digit timestamp, and each new one is later than the last.

Other configuration rules:

- Enable CORS only for `FRONTEND_URL` and `ADMIN_URL` (never `*`).
- Validate required variables on startup so the app fails fast if one is missing.

# 10. Testing

Every module ships with **unit tests** only. A feature is not done until its tests pass. No e2e tests and no test database.

- Never run tests yourself. Give me the command (e.g. `npm run test -- products`) and I run it.
- **Unit tests** (`*.spec.ts`, next to the file they test): services, controllers, DTO validation, pricing functions, discount rules, order creation logic, webhook event handling. Mock TypeORM repositories (`getRepositoryToken(Entity)`) and Stripe.
- **Webhook unit tests:** invalid signature rejected, duplicate events are safe, success marks the order `paid`, failure does not.
- **Manual Stripe testing** with the Stripe CLI (`stripe listen --forward-to localhost:3000/payments/webhook`) and test cards:
  - `4242 4242 4242 4242` — success
  - `4000 0000 0000 0002` — declined
  - `4000 0025 0000 3155` — requires 3D Secure

Never call the real Stripe API from automated tests.

`@nestjs/config`, `@nestjs/jwt` and `@nestjs/typeorm` 12 are ESM-only. On Node below 24.9, Jest loads them through `ts-jest` (`transformIgnorePatterns` and the `.js` transform in `package.json`); add any new ESM-only package to that pattern. `setupFiles: ["reflect-metadata"]` loads it for every test, as Nest does at startup (class-transformer's `@Type()` needs it). `@nestjs/typeorm`'s `typeorm-compat.js` uses `import.meta`, which cannot be converted, so `moduleNameMapper` swaps in the CommonJS copy at `test/jest-shims/typeorm-compat.js` (tests only). Keep all three when editing Jest settings; on Node 24.9+ they can be removed.

# 11. Code Style

- Follow the existing `.prettierrc` (single quotes, trailing commas) and `eslint.config.mjs`.
- Keep files small and focused.
- Comments explain *why*, not *what*.

# 12. Security Checklist

- Server-side price calculation (section 5).
- Webhook signature verification (section 6).
- DTO validation with whitelisting on every input.
- CORS restricted to the storefront and admin origins.
- Every admin route except login behind `AdminGuard`; login rate limited.
- No secrets in code, logs, or responses.
- No card data stored or logged anywhere.

# 13. Local Startup (after a laptop restart)

I run these myself. Order matters: **PostgreSQL → backend → ngrok → frontend**.

1. **PostgreSQL** — usually starts automatically on Windows. Check with `Get-Service postgresql*`; if `Stopped`, run `Start-Service <service-name>` in an Administrator PowerShell.
2. **Backend (terminal 1)** — `cd D:\Backend\callixe_backend` then `npm run start:dev`. Wait for `Nest application successfully started` (http://localhost:3000).
3. **ngrok (terminal 2, only when testing Stripe)** — `ngrok http 3000 --url https://unkeyed-gracie-nimbly.ngrok-free.dev`. Check `Session Status: online` and keep the terminal open. Requests are visible at http://127.0.0.1:4040.
4. **Frontend (terminal 3, when needed)** — `cd D:\react\e-commerce-store` then `npm run dev`.

Quick check: open http://localhost:3000/products — a product list means backend and database are working.

Not needed again after a restart:

- Installing ngrok or adding its authtoken (saved permanently).
- Changing the Stripe webhook URL (the ngrok domain is static): `https://unkeyed-gracie-nimbly.ngrok-free.dev/payments/webhook`.
- `npm install` (only when `package.json` changes).
- `npm run migration:run` (only when a new migration file is added).

If the backend is down while ngrok is running, Stripe receives `502` and retries later; nothing is lost.

# 14. Stripe Webhook Destination (test mode)

Configured in the Stripe Dashboard (Test mode → Workbench → Webhooks → destination):

- **Purpose:** local testing only (ngrok tunnel → `http://localhost:3000`). Never used for real customers.
- **Destination type:** Webhook endpoint
- **Endpoint URL (testing):** `https://unkeyed-gracie-nimbly.ngrok-free.dev/payments/webhook`
  - `https://unkeyed-gracie-nimbly.ngrok-free.dev` → the static ngrok domain (section 13)
  - `/payments/webhook` → `PaymentsController` webhook route (section 4). No global prefix in `main.ts`, so the path is exactly this.
- **Events from:** Your account (not Connected accounts; this store does not use Stripe Connect)
- **Payload style:** Snapshot (the event carries the full Checkout Session: `id`, `payment_status`, `amount_total`, `currency`, `payment_intent`)
- **Signing secret:** `whsec_...` from this destination → `STRIPE_WEBHOOK_SECRET` in `.env.development`

Subscribed events and how the backend handles them:

| Event | Covers | Backend action now |
|---|---|---|
| `checkout.session.completed` | Customer finished Checkout | `payment_status = 'paid'` → order `paid`; `unpaid` (delayed method) → wait |
| `checkout.session.async_payment_succeeded` | Delayed payment succeeded | Order → `paid` |
| `checkout.session.async_payment_failed` | Delayed payment failed | `pending` order → `failed` |
| `checkout.session.expired` | Customer left; session expired (30 min) | `pending` order → `failed` |
| `charge.refunded` | A payment was refunded | Ignored for now (200) |
| `charge.dispute.created` | Customer filed a chargeback | Ignored for now (200) |

Card declines (e.g. `4000 0000 0000 0002`) are shown on the Stripe page and the customer can retry; no event changes the order until the session completes or expires.

Rules:

- Only the four `checkout.session.*` events change data. All other events return 200 and do nothing (section 6.2). Orders are matched by `stripe_checkout_session_id`; an unknown session is logged and answered with 200.
- Handling refunds, cancellations, or disputes needs a new order status and a migration; do not add these without my instruction.
- `invoice.*` events are not used (no Stripe Invoicing or subscriptions); the customer's receipt is Stripe's `receipt_email`.
- Production uses a separate **Live mode** destination with the real domain, the same events, and its own `whsec_`, set in the DigitalOcean environment settings.
