# Stripe Hosted Checkout (Payments Module) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /orders` returns a Stripe-hosted Checkout URL for the server-calculated total, and the Stripe webhook marks the order `paid` or `failed`.

**Architecture:** `PaymentsModule` wraps the Stripe client (one injected provider). It creates Checkout Sessions, verifies webhook signatures, and maps Stripe events to a plain `PaymentOutcome`. `OrdersService` creates the session after saving the order and applies outcomes with conditional updates, so duplicate or out-of-order events are harmless. Orders and Payments depend on each other (create session ↔ update order), so the two module imports use `forwardRef()`. No provider-level cycle exists: `OrdersService → PaymentsService` and `PaymentsController → OrdersService`.

**Tech Stack:** NestJS 11, TypeORM/PostgreSQL, `stripe` (Node SDK), Jest.

**Spec:** `CLAUDE.md` sections 4–7, 9, 14 (updated for hosted Checkout in Task 1) plus the decisions below.

## Stripe docs followed (read 2026-11-13)

- Fulfillment: https://docs.stripe.com/checkout/fulfillment. Listen for `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Check `payment_status`. Fulfillment "might be called multiple times, possibly concurrently". Never rely on the landing page.
- Webhooks: https://docs.stripe.com/webhooks. Raw body is required. Return 2xx quickly. Live-mode retries last up to 3 days. No ordering guarantee. Duplicates happen. Signature tolerance defaults to 5 min.
- Create Session: https://docs.stripe.com/api/checkout/sessions/create. `line_items[].price_data.{currency, unit_amount (integer, smallest unit), product_data.name}`, `quantity`, `customer_email`, `client_reference_id`, `metadata`, `payment_intent_data.{metadata, receipt_email}`, `discounts: [{ coupon }]`, `expires_at` (Unix seconds, 30 min–24 h).
- Session object: https://docs.stripe.com/api/checkout/sessions/object. `payment_status`: `paid | unpaid | no_payment_required`. `status`: `open | complete | expired`. `url` is only present while the session is active. `payment_intent` is a nullable string. `amount_total`.
- Coupons: https://docs.stripe.com/api/coupons/create. `amount_off` + `currency`, `duration` defaults to `once`, `max_redemptions`, `name` is shown to customers.
- Discounts in Checkout: https://docs.stripe.com/payments/checkout/discounts?ui=full-page
- stripe-node README: https://github.com/stripe/stripe-node. `import Stripe from 'stripe'; new Stripe(key)`. When `apiVersion` is omitted, the SDK uses the version current at its release. `stripe.webhooks.constructEvent(rawBody, header, secret)` needs the raw body. `generateTestHeaderString` helps in tests.

## Decisions (approved in conversation)

- Stripe **hosted Checkout** (redirect to `session.url`), not the Payment Element. The frontend needs no Stripe package and no publishable key.
- Line items use per-product `price_data` with server prices. A discount is a one-time coupon: `amount_off = order.discountAmount`, `max_redemptions: 1`, `name = order.discountCode`.
- Session `expires_at` = now + 30 minutes.
- `success_url` = `${FRONTEND_URL}/order-confirmation/${order.id}`. `cancel_url` = `${FRONTEND_URL}/checkout`.
- Keep `stripe_payment_intent_id` (filled when paid, useful for refunds). Add `stripe_checkout_session_id`.
- `checkout.session.expired` and `async_payment_failed` set the order to `failed` (only from `pending`).
- No event-ID table. Conditional updates provide idempotency.

## Global Constraints

- Money is integer cents. The Stripe amount always comes from the saved order and never from the request.
- Never log or store card data, request bodies, headers, or the `Stripe-Signature` value. Webhook logs contain only event ID, event type, session ID, order number, and result.
- Configuration comes through the injected `ConfigService` only (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FRONTEND_URL`, `CURRENCY`). No new env vars.
- The Stripe client is constructed once in a `useFactory` provider and is never `new`ed elsewhere.
- Unit tests only. Mock Stripe and repositories. Never call the real Stripe API in tests.
- The user runs every command (install, migration, tests). Claude does not commit unless asked.
- `synchronize` stays `false`. The schema changes only through the new migration.

## Review Focus

1. **The same `checkout.session.completed` delivered twice**: the second delivery changes nothing and logs "already paid". Test in Task 5.
2. **`checkout.session.expired` or `async_payment_failed` arrives after the order is paid** (out of order): the order stays `paid`. Test in Task 5.
3. **Session `amount_total` or `currency` differs from the order**: the order is not marked paid, an error is logged, and the response is 200. Test in Task 5.
4. **An event for a session that isn't ours** (`stripe trigger`, or another app on the same account): 200, a warning log, and no DB change. Test in Task 5.
5. **Missing raw body or missing `stripe-signature` header**: 400 without calling `constructEvent`. Test in Task 3.

---

### Task 1: Update CLAUDE.md for hosted Checkout

**Files:**
- Modify: `CLAUDE.md` sections 3 (payments tree comments), 4 (`POST /orders` returns `checkoutUrl`), 6 (replace PaymentIntent/Payment Element rules with Checkout Session rules from the Decisions above, and update the doc links), 7 (Order gains `stripeCheckoutSessionId`), 14 (event table with the Task 5 handling)

- [ ] **Step 1:** Rewrite the listed sections. Keep the remaining rules: raw-body signature verification, idempotency, paid only via webhook, quick 2xx, ignore other events with 2xx, never hardcode keys.
- [ ] **Step 2:** In section 14, replace the events table with: `checkout.session.completed` (paid if `payment_status === 'paid'`), `checkout.session.async_payment_succeeded` (paid), `checkout.session.async_payment_failed` (failed), `checkout.session.expired` (failed), `charge.refunded` / `charge.dispute.created` (ignored, 200).
- [ ] **Step 3 (user, Stripe Dashboard):** Edit the test destination's events to match Step 2 and remove the four `payment_intent.*` events. The URL and `whsec_` stay the same.

### Task 2: Checkout session column (migration + entity)

**Files:**
- Create: `src/database/migrations/1794441600005-AddCheckoutSessionToOrders.ts`
- Modify: `src/orders/entities/order.entity.ts` (add a column next to `stripePaymentIntentId`, a `@Unique`, and update the comment at line 97)

**Interfaces:**
- Produces: `Order.stripeCheckoutSessionId: string | null` (column `stripe_checkout_session_id varchar(255) NULL`, constraint `UQ_orders_stripe_checkout_session_id`).

- [ ] **Step 1:** Write the migration. `up`: `ALTER TABLE "orders" ADD "stripe_checkout_session_id" character varying(255)` and `ADD CONSTRAINT "UQ_orders_stripe_checkout_session_id" UNIQUE ("stripe_checkout_session_id")`. `down`: drop the constraint, then the column.
- [ ] **Step 2:** Add the entity column and the `@Unique('UQ_orders_stripe_checkout_session_id', ['stripeCheckoutSessionId'])` decorator.
- [ ] **Step 3 (user):** `npm run migration:run`. Expected: `AddCheckoutSessionToOrders1794441600005 has been executed successfully.`

### Task 3: PaymentsModule, Stripe provider, and PaymentsService

**Prerequisite (user):** `npm install stripe`. It's the official SDK (https://github.com/stripe/stripe-node) and ships its own types.

**Files:**
- Create: `src/payments/payments.service.ts`, `src/payments/payments.module.ts`, `src/payments/payments.service.spec.ts`

**Interfaces:**
- Produces (all in `payments.service.ts`):
  ```ts
  export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');
  export const CHECKOUT_SESSION_TTL_SECONDS = 30 * 60;

  // Plain shape so Payments never imports Orders' entity files; Order satisfies it.
  export interface CheckoutOrder {
    id: string; orderNumber: number; email: string; currency: string;
    total: number; discountCode: string | null; discountAmount: number;
    items: { name: string; unitPrice: number; quantity: number }[];
  }
  export interface CheckoutSessionResult { id: string; url: string }
  export interface PaymentOutcome {
    eventId: string; eventType: string; sessionId: string;
    result: 'paid' | 'failed';
    paymentIntentId: string | null; amountTotal: number | null; currency: string | null;
  }

  class PaymentsService {
    createCheckoutSession(order: CheckoutOrder): Promise<CheckoutSessionResult>;
    constructWebhookEvent(rawBody: Buffer | undefined, signature: string | undefined): Stripe.Event; // BadRequestException on missing/invalid
    toPaymentOutcome(event: Stripe.Event): PaymentOutcome | null; // null = event not handled
  }
  ```
- `PaymentsModule`: provider `{ provide: STRIPE_CLIENT, inject: [ConfigService], useFactory: (c) => new Stripe(c.get('STRIPE_SECRET_KEY', { infer: true })) }` without `apiVersion` (the SDK default is pinned by package-lock). Also provides and exports `PaymentsService`. `imports: [forwardRef(() => OrdersModule)]` and `controllers: [PaymentsController]` are added in Task 5.

- [ ] **Step 1: Write failing tests** in `payments.service.spec.ts`. Mock `stripe = { checkout: { sessions: { create } }, coupons: { create }, webhooks: { constructEvent } }`, and `ConfigService.get` returns `FRONTEND_URL = 'http://localhost:5173'` and `STRIPE_WEBHOOK_SECRET = 'whsec_test'`.
  - `createCheckoutSession` with no discount: calls `sessions.create` once with `mode: 'payment'`, `line_items: [{ price_data: { currency: 'usd', unit_amount: 36300, product_data: { name: 'Neck Pillow 2.0' } }, quantity: 2 }]`, `customer_email`, `client_reference_id: order.id`, `metadata: { orderId }`, `payment_intent_data: { receipt_email, metadata: { orderId } }`, `success_url: 'http://localhost:5173/order-confirmation/<id>'`, `cancel_url: 'http://localhost:5173/checkout'`, and `expires_at` equal to now + 1800 (use fake timers). It must not call `coupons.create`, must omit `discounts`, and returns `{ id, url }`.
  - With `discountAmount: 7260, discountCode: 'WELCOME10'`: calls `coupons.create({ amount_off: 7260, currency: 'usd', duration: 'once', max_redemptions: 1, name: 'WELCOME10' })`, then passes `discounts: [{ coupon: 'coupon_id' }]`.
  - Throws `InternalServerErrorException` when the created session's `amount_total !== order.total` (guards the money rule before sending the customer to pay).
  - `constructWebhookEvent(undefined, 'sig')` and `(buf, undefined)` → `BadRequestException`, and `constructEvent` is not called.
  - `constructWebhookEvent` when `constructEvent` throws → `BadRequestException('Invalid Stripe signature')`.
  - `toPaymentOutcome`: `completed` + `payment_status: 'paid'` → `result: 'paid'`. `completed` + `'unpaid'` → `null`. `async_payment_succeeded` → `'paid'`. `async_payment_failed` → `'failed'`. `expired` → `'failed'`. `charge.refunded` → `null`. `paymentIntentId`, `amountTotal`, and `currency` are copied from the session.
- [ ] **Step 2 (user):** `npm run test -- payments.service`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `payments.service.ts` and `payments.module.ts`. Log one line per session: `Checkout session <id> created for order #<n> (<total> <currency>)`.
- [ ] **Step 4 (user):** `npm run test -- payments.service`. Expected: PASS.

### Task 4: POST /orders returns `checkoutUrl`

**Files:**
- Modify: `src/orders/orders.service.ts`, `src/orders/orders.module.ts`, `src/orders/orders.controller.ts`, `src/orders/dto/order-response.dto.ts`, `src/orders/orders.service.spec.ts`, `src/orders/orders.controller.spec.ts`

**Interfaces:**
- Consumes: `PaymentsService.createCheckoutSession`, `CheckoutOrder`, `CheckoutSessionResult` (Task 3), and `Order.stripeCheckoutSessionId` (Task 2).
- Produces: `OrdersService.create(dto): Promise<{ order: Order; checkoutUrl: string }>`, and `CreateOrderResponseDto` gains `checkoutUrl: string` (`fromEntity(order, checkoutUrl)`).

- [ ] **Step 1: Write failing tests** in `orders.service.spec.ts`. Add `{ provide: PaymentsService, useValue: { createCheckoutSession: jest.fn() } }` and `ordersRepository.update`.
  - After the transaction, `createCheckoutSession` is called with the saved order (items included), then `ordersRepository.update({ id }, { stripeCheckoutSessionId: 'cs_test_1' })`, and the method returns `{ order, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' }`.
  - When `createCheckoutSession` rejects, `update({ id }, { status: OrderStatus.Failed })` is called and the method throws `ServiceUnavailableException`.
  - In the controller spec, the `POST /orders` response equals `{ orderId, orderNumber, total, checkoutUrl }`.
- [ ] **Step 2 (user):** `npm run test -- orders`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. The Stripe call happens **after** the transaction commits, so no DB transaction stays open during a network call. `OrdersModule.imports` adds `forwardRef(() => PaymentsModule)`. Update the DTO comment ("`clientSecret` is added…" becomes a `checkoutUrl` comment).
- [ ] **Step 4 (user):** `npm run test -- orders`. Expected: PASS.

### Task 5: Apply webhook outcomes + webhook controller

**Files:**
- Modify: `src/orders/orders.service.ts`, `src/orders/orders.service.spec.ts`, `src/payments/payments.module.ts`, `src/app.module.ts` (import `PaymentsModule`)
- Create: `src/payments/payments.controller.ts`, `src/payments/payments.controller.spec.ts`

**Interfaces:**
- Consumes: `PaymentOutcome`, `PaymentsService.constructWebhookEvent`, `PaymentsService.toPaymentOutcome` (Task 3).
- Produces: `OrdersService.applyPaymentOutcome(outcome: PaymentOutcome): Promise<void>`, and `POST /payments/webhook` → `200 { received: true }`.

- [ ] **Step 1: Write failing tests** in `orders.service.spec.ts` for `applyPaymentOutcome`. Mock `ordersRepository.findOneBy` and `update` (returns `{ affected }`).
  - Paid outcome, pending order, matching `amountTotal`/`currency` → `update({ id, status: Not(OrderStatus.Paid) }, { status: OrderStatus.Paid, stripePaymentIntentId: 'pi_1' })`.
  - Paid outcome, order already `paid` → `update` affects 0 rows. No throw. Logs `already paid`. (Review Focus 1)
  - Failed outcome → `update({ id, status: OrderStatus.Pending }, { status: OrderStatus.Failed })`. A paid order is never touched. (Review Focus 2)
  - Paid outcome with `amountTotal !== order.total` or a different currency → no `update`, `Logger.error` called. (Review Focus 3)
  - Unknown session (`findOneBy` → null) → no `update`, `Logger.warn`, no throw. (Review Focus 4)
- [ ] **Step 2: Write failing tests** in `payments.controller.spec.ts`:
  - `rawBody` and the `stripe-signature` header are passed to `constructWebhookEvent`. When it throws `BadRequestException`, the handler rethrows it (400). (Review Focus 5)
  - A handled event → `applyPaymentOutcome(outcome)` called once → returns `{ received: true }`.
  - An unhandled event (`toPaymentOutcome` → null) → `applyPaymentOutcome` is not called, and the response is `{ received: true }`.
- [ ] **Step 3 (user):** `npm run test -- payments orders`. Expected: the new tests FAIL.
- [ ] **Step 4:** Implement `applyPaymentOutcome`. Look up the order by `stripeCheckoutSessionId`, then run the conditional `update` above. Implement `PaymentsController` with `@Controller('payments')`, `@Post('webhook') @HttpCode(200)`, `@Req() req: RawBodyRequest<Request>`, and `@Headers('stripe-signature')`. No throttle guard. Log lines (`Logger('StripeWebhook')`, no customer data):
  - `evt_… checkout.session.completed → order #1001 paid`
  - `evt_… checkout.session.completed → order #1001 already paid (duplicate)`
  - `evt_… checkout.session.expired → order #1001 failed`
  - `evt_… charge.refunded ignored`
  - warn `Stripe webhook rejected: invalid signature`
  - warn `evt_… no order for session cs_…`
  - error `evt_… amount mismatch for order #1001 (session 36300 usd, order 32670 usd); not marked paid`
- [ ] **Step 5:** Wire it up. `PaymentsModule` gets `imports: [forwardRef(() => OrdersModule)]` and `controllers: [PaymentsController]`. `AppModule` imports `PaymentsModule`.
- [ ] **Step 6 (user):** `npm run test`. Expected: all suites PASS.

### Task 6: Manual end-to-end test (user)

- [ ] **Step 1:** Run `npm run start:dev` and `ngrok http 3000 --url https://unkeyed-gracie-nimbly.ngrok-free.dev`.
- [ ] **Step 2:** `POST /orders` (Postman/curl) with a valid body. Expected response: `200 { orderId, orderNumber, total, checkoutUrl }`, and the log shows `Checkout session cs_test_… created for order #…`.
- [ ] **Step 3:** Open `checkoutUrl` and pay with `4242 4242 4242 4242`. Expected:
  - the log shows `→ order #… paid`
  - the Stripe destination shows a 200 delivery
  - `GET /orders/:id` returns `status: "paid"`
- [ ] **Step 4:** In the Stripe destination, click **Resend** on that event. Expected: a 200 and `already paid (duplicate)`.
- [ ] **Step 5:** Pay with `4000 0000 0000 0002`. Expected: Stripe shows the decline on its page and the order stays `pending`.
- [ ] **Step 6:** Pay with `4000 0025 0000 3155` and complete 3D Secure. Expected: `paid`.
- [ ] **Step 7:** Frontend follow-up (separate plan): `Checkout.jsx` does `window.location.href = placed.checkoutUrl` instead of `navigate(...)`.
