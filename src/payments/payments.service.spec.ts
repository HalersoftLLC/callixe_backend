import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import Stripe from 'stripe';
import {
  PaymentCart,
  PaymentsService,
  STRIPE_CLIENT,
} from './payments.service';

const NOW_MS = Date.UTC(2026, 10, 13, 12, 0, 0);
const CLIENT_SECRET = 'cs_test_1_secret_abc';

// Kept as makeOrder so the existing tests read the same; it is a priced cart.
function makeOrder(overrides: Partial<PaymentCart> = {}): PaymentCart {
  return {
    currency: 'usd',
    total: 72600,
    discountCode: null,
    discountAmount: 0,
    items: [
      {
        name: 'Neck Pillow 2.0',
        unitPrice: 36300,
        quantity: 2,
        dealDiscount: 0,
      },
    ],
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
    checkout: {
      sessions: { create: jest.fn(), retrieve: jest.fn(), update: jest.fn() },
    },
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
      client_secret: CLIENT_SECRET,
      url: null,
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

  describe('createPaymentSession', () => {
    it('creates a card-only Elements session with server prices and a 30-minute expiry', async () => {
      await expect(service.createPaymentSession(makeOrder())).resolves.toEqual({
        id: 'cs_test_1',
        clientSecret: CLIENT_SECRET,
      });

      expect(stripe.coupons.create).not.toHaveBeenCalled();
      expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
      const params = stripe.checkout.sessions.create.mock.calls[0][0];
      // No email, return_url or order references yet: the order doesn't
      // exist until Complete Purchase (linkOrder adds orderId later).
      expect(params).toEqual({
        mode: 'payment',
        ui_mode: 'elements',
        // Card only: every other type is excluded (PayPal, Klarna, …).
        excluded_payment_method_types: expect.arrayContaining([
          'paypal',
          'klarna',
          'afterpay_clearpay',
          'cashapp',
        ]),
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
        expires_at: NOW_MS / 1000 + 1800,
      });
      expect(params).not.toHaveProperty('discounts');
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          excluded_payment_method_types: expect.not.arrayContaining(['card']),
        }),
      );
    });

    it('never logs the client secret', async () => {
      const log = jest.spyOn(Logger.prototype, 'log');

      await service.createPaymentSession(makeOrder());

      expect(log).toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain(CLIENT_SECRET);
    });

    it('refuses a session without a client secret', async () => {
      stripe.checkout.sessions.create.mockResolvedValue({
        id: 'cs_test_1',
        client_secret: null,
        url: null,
        amount_total: 72600,
      });

      await expect(
        service.createPaymentSession(makeOrder()),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('sends every second unit of a deal as a separate half-price line', async () => {
      stripe.checkout.sessions.create.mockResolvedValue({
        id: 'cs_test_1',
        client_secret: CLIENT_SECRET,
        amount_total: 90750,
      });

      // 3 units: 2 at full price + 1 at half price = 36300 * 2 + 18150
      await service.createPaymentSession(
        makeOrder({
          total: 90750,
          items: [
            {
              name: 'Neck Pillow 2.0',
              unitPrice: 36300,
              quantity: 3,
              dealDiscount: 18150,
            },
          ],
        }),
      );

      const params = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(params.line_items).toEqual([
        {
          price_data: {
            currency: 'usd',
            unit_amount: 36300,
            product_data: { name: 'Neck Pillow 2.0' },
          },
          quantity: 2,
        },
        {
          price_data: {
            currency: 'usd',
            unit_amount: 18150,
            product_data: { name: 'Neck Pillow 2.0 (2nd at 50% off)' },
          },
          quantity: 1,
        },
      ]);
    });

    it('applies the discount as a single-use coupon for the exact amount', async () => {
      stripe.coupons.create.mockResolvedValue({ id: 'coupon_id' });
      stripe.checkout.sessions.create.mockResolvedValue({
        id: 'cs_test_1',
        client_secret: CLIENT_SECRET,
        amount_total: 65340,
      });

      await service.createPaymentSession(
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
        client_secret: CLIENT_SECRET,
        amount_total: 1,
      });

      await expect(
        service.createPaymentSession(makeOrder()),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('getOpenSession', () => {
    it('returns the amount and currency of an open session', async () => {
      stripe.checkout.sessions.retrieve.mockResolvedValue({
        id: 'cs_test_1',
        status: 'open',
        amount_total: 72600,
        currency: 'usd',
      });

      await expect(service.getOpenSession('cs_test_1')).resolves.toEqual({
        id: 'cs_test_1',
        amountTotal: 72600,
        currency: 'usd',
      });
    });

    it.each(['complete', 'expired'])(
      'refuses a %s session with 409',
      async (status) => {
        stripe.checkout.sessions.retrieve.mockResolvedValue({
          id: 'cs_test_1',
          status,
          amount_total: 72600,
          currency: 'usd',
        });

        await expect(
          service.getOpenSession('cs_test_1'),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );

    it('refuses an unknown session with 409', async () => {
      stripe.checkout.sessions.retrieve.mockRejectedValue(
        new Stripe.errors.StripeInvalidRequestError({
          message: 'No such checkout.session',
          type: 'invalid_request_error',
        }),
      );

      await expect(
        service.getOpenSession('cs_test_missing'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('passes other Stripe errors through (caller answers 503)', async () => {
      stripe.checkout.sessions.retrieve.mockRejectedValue(new Error('timeout'));

      await expect(service.getOpenSession('cs_test_1')).rejects.toThrow(
        'timeout',
      );
    });
  });

  describe('linkOrder', () => {
    it('adds orderId to the session and its PaymentIntent', async () => {
      stripe.checkout.sessions.update.mockResolvedValue({});

      await service.linkOrder('cs_test_1', 'order-uuid');

      expect(stripe.checkout.sessions.update).toHaveBeenCalledWith(
        'cs_test_1',
        {
          metadata: { orderId: 'order-uuid' },
          payment_intent_data: { metadata: { orderId: 'order-uuid' } },
        },
      );
    });

    it('never throws when Stripe fails', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      stripe.checkout.sessions.update.mockRejectedValue(new Error('down'));

      await expect(
        service.linkOrder('cs_test_1', 'order-uuid'),
      ).resolves.toBeUndefined();
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
