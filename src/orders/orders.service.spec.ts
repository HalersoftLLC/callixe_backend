import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, QueryFailedError } from 'typeorm';
import { PaymentOutcome, PaymentsService } from '../payments/payments.service';
import { Product } from '../products/entities/product.entity';
import { ProductsService } from '../products/products.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { DiscountCode, DiscountType } from './entities/discount-code.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderEmailsService } from './order-emails.service';
import { OrdersService } from './orders.service';

const CLIENT_SECRET = 'cs_test_1_secret_abc';

function makeProduct(
  slug: string,
  price: number,
  name = slug,
  secondUnitHalfOff = false,
): Product {
  return {
    id: 1,
    slug,
    name,
    price,
    compareAtPrice: null,
    description: null,
    badge: null,
    secondUnitHalfOff,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeDto(overrides: Partial<CreateOrderDto> = {}): CreateOrderDto {
  return {
    email: 'customer@example.com',
    delivery: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      address: '1 Main St',
      city: 'Lahore',
      country: 'Pakistan',
    },
    items: [{ slug: 'neck-pillow-2-0', quantity: 2 }],
    paymentSessionId: 'cs_test_1',
    ...overrides,
  };
}

// The open Stripe session charges `amountTotal` (what the card form shows).
function sessionFor(amountTotal: number) {
  return { id: 'cs_test_1', amountTotal, currency: 'usd' };
}

describe('OrdersService', () => {
  let service: OrdersService;

  const ordersRepository = {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    update: jest.fn(),
  };
  const discountCodesRepository = { findOneBy: jest.fn() };
  const productsService = { findActiveBySlugs: jest.fn() };
  const paymentsService = {
    createPaymentSession: jest.fn(),
    getOpenSession: jest.fn(),
    linkOrder: jest.fn(),
  };
  const orderEmailsService = {
    sendConfirmation: jest.fn(),
    sendShipped: jest.fn(),
  };
  const config = { get: jest.fn() };

  // Fake transaction manager: records what would be written.
  const manager = {
    create: jest.fn(),
    save: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    config.get.mockReturnValue('usd');
    manager.create.mockImplementation(
      (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
    );
    manager.save.mockImplementation((value: unknown) =>
      Promise.resolve(
        Array.isArray(value)
          ? value
          : { ...(value as object), id: 'order-uuid', orderNumber: 1001 },
      ),
    );
    dataSource.transaction.mockImplementation(
      (work: (m: typeof manager) => Promise<unknown>) => work(manager),
    );
    paymentsService.createPaymentSession.mockResolvedValue({
      id: 'cs_test_1',
      clientSecret: CLIENT_SECRET,
    });
    paymentsService.getOpenSession.mockResolvedValue(sessionFor(72600));
    paymentsService.linkOrder.mockResolvedValue(undefined);
    ordersRepository.update.mockResolvedValue({ affected: 1 });
    orderEmailsService.sendConfirmation.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: ordersRepository },
        {
          provide: getRepositoryToken(DiscountCode),
          useValue: discountCodesRepository,
        },
        { provide: ProductsService, useValue: productsService },
        { provide: PaymentsService, useValue: paymentsService },
        { provide: OrderEmailsService, useValue: orderEmailsService },
        { provide: DataSource, useValue: dataSource },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = moduleRef.get(OrdersService);
  });

  describe('create', () => {
    it('prices the order from the database, not the request', async () => {
      productsService.findActiveBySlugs.mockResolvedValue([
        makeProduct('neck-pillow-2-0', 36300, 'Neck Pillow 2.0'),
      ]);

      const order = await service.create(makeDto());

      expect(productsService.findActiveBySlugs).toHaveBeenCalledWith([
        'neck-pillow-2-0',
      ]);
      expect(order).toMatchObject({
        id: 'order-uuid',
        orderNumber: 1001,
        subtotal: 72600,
        discountAmount: 0,
        shipping: 0,
        total: 72600,
        currency: 'usd',
        discountCode: null,
        apartment: null,
        postalCode: null,
        phone: null,
      });
      expect(order.items).toEqual([
        expect.objectContaining({
          slug: 'neck-pillow-2-0',
          name: 'Neck Pillow 2.0',
          unitPrice: 36300,
          quantity: 2,
          dealDiscount: 0,
          lineTotal: 72600,
        }),
      ]);
    });

    it('charges every second unit at half price when the product has the deal', async () => {
      productsService.findActiveBySlugs.mockResolvedValue([
        makeProduct('neck-pillow-2-0', 36300, 'Neck Pillow 2.0', true),
      ]);
      paymentsService.getOpenSession.mockResolvedValue(sessionFor(54450));

      const order = await service.create(makeDto());

      expect(order).toMatchObject({ subtotal: 54450, total: 54450 });
      expect(order.items).toEqual([
        expect.objectContaining({
          unitPrice: 36300,
          quantity: 2,
          dealDiscount: 18150,
          lineTotal: 54450,
        }),
      ]);
    });

    it('saves the order and its items inside one transaction', async () => {
      productsService.findActiveBySlugs.mockResolvedValue([
        makeProduct('neck-pillow-2-0', 36300),
      ]);

      await service.create(makeDto());

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.create).toHaveBeenCalledWith(Order, expect.any(Object));
      expect(manager.create).toHaveBeenCalledWith(
        OrderItem,
        expect.objectContaining({ slug: 'neck-pillow-2-0' }),
      );
      expect(manager.save).toHaveBeenCalledTimes(2);
    });

    it('applies a valid discount code (case-insensitive)', async () => {
      productsService.findActiveBySlugs.mockResolvedValue([
        makeProduct('neck-pillow-2-0', 36300),
      ]);
      discountCodesRepository.findOneBy.mockResolvedValue({
        code: 'WELCOME10',
        type: DiscountType.Percent,
        value: 10,
        active: true,
      });
      paymentsService.getOpenSession.mockResolvedValue(sessionFor(32670));

      const order = await service.create(
        makeDto({
          items: [{ slug: 'neck-pillow-2-0', quantity: 1 }],
          discountCode: 'welcome10',
        }),
      );

      expect(discountCodesRepository.findOneBy).toHaveBeenCalledWith({
        code: 'WELCOME10',
        active: true,
      });
      expect(order).toMatchObject({
        discountCode: 'WELCOME10',
        subtotal: 36300,
        discountAmount: 3630,
        total: 32670,
      });
    });

    it('rejects an invalid discount code without saving', async () => {
      productsService.findActiveBySlugs.mockResolvedValue([
        makeProduct('neck-pillow-2-0', 36300),
      ]);
      discountCodesRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.create(makeDto({ discountCode: 'NOPE' })),
      ).rejects.toThrow(new BadRequestException('Invalid discount code'));
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects unknown or inactive products without saving', async () => {
      productsService.findActiveBySlugs.mockResolvedValue([
        makeProduct('neck-pillow-2-0', 36300),
      ]);

      await expect(
        service.create(
          makeDto({
            items: [
              { slug: 'neck-pillow-2-0', quantity: 1 },
              { slug: 'retired-product', quantity: 1 },
            ],
          }),
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Unknown or unavailable products: retired-product',
        ),
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects duplicate slugs before querying products', async () => {
      await expect(
        service.create(
          makeDto({
            items: [
              { slug: 'heat-wrap', quantity: 1 },
              { slug: 'heat-wrap', quantity: 2 },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(productsService.findActiveBySlugs).not.toHaveBeenCalled();
    });

    it('saves the session id with the order, then links the order in Stripe', async () => {
      productsService.findActiveBySlugs.mockResolvedValue([
        makeProduct('neck-pillow-2-0', 36300, 'Neck Pillow 2.0'),
      ]);

      await service.create(makeDto());

      expect(paymentsService.getOpenSession).toHaveBeenCalledWith('cs_test_1');
      expect(manager.create).toHaveBeenCalledWith(
        Order,
        expect.objectContaining({ stripeCheckoutSessionId: 'cs_test_1' }),
      );
      expect(paymentsService.linkOrder).toHaveBeenCalledWith(
        'cs_test_1',
        'order-uuid',
      );
      // Stripe is updated only after the transaction has committed.
      expect(dataSource.transaction.mock.invocationCallOrder[0]).toBeLessThan(
        paymentsService.linkOrder.mock.invocationCallOrder[0],
      );
    });

    it('rejects a session made for a different total without saving', async () => {
      productsService.findActiveBySlugs.mockResolvedValue([
        makeProduct('neck-pillow-2-0', 36300),
      ]);
      // Session opened for 1 unit, request asks for 2.
      paymentsService.getOpenSession.mockResolvedValue(sessionFor(36300));

      await expect(service.create(makeDto())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a session in another currency without saving', async () => {
      productsService.findActiveBySlugs.mockResolvedValue([
        makeProduct('neck-pillow-2-0', 36300),
      ]);
      paymentsService.getOpenSession.mockResolvedValue({
        ...sessionFor(72600),
        currency: 'eur',
      });

      await expect(service.create(makeDto())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('passes a closed or unknown session through as 409', async () => {
      paymentsService.getOpenSession.mockRejectedValue(
        new ConflictException('ended'),
      );

      await expect(service.create(makeDto())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('returns 503 when Stripe cannot be reached', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      paymentsService.getOpenSession.mockRejectedValue(
        new Error('Stripe down'),
      );

      await expect(service.create(makeDto())).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('answers 409 when the session already paid for another order', async () => {
      productsService.findActiveBySlugs.mockResolvedValue([
        makeProduct('neck-pillow-2-0', 36300),
      ]);
      dataSource.transaction.mockRejectedValue(
        new QueryFailedError('INSERT', [], { code: '23505' } as never),
      );

      await expect(service.create(makeDto())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(paymentsService.linkOrder).not.toHaveBeenCalled();
    });
  });

  describe('createPaymentSession', () => {
    it('prices the cart on the server and saves nothing', async () => {
      productsService.findActiveBySlugs.mockResolvedValue([
        makeProduct('neck-pillow-2-0', 36300, 'Neck Pillow 2.0', true),
      ]);

      await expect(
        service.createPaymentSession({
          items: [{ slug: 'neck-pillow-2-0', quantity: 2 }],
        }),
      ).resolves.toEqual({
        sessionId: 'cs_test_1',
        clientSecret: CLIENT_SECRET,
        total: 54450,
      });

      expect(paymentsService.createPaymentSession).toHaveBeenCalledWith({
        currency: 'usd',
        total: 54450,
        discountCode: null,
        discountAmount: 0,
        items: [
          expect.objectContaining({
            name: 'Neck Pillow 2.0',
            unitPrice: 36300,
            quantity: 2,
            dealDiscount: 18150,
          }),
        ],
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects an invalid discount code before calling Stripe', async () => {
      productsService.findActiveBySlugs.mockResolvedValue([
        makeProduct('neck-pillow-2-0', 36300),
      ]);
      discountCodesRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.createPaymentSession({
          items: [{ slug: 'neck-pillow-2-0', quantity: 1 }],
          discountCode: 'NOPE',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(paymentsService.createPaymentSession).not.toHaveBeenCalled();
    });

    it('returns 503 when Stripe fails', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      productsService.findActiveBySlugs.mockResolvedValue([
        makeProduct('neck-pillow-2-0', 36300),
      ]);
      paymentsService.createPaymentSession.mockRejectedValue(
        new Error('Stripe down'),
      );

      await expect(
        service.createPaymentSession({
          items: [{ slug: 'neck-pillow-2-0', quantity: 1 }],
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('applyPaymentOutcome', () => {
    const pendingOrder = {
      id: 'order-uuid',
      orderNumber: 1001,
      total: 72600,
      currency: 'usd',
      status: OrderStatus.Pending,
    };

    function makeOutcome(
      overrides: Partial<PaymentOutcome> = {},
    ): PaymentOutcome {
      return {
        eventId: 'evt_1',
        eventType: 'checkout.session.completed',
        sessionId: 'cs_test_1',
        result: 'paid',
        paymentIntentId: 'pi_1',
        amountTotal: 72600,
        currency: 'usd',
        presentment: null,
        ...overrides,
      };
    }

    let log: jest.SpyInstance;
    let warn: jest.SpyInstance;
    let error: jest.SpyInstance;

    beforeEach(() => {
      log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      ordersRepository.findOneBy.mockResolvedValue(pendingOrder);
    });

    it('marks the order paid when the amount matches', async () => {
      await service.applyPaymentOutcome(makeOutcome());

      expect(ordersRepository.findOneBy).toHaveBeenCalledWith({
        stripeCheckoutSessionId: 'cs_test_1',
      });
      expect(ordersRepository.update).toHaveBeenCalledWith(
        { id: 'order-uuid', status: Not(OrderStatus.Paid) },
        {
          status: OrderStatus.Paid,
          stripePaymentIntentId: 'pi_1',
          presentmentAmount: null,
          presentmentCurrency: null,
        },
      );
      expect(log).toHaveBeenCalledWith(
        'evt_1 checkout.session.completed → order #1001 paid',
      );
    });

    it('saves what the customer paid locally with the paid status', async () => {
      await service.applyPaymentOutcome(
        makeOutcome({ presentment: { amount: 20480000, currency: 'pkr' } }),
      );

      expect(ordersRepository.update).toHaveBeenCalledWith(
        { id: 'order-uuid', status: Not(OrderStatus.Paid) },
        {
          status: OrderStatus.Paid,
          stripePaymentIntentId: 'pi_1',
          presentmentAmount: 20480000,
          presentmentCurrency: 'pkr',
        },
      );
    });

    it('checks the order currency, never the local one', async () => {
      // A converted payment still has to match the USD total to be paid.
      await service.applyPaymentOutcome(
        makeOutcome({
          amountTotal: 1,
          presentment: { amount: 72600, currency: 'pkr' },
        }),
      );

      expect(ordersRepository.update).not.toHaveBeenCalled();
    });

    it('sends the confirmation email when the order becomes paid', async () => {
      await service.applyPaymentOutcome(makeOutcome());

      expect(orderEmailsService.sendConfirmation).toHaveBeenCalledTimes(1);
      expect(orderEmailsService.sendConfirmation).toHaveBeenCalledWith(
        'order-uuid',
      );
    });

    it('does not wait for the email before answering the webhook', async () => {
      // An email that never finishes must not hold up the Stripe response.
      orderEmailsService.sendConfirmation.mockReturnValue(
        new Promise(() => {}),
      );

      await expect(
        service.applyPaymentOutcome(makeOutcome()),
      ).resolves.toBeUndefined();
    });

    it('treats a duplicate paid event as a no-op', async () => {
      ordersRepository.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.applyPaymentOutcome(makeOutcome()),
      ).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith(
        'evt_1 checkout.session.completed → order #1001 already paid (duplicate)',
      );
      expect(orderEmailsService.sendConfirmation).not.toHaveBeenCalled();
    });

    it('sends no email for a failed or expired payment', async () => {
      await service.applyPaymentOutcome(
        makeOutcome({
          eventType: 'checkout.session.expired',
          result: 'failed',
          paymentIntentId: null,
        }),
      );

      expect(orderEmailsService.sendConfirmation).not.toHaveBeenCalled();
    });

    it('fails only pending orders, so a paid order is never reverted', async () => {
      ordersRepository.update.mockResolvedValue({ affected: 0 });

      await service.applyPaymentOutcome(
        makeOutcome({
          eventType: 'checkout.session.expired',
          result: 'failed',
          paymentIntentId: null,
        }),
      );

      expect(ordersRepository.update).toHaveBeenCalledWith(
        { id: 'order-uuid', status: OrderStatus.Pending },
        { status: OrderStatus.Failed },
      );
      expect(log).toHaveBeenCalledWith(
        'evt_1 checkout.session.expired → order #1001 not pending, unchanged',
      );
    });

    it.each([
      ['amount', { amountTotal: 1 }],
      ['currency', { currency: 'eur' }],
    ])(
      'does not mark paid on a %s mismatch',
      async (_label, overrides: Partial<PaymentOutcome>) => {
        await service.applyPaymentOutcome(makeOutcome(overrides));

        expect(ordersRepository.update).not.toHaveBeenCalled();
        expect(orderEmailsService.sendConfirmation).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith(
          expect.stringContaining('mismatch for order #1001'),
        );
      },
    );

    it('ignores a session that belongs to no order', async () => {
      ordersRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.applyPaymentOutcome(makeOutcome()),
      ).resolves.toBeUndefined();
      expect(ordersRepository.update).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        'evt_1 checkout.session.completed → no order for session cs_test_1',
      );
    });
  });

  describe('markShipped', () => {
    const SENT_AT = new Date('2026-11-25T09:05:00Z');
    const unshipped = {
      id: 'order-uuid',
      orderNumber: 1011,
      status: OrderStatus.Paid,
      shippedAt: null,
      shippingEmailSentAt: null,
    };

    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
      orderEmailsService.sendShipped.mockResolvedValue(SENT_AT);
    });

    it('looks up paid orders only and 404s otherwise', async () => {
      ordersRepository.findOneBy.mockResolvedValue(null);

      await expect(service.markShipped('order-uuid')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(ordersRepository.findOneBy).toHaveBeenCalledWith({
        id: 'order-uuid',
        status: OrderStatus.Paid,
      });
      expect(ordersRepository.update).not.toHaveBeenCalled();
      expect(orderEmailsService.sendShipped).not.toHaveBeenCalled();
    });

    it('sets shipped_at once (paid and not yet shipped) and emails', async () => {
      ordersRepository.findOneBy.mockResolvedValue(unshipped);

      const result = await service.markShipped('order-uuid');

      const [where, values] = ordersRepository.update.mock.calls[0] as [
        object,
        { shippedAt: Date },
      ];
      expect(where).toEqual({
        id: 'order-uuid',
        status: OrderStatus.Paid,
        shippedAt: IsNull(),
      });
      expect(values.shippedAt).toBeInstanceOf(Date);
      // Payment status is never part of the update.
      expect(values).not.toHaveProperty('status');
      expect(orderEmailsService.sendShipped).toHaveBeenCalledWith('order-uuid');
      expect(result).toEqual({
        shippedAt: values.shippedAt,
        shippingEmailSentAt: SENT_AT,
        emailSent: true,
      });
    });

    it('keeps the first shipping date and only resends the email', async () => {
      const shippedAt = new Date('2026-11-24T08:00:00Z');
      ordersRepository.findOneBy.mockResolvedValue({ ...unshipped, shippedAt });

      const result = await service.markShipped('order-uuid');

      expect(ordersRepository.update).not.toHaveBeenCalled();
      expect(orderEmailsService.sendShipped).toHaveBeenCalledTimes(1);
      expect(result.shippedAt).toBe(shippedAt);
    });

    it('uses the saved date when a parallel click shipped it first', async () => {
      const shippedAt = new Date('2026-11-24T08:00:00Z');
      ordersRepository.findOneBy
        .mockResolvedValueOnce(unshipped)
        .mockResolvedValueOnce({ ...unshipped, shippedAt });
      ordersRepository.update.mockResolvedValue({ affected: 0 });

      const result = await service.markShipped('order-uuid');

      expect(result.shippedAt).toBe(shippedAt);
    });

    it('stays shipped and reports emailSent false when the email fails', async () => {
      const earlier = new Date('2026-11-24T08:01:00Z');
      ordersRepository.findOneBy.mockResolvedValue({
        ...unshipped,
        shippedAt: new Date('2026-11-24T08:00:00Z'),
        shippingEmailSentAt: earlier,
      });
      orderEmailsService.sendShipped.mockResolvedValue(null);

      const result = await service.markShipped('order-uuid');

      expect(result.emailSent).toBe(false);
      expect(result.shippingEmailSentAt).toBe(earlier);
    });
  });

  describe('findById', () => {
    it('loads the order with its items', async () => {
      const order = { id: 'order-uuid', items: [] };
      ordersRepository.findOne.mockResolvedValue(order);

      await expect(service.findById('order-uuid')).resolves.toBe(order);
      expect(ordersRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'order-uuid' },
        relations: { items: true },
        order: { items: { id: 'ASC' } },
      });
    });

    it('throws NotFoundException for an unknown id', async () => {
      ordersRepository.findOne.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findActiveDiscount', () => {
    it('trims and uppercases the code', async () => {
      const discount = { code: 'SAVE500' };
      discountCodesRepository.findOneBy.mockResolvedValue(discount);

      await expect(service.findActiveDiscount('  save500 ')).resolves.toBe(
        discount,
      );
      expect(discountCodesRepository.findOneBy).toHaveBeenCalledWith({
        code: 'SAVE500',
        active: true,
      });
    });

    it('throws the same 400 for unknown and inactive codes', async () => {
      discountCodesRepository.findOneBy.mockResolvedValue(null);

      await expect(service.findActiveDiscount('NOPE')).rejects.toThrow(
        new BadRequestException('Invalid discount code'),
      );
    });
  });
});
