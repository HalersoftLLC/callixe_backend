import {
  BadRequestException,
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

// Plain shape so Payments never imports Orders' entity files.
// The Order entity satisfies it as-is.
export interface CheckoutOrder {
  id: string;
  orderNumber: number;
  email: string;
  currency: string;
  total: number;
  discountCode: string | null;
  discountAmount: number;
  items: { name: string; unitPrice: number; quantity: number }[];
}

export interface CheckoutSessionResult {
  id: string;
  url: string;
}

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
// https://docs.stripe.com/webhooks, https://github.com/stripe/stripe-node
//
// Adaptive Pricing (local-currency payment) is switched on in the Stripe
// Dashboard, not here. Sessions are still created in CURRENCY; Stripe converts
// on its page and keeps amount_total/currency in CURRENCY.
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // Amounts come only from the saved order (CLAUDE.md section 5).
  async createCheckoutSession(
    order: CheckoutOrder,
  ): Promise<CheckoutSessionResult> {
    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true });

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      line_items: order.items.map((item) => ({
        price_data: {
          currency: order.currency,
          unit_amount: item.unitPrice,
          product_data: { name: item.name },
        },
        quantity: item.quantity,
      })),
      customer_email: order.email,
      client_reference_id: order.id,
      metadata: { orderId: order.id },
      payment_intent_data: {
        receipt_email: order.email,
        metadata: { orderId: order.id },
      },
      success_url: `${frontendUrl}/order-confirmation/${order.id}`,
      cancel_url: `${frontendUrl}/checkout`,
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
    };

    // Checkout has no "discount amount" field, so the server-calculated
    // discount becomes a coupon that can be used exactly once.
    if (order.discountAmount > 0) {
      const coupon = await this.stripe.coupons.create({
        amount_off: order.discountAmount,
        currency: order.currency,
        duration: 'once',
        max_redemptions: 1,
        name: order.discountCode ?? undefined,
      });
      params.discounts = [{ coupon: coupon.id }];
    }

    const session = await this.stripe.checkout.sessions.create(params);

    // Never send a customer to pay an amount other than the order total.
    if (session.amount_total !== order.total || !session.url) {
      throw new InternalServerErrorException(
        `Checkout session ${session.id} total ${session.amount_total} does not match order #${order.orderNumber} total ${order.total}`,
      );
    }

    this.logger.log(
      `Checkout session ${session.id} created for order #${order.orderNumber} (${order.total} ${order.currency})`,
    );
    return { id: session.id, url: session.url };
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
