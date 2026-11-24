import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import Stripe from 'stripe';
import {
  CheckoutOrder,
  PaymentsService,
  STRIPE_CLIENT,
} from './payments.service';

const NOW_MS = Date.UTC(2026, 10, 13, 12, 0, 0);

function makeOrder(overrides: Partial<CheckoutOrder> = {}): CheckoutOrder {
  return {
    id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    orderNumber: 1001,
    email: 'customer@example.com',
    currency: 'usd',
    total: 72600,
    discountCode: null,
    discountAmount: 0,
    items: [{ name: 'Neck Pillow 2.0', unitPrice: 36300, quantity: 2 }],
    ...overrides,
  };
}

function makeEvent(
  type: string,
  session: Partial<Stripe.Checkout.Session>,
): Stripe.Event {
  return {
    id: 'evt_1',
    type,
    data: {
      object: {
        id: 'cs_test_1',
        payment_status: 'paid',
        payment_intent: 'pi_1',
        amount_total: 72600,
        currency: 'usd',
        ...session,
      },
    },
  } as unknown as Stripe.Event;
}

describe('PaymentsService', () => {
  let service: PaymentsService;

  const stripe = {
    checkout: { sessions: { create: jest.fn() } },
    coupons: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  };
  const env: Record<string, string> = {
    FRONTEND_URL: 'http://localhost:5173',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
  };
  const config = { get: jest.fn() };
  let dateNow: jest.SpyInstance;

  beforeEach(async () => {
    jest.resetAllMocks();
    config.get.mockImplementation((key: string) => env[key]);
    dateNow = jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    stripe.checkout.sessions.create.mockResolvedValue({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
      amount_total: 72600,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: STRIPE_CLIENT, useValue: stripe },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(PaymentsService);
  });

  afterEach(() => dateNow.mockRestore());

  describe('createCheckoutSession', () => {
    it('sends server prices, order references, and a 30-minute expiry', async () => {
      const order = makeOrder();

      await expect(service.createCheckoutSession(order)).resolves.toEqual({
        id: 'cs_test_1',
        url: 'https://checkout.stripe.com/c/pay/cs_test_1',
      });

      expect(stripe.coupons.create).not.toHaveBeenCalled();
      expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
      const params = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(params).toEqual({
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: 36300,
              product_data: { name: 'Neck Pillow 2.0' },
            },
            quantity: 2,
          },
        ],
        customer_email: 'customer@example.com',
        client_reference_id: order.id,
        metadata: { orderId: order.id },
        payment_intent_data: {
          receipt_email: 'customer@example.com',
          metadata: { orderId: order.id },
        },
        success_url: `http://localhost:5173/order-confirmation/${order.id}`,
        cancel_url: 'http://localhost:5173/checkout',
        expires_at: NOW_MS / 1000 + 1800,
      });
      expect(params).not.toHaveProperty('discounts');
    });

    it('applies the discount as a single-use coupon for the exact amount', async () => {
      stripe.coupons.create.mockResolvedValue({ id: 'coupon_id' });
      stripe.checkout.sessions.create.mockResolvedValue({
        id: 'cs_test_1',
        url: 'https://checkout.stripe.com/c/pay/cs_test_1',
        amount_total: 65340,
      });

      await service.createCheckoutSession(
        makeOrder({
          discountCode: 'WELCOME10',
          discountAmount: 7260,
          total: 65340,
        }),
      );

      expect(stripe.coupons.create).toHaveBeenCalledWith({
        amount_off: 7260,
        currency: 'usd',
        duration: 'once',
        max_redemptions: 1,
        name: 'WELCOME10',
      });
      expect(stripe.checkout.sessions.create.mock.calls[0][0]).toMatchObject({
        discounts: [{ coupon: 'coupon_id' }],
      });
    });

    it('refuses a session whose total differs from the order total', async () => {
      stripe.checkout.sessions.create.mockResolvedValue({
        id: 'cs_test_1',
        url: 'https://checkout.stripe.com/c/pay/cs_test_1',
        amount_total: 1,
      });

      await expect(
        service.createCheckoutSession(makeOrder()),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('constructWebhookEvent', () => {
    it('rejects a missing raw body without verifying', () => {
      expect(() => service.constructWebhookEvent(undefined, 'sig')).toThrow(
        BadRequestException,
      );
      expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled();
    });

    it('rejects a missing signature header without verifying', () => {
      expect(() =>
        service.constructWebhookEvent(Buffer.from('{}'), undefined),
      ).toThrow(BadRequestException);
      expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled();
    });

    it('rejects an invalid signature', () => {
      stripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature');
      });

      expect(() =>
        service.constructWebhookEvent(Buffer.from('{}'), 't=1,v1=bad'),
      ).toThrow(new BadRequestException('Invalid Stripe signature'));
    });

    it('verifies the raw body with the webhook secret', () => {
      const event = makeEvent('checkout.session.completed', {});
      stripe.webhooks.constructEvent.mockReturnValue(event);
      const body = Buffer.from('{"id":"evt_1"}');

      expect(service.constructWebhookEvent(body, 't=1,v1=ok')).toBe(event);
      expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
        body,
        't=1,v1=ok',
        'whsec_test',
      );
    });
  });

  describe('toPaymentOutcome', () => {
    it('maps a paid completed session to paid', () => {
      expect(
        service.toPaymentOutcome(makeEvent('checkout.session.completed', {})),
      ).toEqual({
        eventId: 'evt_1',
        eventType: 'checkout.session.completed',
        sessionId: 'cs_test_1',
        result: 'paid',
        paymentIntentId: 'pi_1',
        amountTotal: 72600,
        currency: 'usd',
        presentment: null,
      });
    });

    it('keeps the customer currency from Adaptive Pricing, amount check stays USD', () => {
      const outcome = service.toPaymentOutcome(
        makeEvent('checkout.session.completed', {
          presentment_details: {
            presentment_amount: 20480000,
            presentment_currency: 'PKR',
          },
        }),
      );

      expect(outcome).toMatchObject({
        amountTotal: 72600,
        currency: 'usd',
        presentment: { amount: 20480000, currency: 'pkr' },
      });
    });

    // prettier-ignore
    it.each([
      ['same currency as the order', { presentment_amount: 72600, presentment_currency: 'usd' }],
      ['a negative amount', { presentment_amount: -1, presentment_currency: 'pkr' }],
      ['a fractional amount', { presentment_amount: 1.5, presentment_currency: 'pkr' }],
      ['a malformed currency', { presentment_amount: 100, presentment_currency: 'rupees' }],
    ])('ignores presentment details with %s', (_label, details) => {
      expect(
        service.toPaymentOutcome(
          makeEvent('checkout.session.completed', {
            presentment_details: details,
          }),
        ),
      ).toMatchObject({ presentment: null });
    });

    it('waits on a completed session that is not paid yet', () => {
      expect(
        service.toPaymentOutcome(
          makeEvent('checkout.session.completed', { payment_status: 'unpaid' }),
        ),
      ).toBeNull();
    });

    it('maps async success to paid', () => {
      expect(
        service.toPaymentOutcome(
          makeEvent('checkout.session.async_payment_succeeded', {}),
        ),
      ).toMatchObject({ result: 'paid' });
    });

    it.each([
      'checkout.session.async_payment_failed',
      'checkout.session.expired',
    ])('maps %s to failed', (type) => {
      expect(
        service.toPaymentOutcome(
          makeEvent(type, { payment_status: 'unpaid', payment_intent: null }),
        ),
      ).toMatchObject({ result: 'failed', paymentIntentId: null });
    });

    it('ignores events it does not handle', () => {
      expect(
        service.toPaymentOutcome(makeEvent('charge.refunded', {})),
      ).toBeNull();
    });
  });
});
