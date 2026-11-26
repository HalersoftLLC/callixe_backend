import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { EnvironmentVariables } from '../config/env.validation';

export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

// Stripe allows 30 minutes to 24 hours; short so abandoned orders close fast.
export const CHECKOUT_SESSION_TTL_SECONDS = 30 * 60;

// Card only. This API version has no `payment_method_types` on Checkout
// Sessions, so every other type it knows (stripe-node 23 list) is excluded:
// PayPal, Klarna, Afterpay, Cash App, etc. never show, whatever the
// Dashboard has on, and no redirect-based method needs a return_url.
// Apple Pay / Google Pay are card wallets; the storefront hides them.
const NON_CARD_PAYMENT_METHODS: Stripe.Checkout.SessionCreateParams.ExcludedPaymentMethodType[] =
  [
    'acss_debit',
    'affirm',
    'afterpay_clearpay',
    'alipay',
    'alma',
    'amazon_pay',
    'au_becs_debit',
    'bacs_debit',
    'bancontact',
    'billie',
    'bizum',
    'blik',
    'boleto',
    'cashapp',
    'crypto',
    'customer_balance',
    'eps',
    'fpx',
    'giropay',
    'grabpay',
    'ideal',
    'kakao_pay',
    'klarna',
    'konbini',
    'kr_card',
    'mb_way',
    'mobilepay',
    'multibanco',
    'naver_pay',
    'nz_bank_account',
    'oxxo',
    'p24',
    'pay_by_bank',
    'payco',
    'paynow',
    'paypal',
    'paypay',
    'payto',
    'pix',
    'promptpay',
    'revolut_pay',
    'samsung_pay',
    'satispay',
    'scalapay',
    'sepa_debit',
    'sequra',
    'sofort',
    'sunbit',
    'swish',
    'twint',
    'upi',
    'us_bank_account',
    'wechat_pay',
    'zip',
  ];

// A server-priced cart (no order exists yet when the session is created).
// Plain shape so Payments never imports Orders' files.
export interface PaymentCart {
  currency: string;
  total: number;
  discountCode: string | null;
  discountAmount: number;
  items: {
    name: string;
    unitPrice: number;
    quantity: number;
    // "Buy one, get one 50% off" saving on this line; 0 when none.
    dealDiscount: number;
  }[];
}

// clientSecret lets the storefront mount Stripe Elements for this session.
// Only POST /orders/payment-session returns it; it is never logged.
export interface PaymentSessionResult {
  id: string;
  clientSecret: string;
}

export interface OpenPaymentSession {
  id: string;
  amountTotal: number | null;
  currency: string | null;
}

export const SESSION_CLOSED_MESSAGE =
  'This payment session has ended. Please reload checkout and try again.';

// What a webhook event means for an order; null from toPaymentOutcome
// means the event changes nothing.
export interface PaymentOutcome {
  eventId: string;
  eventType: string;
  sessionId: string;
  result: 'paid' | 'failed';
  paymentIntentId: string | null;
  amountTotal: number | null;
  currency: string | null;
  // What the customer paid in their own currency (Adaptive Pricing). For
  // display only: the payment check always uses amountTotal/currency, which
  // Stripe keeps in the integration currency. Null when not converted.
  presentment: { amount: number; currency: string } | null;
}

// Docs followed: https://docs.stripe.com/checkout/fulfillment,
// https://docs.stripe.com/api/checkout/sessions/create,
// https://docs.stripe.com/api/checkout/sessions/object (presentment_details),
// https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing,
// https://docs.stripe.com/webhooks, https://github.com/stripe/stripe-node,
// https://docs.stripe.com/checkout/custom/quickstart,
// https://docs.stripe.com/checkout/fulfillment?ui=elements,
// https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing?payment-ui=embedded-components
//
// Sessions use ui_mode 'elements': the storefront shows Stripe's card fields
// on its own checkout page (no redirect to a Stripe-hosted page). The session
// is created when checkout opens, before the order exists; POST /orders then
// saves the order against it (getOpenSession + linkOrder).
//
// Adaptive Pricing (local-currency payment) is switched on in the Stripe
// Dashboard, not here (adaptive_pricing.enabled defaults to that setting).
// With Elements the storefront must also render the Currency Selector
// Element. Sessions are still created in CURRENCY; Stripe keeps
// amount_total/currency in CURRENCY.
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // Amounts come only from the server-priced cart (CLAUDE.md section 5).
  // Card only, so no redirect-based method needs a return_url here: the
  // storefront passes returnUrl to confirm() once the order id exists. No
  // email yet either: it reaches Stripe through confirm({ email }).
  async createPaymentSession(cart: PaymentCart): Promise<PaymentSessionResult> {
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      ui_mode: 'elements',
      excluded_payment_method_types: NON_CARD_PAYMENT_METHODS,
      line_items: cart.items.flatMap((item) =>
        toLineItems(item, cart.currency),
      ),
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
    };

    // Checkout has no "discount amount" field, so the server-calculated
    // discount becomes a coupon that can be used exactly once.
    if (cart.discountAmount > 0) {
      const coupon = await this.stripe.coupons.create({
        amount_off: cart.discountAmount,
        currency: cart.currency,
        duration: 'once',
        max_redemptions: 1,
        name: cart.discountCode ?? undefined,
      });
      params.discounts = [{ coupon: coupon.id }];
    }

    const session = await this.stripe.checkout.sessions.create(params);

    // Never let a customer pay an amount other than the cart total.
    if (session.amount_total !== cart.total || !session.client_secret) {
      throw new InternalServerErrorException(
        `Checkout session ${session.id} total ${session.amount_total} does not match cart total ${cart.total}`,
      );
    }

    this.logger.log(
      `Checkout session ${session.id} created (${cart.total} ${cart.currency})`,
    );
    return { id: session.id, clientSecret: session.client_secret };
  }

  // A session can pay for an order only while it is still open (not paid,
  // not expired). Unknown or closed → 409 so the storefront reloads checkout.
  async getOpenSession(sessionId: string): Promise<OpenPaymentSession> {
    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.retrieve(sessionId);
    } catch (err) {
      if (err instanceof Stripe.errors.StripeInvalidRequestError) {
        throw new ConflictException(SESSION_CLOSED_MESSAGE);
      }
      throw err;
    }
    if (session.status !== 'open') {
      throw new ConflictException(SESSION_CLOSED_MESSAGE);
    }
    return {
      id: session.id,
      amountTotal: session.amount_total,
      currency: session.currency,
    };
  }

  // Adds orderId to the session and its PaymentIntent for the Stripe
  // Dashboard. The webhook finds orders by session id, so a failure here is
  // only logged and never fails the order.
  async linkOrder(sessionId: string, orderId: string): Promise<void> {
    try {
      await this.stripe.checkout.sessions.update(sessionId, {
        metadata: { orderId },
        payment_intent_data: { metadata: { orderId } },
      });
    } catch (err) {
      this.logger.warn(
        `Could not add orderId to session ${sessionId}: ${(err as Error).message}`,
      );
    }
  }

  // Signature check needs the exact bytes Stripe sent (main.ts rawBody: true).
  constructWebhookEvent(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Stripe.Event {
    if (!rawBody || !signature) {
      throw new BadRequestException('Missing Stripe signature or body');
    }
    try {
      return this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.config.get('STRIPE_WEBHOOK_SECRET', { infer: true }),
      );
    } catch {
      throw new BadRequestException('Invalid Stripe signature');
    }
  }

  toPaymentOutcome(event: Stripe.Event): PaymentOutcome | null {
    switch (event.type) {
      case 'checkout.session.completed':
        // 'unpaid' = delayed payment method; async_payment_* follows later.
        return event.data.object.payment_status === 'paid'
          ? this.outcome(event, event.data.object, 'paid')
          : null;
      case 'checkout.session.async_payment_succeeded':
        return this.outcome(event, event.data.object, 'paid');
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        return this.outcome(event, event.data.object, 'failed');
      default:
        return null;
    }
  }

  private outcome(
    event: Stripe.Event,
    session: Stripe.Checkout.Session,
    result: PaymentOutcome['result'],
  ): PaymentOutcome {
    const paymentIntent = session.payment_intent;
    return {
      eventId: event.id,
      eventType: event.type,
      sessionId: session.id,
      result,
      paymentIntentId:
        typeof paymentIntent === 'string'
          ? paymentIntent
          : (paymentIntent?.id ?? null),
      amountTotal: session.amount_total,
      currency: session.currency,
      presentment: toPresentment(session),
    };
  }
}

// One Checkout line per order item, or two when "buy one, get one 50% off"
// applies: the full-price units, then every second unit at its reduced
// price. Their sum is exactly the item's line total, so amount_total still
// equals the order total (checked after the session is created).
function toLineItems(
  item: PaymentCart['items'][number],
  currency: string,
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const line = (name: string, unitAmount: number, quantity: number) => ({
    price_data: {
      currency,
      unit_amount: unitAmount,
      product_data: { name },
    },
    quantity,
  });

  const halfPriceUnits =
    item.dealDiscount > 0 ? Math.floor(item.quantity / 2) : 0;
  if (halfPriceUnits === 0) {
    return [line(item.name, item.unitPrice, item.quantity)];
  }
  // dealDiscount = halfPriceUnits * floor(unitPrice / 2): divides exactly.
  const reducedPrice = item.unitPrice - item.dealDiscount / halfPriceUnits;
  return [
    line(item.name, item.unitPrice, item.quantity - halfPriceUnits),
    line(`${item.name} (2nd at 50% off)`, reducedPrice, halfPriceUnits),
  ];
}

// Only a real conversion is kept: missing, malformed or same-currency
// details give null.
function toPresentment(
  session: Stripe.Checkout.Session,
): PaymentOutcome['presentment'] {
  const details = session.presentment_details;
  const amount = details?.presentment_amount;
  const currency = details?.presentment_currency?.toLowerCase();
  if (
    typeof amount !== 'number' ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !currency ||
    !/^[a-z]{3}$/.test(currency) ||
    currency === session.currency?.toLowerCase()
  ) {
    return null;
  }
  return { amount, currency };
}
