# Stripe Elements Checkout (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the storefront show Stripe's card fields inside its own checkout page instead of redirecting to `checkout.stripe.com`.

**Architecture:** Keep Checkout Sessions, the saved-order flow, the coupon and the webhook exactly as they are. Only the session's UI mode changes: `ui_mode: 'elements'`. `POST /orders` returns the session's `clientSecret` instead of `checkoutUrl`. The frontend mounts the Payment Element and the Currency Selector Element with it and calls `checkout.confirm()`. The order still becomes `paid` only from the webhook.

**Tech Stack:** NestJS 11, stripe-node `^23.1.0` (already installed; its types include `ui_mode: 'elements'`, `client_secret`, `return_url`, `adaptive_pricing`), Jest.

**Spec:** CLAUDE.md sections 4, 5, 6, 8, 10, 12 plus the Stripe docs below. User decisions: Stripe account is **US**; **no Express Checkout buttons** (no Apple Pay / Google Pay / Link buttons at the top); card form + currency selector only.

**Stripe docs followed:**
- Options: https://docs.stripe.com/payments/online-payments ("Elements: Use Stripe Elements with the Checkout Sessions API to design a custom page")
- Quickstart: https://docs.stripe.com/checkout/custom/quickstart
- Create session: https://docs.stripe.com/api/checkout/sessions/create. `return_url` "is required if `ui_mode` is `embedded_page` or `elements` and redirect-based payment methods are enabled". `success_url` / `cancel_url` are "not allowed if ui_mode is `embedded_page` or `elements`". `expires_at`, `customer_email` and `discounts` have no `ui_mode` restriction.
- Session object: https://docs.stripe.com/api/checkout/sessions/object. `client_secret` "Applies to Checkout Sessions with `ui_mode: embedded_page` or `ui_mode: elements`". `url` applies to `hosted_page` only.
- Fulfillment: https://docs.stripe.com/checkout/fulfillment?ui=elements. `checkout.session.completed` and `checkout.session.async_payment_succeeded`, fulfil once.
- Adaptive Pricing with Elements: https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing?payment-ui=embedded-components. Client `adaptivePricing: { allowed: true }` plus the Currency Selector Element are required. Server `adaptive_pricing.enabled` "Defaults to your dashboard setting" (stripe-node type docs).

## Global Constraints

- Amounts only from the saved order; integers in cents; the `amount_total === order.total` check stays (CLAUDE.md §5, §6.2).
- Card data never touches this server; the client secret is only returned by `POST /orders` and is **never logged** and never returned by `GET /orders/:id` or admin routes.
- An order becomes `paid` only from the webhook. No new "session status" endpoint: the confirmation page keeps polling `GET /orders/:id` (CLAUDE.md §6.2).
- `return_url` = `${FRONTEND_URL}/order-confirmation/<orderId>` (same page as today's `success_url`). No `cancel_url` (not allowed; the customer is already on our page).
- `expires_at` stays 30 minutes; `checkout.session.expired` still marks the order `failed`.
- Adaptive Pricing stays controlled by the Stripe Dashboard switch (no `adaptive_pricing` param), as CLAUDE.md §6.3 already says.
- No new packages, env variables, migrations, modules or endpoints on the backend.
- I (Claude) never run tests, builds or git commands; each "Run" step is a command the user runs.

## Review Focus

1. **The client secret leaks into logs or other responses.** Expect: only `POST /orders` returns it, and the `Checkout session … created` log line has no secret. Covered by Task 1 (log assertion) and Task 2 (controller response keys).
2. **Stripe returns a session without `client_secret`.** Expect: treated like a failed session, so the order is marked `failed` and the customer gets 503. Covered by Task 1 (throws) plus the existing OrdersService failure test.
3. **A discount code with Elements.** Expect: the one-time coupon is still attached and `amount_total` equals the discounted total. Covered by Task 1 (keeps the existing coupon test, now with the elements params).
4. **The customer leaves after the order is created.** Expect: the session expires after 30 min and the order becomes `failed`. Unchanged code; the existing webhook tests cover it.
5. **The old frontend runs against the new backend** (it reads `checkoutUrl`, now missing). Expect: backend and frontend are deployed together. Handled in Task 3 (deploy note), because no test can catch it.

---

### Task 1: Create Elements-mode Checkout Sessions

**Files:**
- Modify: `src/payments/payments.service.ts:36-39` (`CheckoutSessionResult`), `:57-65` (doc comment), `:76-124` (`createCheckoutSession`)
- Test: `src/payments/payments.service.spec.ts` (`describe('createCheckoutSession')`)

**Interfaces:**
- Produces: `interface CheckoutSessionResult { id: string; clientSecret: string }` and `createCheckoutSession(order: CheckoutOrder): Promise<CheckoutSessionResult>` (same name and parameter).

- [ ] **Step 1: Update the failing tests**
  - `resolves { id, clientSecret }`: the mock session returns `{ id: 'cs_test_1', client_secret: 'cs_test_1_secret_abc', amount_total: order.total, url: null }` → `toEqual({ id: 'cs_test_1', clientSecret: 'cs_test_1_secret_abc' })`.
  - `creates an elements session with return_url`: the `sessions.create` params `toMatchObject({ mode: 'payment', ui_mode: 'elements', return_url: 'http://localhost:5173/order-confirmation/<order.id>', customer_email, client_reference_id, metadata: { orderId }, payment_intent_data: { receipt_email, metadata: { orderId } } })`, and `expect(params).not.toHaveProperty('success_url')` and `not.toHaveProperty('cancel_url')`.
  - The existing coupon and BOGO line-item tests stay; update their mock session to include `client_secret`.
  - `throws when Stripe returns no client_secret`: `client_secret: null` → rejects with `InternalServerErrorException`.
  - The existing amount-mismatch test stays.
  - `never logs the client secret`: spy on `Logger.prototype.log` and check that no call argument contains `'secret'`.

- [ ] **Step 2: Run to see them fail.** Run: `npm run test -- payments.service`. Expected: FAIL on `ui_mode` / `clientSecret`.

- [ ] **Step 3: Implement.**
  - In the params, replace `success_url` + `cancel_url` with `ui_mode: 'elements'` and `return_url: \`${frontendUrl}/order-confirmation/${order.id}\``. Everything else is unchanged.
  - The guard becomes `session.amount_total !== order.total || !session.client_secret` (same exception).
  - Return `{ id: session.id, clientSecret: session.client_secret }`.
  - Update the docs-followed comment: add the custom quickstart, fulfillment `?ui=elements` and the Adaptive Pricing Elements variant; say the frontend must render the Currency Selector Element.

- [ ] **Step 4: Run.** Run: `npm run test -- payments`. Expected: PASS (the webhook tests are untouched).

### Task 2: Return `clientSecret` from `POST /orders`

**Files:**
- Modify: `src/orders/orders.service.ts:49-64` (`create` returns `{ order: Order; clientSecret: string }`)
- Modify: `src/orders/dto/order-response.dto.ts:4-19` (`CreateOrderResponseDto`: `checkoutUrl` → `clientSecret`; comment: "the frontend mounts Stripe Elements with `clientSecret`")
- Modify: `src/orders/orders.controller.ts:31-32`
- Test: `src/orders/orders.service.spec.ts`, `src/orders/orders.controller.spec.ts`

**Interfaces:**
- Consumes: `CheckoutSessionResult { id, clientSecret }` from Task 1.
- Produces: `POST /orders` → `{ orderId, orderNumber, total, clientSecret }`.

- [ ] **Step 1: Update the failing tests**
  - Service: the mock `createCheckoutSession` resolves `{ id: 'cs_test_1', clientSecret: 'cs_test_1_secret_abc' }`; `expect(result.clientSecret).toBe('cs_test_1_secret_abc')`; `stripeCheckoutSessionId` is still saved as `'cs_test_1'`. The existing "session fails → order failed + 503" test is unchanged.
  - Controller: rename the test to `POST /orders returns orderId, orderNumber, total, and clientSecret only`. Expect exactly those four keys (`Object.keys(body).sort()`), with no `checkoutUrl` and no `stripeCheckoutSessionId`.
  - Controller: `GET /orders/:id` response has no `clientSecret` key.

- [ ] **Step 2: Run to see them fail.** Run: `npm run test -- orders`. Expected: FAIL on `clientSecret`.

- [ ] **Step 3: Implement** the renames above. There is no new logic: `create` returns `{ order, clientSecret: session.clientSecret }`.

- [ ] **Step 4: Run all unit tests.** Run: `npm run test`. Expected: all PASS. Then `npm run lint` and `npm run build`: no errors.

### Task 3: Update project docs

**Files:**
- Modify: `CLAUDE.md`
  - §4 API table: `POST /orders` returns `{ orderId, orderNumber, total, clientSecret }`; the frontend mounts Stripe Elements (Payment Element + Currency Selector Element) with it.
  - §6.1 doc list: add the custom quickstart, fulfillment `?ui=elements` and the Adaptive Pricing Elements variant.
  - §6.2: replace "Use Stripe hosted Checkout … needs no Stripe package and no publishable key" with: Elements with the Checkout Sessions API (`ui_mode: 'elements'`); the frontend uses `@stripe/stripe-js` + `@stripe/react-stripe-js` and a publishable key; no Express Checkout buttons. Replace the `success_url`/`cancel_url` rule with `return_url` = `${FRONTEND_URL}/order-confirmation/<orderId>`. Add that the client secret is never logged and only returned by `POST /orders`.
  - §6.3: Adaptive Pricing with Elements also needs `adaptivePricing: { allowed: true }` and the Currency Selector Element on the frontend; the Dashboard switch still turns it on.
- Modify: `docs/server.md`: deploy note that **backend and storefront must be deployed together** (the old storefront reads `checkoutUrl`).

- [ ] **Step 1:** Make the edits above. No code, no tests.

### Task 4: Manual Stripe test (after the storefront part is built)

- [ ] Run `npm run start:dev` and the ngrok tunnel (CLAUDE.md §13). Place orders from the new checkout page with:
  - `4242 4242 4242 4242`: the order becomes `paid` and the confirmation email arrives.
  - `4000 0000 0000 0002`: an error is shown on our page, the order stays `pending`, and a retry with 4242 works.
  - `4000 0025 0000 3155`: 3D Secure completes and the customer lands on `/order-confirmation/<orderId>`.
  - `WELCOME10`: the Stripe Dashboard payment amount equals the order total.
  - Email `test+location_PK@example.com`: the currency selector offers PKR, and `presentment` is saved on the order.
  - Leaving the page: the order becomes `failed` after 30 min (`checkout.session.expired`).

## Not in this plan
- The storefront changes (separate plan): a publishable key env (`VITE_STRIPE_PUBLISHABLE_KEY`), the two packages, the "Continue to payment → POST /orders → mount Elements → Pay" flow, and a new order when the customer edits details after the order is created.
- Express Checkout buttons, saved cards, the `ContactDetailsElement` (email is already passed as `customer_email`).
