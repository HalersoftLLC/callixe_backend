import {
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';
import { PaymentOutcome, PaymentsService } from '../payments/payments.service';
import { Product } from '../products/entities/product.entity';
import { ProductsService } from '../products/products.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { DiscountCode, DiscountType } from './entities/discount-code.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderEmailsService } from './order-emails.service';
import { OrdersService } from './orders.service';

const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_1';

function makeProduct(slug: string, price: number, name = slug): Product {
  return {
    id: 1,
    slug,
    name,
    price,
    compareAtPrice: null,
    description: null,
    badge: null,
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
    ...overrides,
  };
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
  const paymentsService = { createCheckoutSession: jest.fn() };
  const orderEmailsService = { sendConfirmation: jest.fn() };
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
    paymentsService.createCheckoutSession.mockResolvedValue({
      id: 'cs_test_1',
      url: CHECKOUT_URL,
    });
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

      const { order } = await service.create(makeDto());

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
          lineTotal: 72600,
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

      const { order } = await service.create(
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

    it('creates a Checkout Session after saving and stores its id', async () => {
      productsService.findActiveBySlugs.mockResolvedValue([
        makeProduct('neck-pillow-2-0', 36300, 'Neck Pillow 2.0'),
      ]);

      const result = await service.create(makeDto());

      expect(result.checkoutUrl).toBe(CHECKOUT_URL);
      expect(paymentsService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'order-uuid',
          total: 72600,
          items: [expect.objectContaining({ unitPrice: 36300, quantity: 2 })],
        }),
      );
      // Stripe is called only after the transaction has committed.
      expect(dataSource.transaction.mock.invocationCallOrder[0]).toBeLessThan(
        paymentsService.createCheckoutSession.mock.invocationCallOrder[0],
      );
      expect(ordersRepository.update).toHaveBeenCalledWith(
        { id: 'order-uuid' },
        { stripeCheckoutSessionId: 'cs_test_1' },
      );
    });

    it('marks the order failed and returns 503 when Stripe fails', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      productsService.findActiveBySlugs.mockResolvedValue([
        makeProduct('neck-pillow-2-0', 36300),
      ]);
      paymentsService.createCheckoutSession.mockRejectedValue(
        new Error('Stripe down'),
      );

      await expect(service.create(makeDto())).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(ordersRepository.update).toHaveBeenCalledWith(
        { id: 'order-uuid' },
        { status: OrderStatus.Failed },
      );
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
        { status: OrderStatus.Paid, stripePaymentIntentId: 'pi_1' },
      );
      expect(log).toHaveBeenCalledWith(
        'evt_1 checkout.session.completed → order #1001 paid',
      );
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
