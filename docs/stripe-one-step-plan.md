# One-step Checkout (card form on first load) — Backend Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The checkout page shows Stripe's real card form as soon as it opens, with one "Complete Purchase" button (same as the reference), instead of "Continue to payment" first.

**Architecture:** Split today's `POST /orders` into two calls.
1. **Page opens** → `POST /orders/payment-session` `{ items, discountCode? }`: the server prices the cart (same rules as today) and creates a Stripe Checkout Session (`ui_mode: 'elements'`, card only, coupon if any). **No order row yet.** It returns `{ sessionId, clientSecret, total }`; the storefront mounts the card form with it.
2. **Complete Purchase** → `POST /orders` `{ email, delivery, items, discountCode?, paymentSessionId }`: the server re-prices the cart, retrieves the session from Stripe, checks it is `open`, unused, and that its `amount_total` / `currency` equal the new order's total, then saves the order **with `stripe_checkout_session_id` already set** (one transaction), and puts `orderId` in the session's metadata. Returns `{ orderId, orderNumber, total }`. The browser then calls `checkout.confirm({ email, billingAddress, returnUrl: '/order-confirmation/<orderId>' })`.

The webhook is unchanged: it already finds the order by `stripe_checkout_session_id`, checks amount and currency, and treats an unknown session (opened, never ordered, expired) as "log and 200".

**Tech Stack:** NestJS 11, stripe-node ^23.1.0 (installed types checked: `sessions.update` accepts `metadata` and `payment_intent_data.metadata` for `elements` sessions; `payment_intent_data.receipt_email` is **not** updatable), TypeORM. No new packages, **no migration**.

## Decisions

- **Card only**: `excluded_payment_method_types` = every non-card type stripe-node 23 knows (this API version has no `payment_method_types` on Checkout Sessions). PayPal / Klarna / Afterpay / Cash App / Flex can never appear, whatever the Dashboard says. Card-only sessions have no redirect-based methods, so `return_url` is not set at creation; the browser passes `returnUrl` to `confirm()` once the order id exists.
- **No order until Complete Purchase**: visitors who open checkout and leave create only a Stripe session (expires in 30 min, no DB row). Fewer junk `pending` orders than today.
- **A session pays for one order only**: `UQ_orders_stripe_checkout_session_id` already enforces it → a second `POST /orders` with the same session gets **409**.
- **Price can't be swapped**: the order is saved only if the session's `amount_total` equals the re-priced order total and its currency equals `CURRENCY`; otherwise 409 "Your cart changed, please reload checkout". So a session made for a cheaper cart can't pay for a dearer one.
- **Discount change** on the page → the storefront asks for a new session (the coupon is fixed per session).
- **Email**: `customer_email` and `payment_intent_data.receipt_email` can't be set at creation (no email yet) and `receipt_email` can't be updated. The email reaches Stripe through `confirm({ email })`. Our own Brevo confirmation email is unchanged. **To verify while testing:** whether Stripe still sends its own receipt (Dashboard → Settings → Customer emails → "Successful payments"). If not, the customer gets only our confirmation email.
- `client_reference_id` is dropped (can't be set later); `metadata.orderId` and `payment_intent_data.metadata.orderId` are set by `sessions.update` after the order is saved. A failed update is logged, never fails the order (the webhook uses the session id).
- Rate limits: `POST /orders/payment-session` **20/min per IP** (each checkout visit / discount change); `POST /orders` stays 8/min.

## Global Constraints

- Prices and totals only from the database (CLAUDE.md §5); the client still sends only slugs, quantities, discount code.
- An order becomes `paid` only from the webhook (§6.2). No webhook code changes.
- The client secret is returned only by `POST /orders/payment-session`, never logged.
- I (Claude) never run tests/build/migrations; each "Run" is a command for the user.

## Review Focus

1. **Session for a different cart/total** → 409, nothing saved. Task 3.
2. **Same session used twice** (double click, retry after a decline) → second call 409; the storefront reuses the first `orderId` instead of calling again. Task 3 + storefront plan.
3. **Expired or completed session** at Complete Purchase → 409 "please reload checkout", nothing saved. Task 3.
4. **Stripe down when opening checkout** → 503, no DB row. Task 2.
5. **`sessions.update` (metadata) fails** after the order is saved → order still returned; error logged. Task 3.

---

### Task 1: Pricing without saving

**Files:** Modify `src/orders/orders.service.ts` (extract `priceCart(items, discountCode)` from `saveOrder`), test `src/orders/orders.service.spec.ts`.

**Interfaces:** Produces `priceCart(items: OrderItemDto[], discountCode?: string): Promise<PricedCart>` where `PricedCart = { lines: { slug, name, unitPrice, quantity, dealDiscount, lineTotal }[]; subtotal; discountCode: string | null; discountAmount; shipping; total; currency }`. Same 400s as today (unknown/inactive product, invalid discount). `saveOrder` uses it.

- [ ] Existing order-creation tests keep passing unchanged (pure refactor). Run `npm run test -- orders.service`.

### Task 2: `POST /orders/payment-session`

**Files:**
- Create `src/orders/dto/create-payment-session.dto.ts` (`items` + `discountCode`, reusing the item and discount rules from `CreateOrderDto`; no email/delivery).
- Modify `src/orders/orders.controller.ts` (new route, `ThrottlerGuard`, `PAYMENT_SESSION_RATE_LIMIT = 20` in `orders.constants.ts`).
- Modify `src/payments/payments.service.ts`: `createCheckoutSession(order)` becomes `createPaymentSession(cart: PaymentCart): Promise<{ id; clientSecret }>`. `PaymentCart = { currency, total, discountCode, discountAmount, items: { name, unitPrice, quantity, dealDiscount }[] }`. Params: `mode: 'payment'`, `ui_mode: 'elements'`, `payment_method_types: ['card']`, same line items + coupon, `expires_at` 30 min. **No** `customer_email`, `return_url`, `client_reference_id`, `metadata`. Same `amount_total` + `client_secret` check.
- Modify `src/orders/orders.service.ts`: `createPaymentSession(dto)` = `priceCart` → `paymentsService.createPaymentSession` (Stripe error → 503).
- Response `{ sessionId, clientSecret, total }`.
- Tests: payments spec (params as above, `payment_method_types: ['card']`, no `customer_email`/`return_url`), orders service (no DB write), controller (exact keys).

### Task 3: `POST /orders` with `paymentSessionId`

**Files:**
- Modify `src/orders/dto/create-order.dto.ts`: required `paymentSessionId` (`/^cs_(test|live)_[A-Za-z0-9]+$/`, max 255).
- Modify `src/payments/payments.service.ts`: add `getOpenSession(id): Promise<{ id; amountTotal; currency }>` (retrieve; not found / `status !== 'open'` → `ConflictException`) and `linkOrder(sessionId, orderId): Promise<void>` (`sessions.update` with `metadata` + `payment_intent_data.metadata`; never throws, logs).
- Modify `src/orders/orders.service.ts` `create(dto)`: `getOpenSession` → `priceCart` → compare total and currency (mismatch → 409) → save order + items **with `stripeCheckoutSessionId`** in one transaction (unique violation → 409) → `linkOrder` → return order. Remove the old "create session after saving / mark failed" path.
- `CreateOrderResponseDto` → `{ orderId, orderNumber, total }` (no `clientSecret`).
- Tests: total mismatch → 409, nothing saved; closed session → 409; duplicate session (unique violation `23505`) → 409; success saves `stripeCheckoutSessionId` inside the transaction and calls `linkOrder`; `linkOrder` failure still returns the order.

### Task 4: Docs

- `CLAUDE.md` §4 (both routes and shapes), §6.2 (card only, no `customer_email`/`receipt_email`/`return_url` at creation, `returnUrl` passed by `confirm()`, order created at Complete Purchase, session linked by id), §13/§14 unchanged events.
- `docs/server.md`: deploy backend + storefront together again (API shapes change).

**Run (user):** `npm run test`, `npm run lint`, `npm run build`.

## Storefront (separate plan after this is approved)

Card box on first load from `POST /orders/payment-session` (new session when the discount changes), "Complete Purchase" = native form validation → `POST /orders` (once; reused on retry) → `confirm({ email, billingAddress, returnUrl })`. No "Continue to payment", no "Edit details". The button is not gated on `canConfirm` (the email reaches Stripe only at confirm). Stripe's card fields are iframes: the "Card" label and its icons are Stripe's, so they can't be pixel-identical to Shopify's "Credit card" row.
