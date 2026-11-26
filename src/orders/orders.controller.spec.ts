import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { CreateOrderDto } from './dto/create-order.dto';
import { DiscountType } from './entities/discount-code.entity';
import { Order, OrderStatus } from './entities/order.entity';
import { DiscountsController } from './discounts.controller';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

const order = {
  id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  orderNumber: 1001,
  email: 'customer@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  address: '1 Main St',
  apartment: null,
  city: 'Lahore',
  postalCode: null,
  country: 'Pakistan',
  phone: '+92 300 0000000',
  subtotal: 36300,
  discountCode: 'WELCOME10',
  discountAmount: 3630,
  shipping: 0,
  total: 32670,
  currency: 'usd',
  presentmentAmount: null,
  presentmentCurrency: null,
  status: OrderStatus.Pending,
  stripePaymentIntentId: 'pi_secret_internal',
  stripeCheckoutSessionId: 'cs_secret_internal',
  items: [
    {
      id: 1,
      slug: 'neck-pillow-2-0',
      name: 'Neck Pillow 2.0',
      unitPrice: 36300,
      quantity: 1,
      dealDiscount: 0,
      lineTotal: 36300,
    },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Order;

describe('Orders controllers', () => {
  let ordersController: OrdersController;
  let discountsController: DiscountsController;
  const ordersService = {
    create: jest.fn(),
    findById: jest.fn(),
    findActiveDiscount: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      // ThrottlerGuard needs the throttler options to be resolvable.
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 8 }])],
      controllers: [OrdersController, DiscountsController],
      providers: [{ provide: OrdersService, useValue: ordersService }],
    }).compile();

    ordersController = moduleRef.get(OrdersController);
    discountsController = moduleRef.get(DiscountsController);
  });

  it('POST /orders returns orderId, orderNumber, total, and checkoutUrl only', async () => {
    ordersService.create.mockResolvedValue({
      order,
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
    });

    await expect(
      ordersController.create({} as CreateOrderDto),
    ).resolves.toEqual({
      orderId: order.id,
      orderNumber: 1001,
      total: 32670,
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
    });
  });

  it('GET /orders/:id hides phone, Stripe id, and timestamps', async () => {
    ordersService.findById.mockResolvedValue(order);

    const response = await ordersController.findOne(order.id);

    expect(response).toEqual({
      orderId: order.id,
      orderNumber: 1001,
      status: 'pending',
      email: 'customer@example.com',
      delivery: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        address: '1 Main St',
        apartment: null,
        city: 'Lahore',
        postalCode: null,
        country: 'Pakistan',
      },
      items: [
        {
          slug: 'neck-pillow-2-0',
          name: 'Neck Pillow 2.0',
          unitPrice: 36300,
          quantity: 1,
          dealDiscount: 0,
          lineTotal: 36300,
        },
      ],
      subtotal: 36300,
      discountCode: 'WELCOME10',
      discountAmount: 3630,
      shipping: 0,
      total: 32670,
      currency: 'usd',
      presentment: null,
    });
    expect(JSON.stringify(response)).not.toContain('pi_secret_internal');
    expect(JSON.stringify(response)).not.toContain('cs_secret_internal');
    expect(JSON.stringify(response)).not.toContain('+92');
  });

  it('GET /orders/:id includes what the customer paid locally', async () => {
    ordersService.findById.mockResolvedValue({
      ...order,
      status: OrderStatus.Paid,
      presentmentAmount: 9050000,
      presentmentCurrency: 'pkr',
    });

    const response = await ordersController.findOne(order.id);

    expect(response.presentment).toEqual({ amount: 9050000, currency: 'pkr' });
    expect(response.total).toBe(32670);
    expect(response.currency).toBe('usd');
  });

  it('GET /orders/:id passes NotFoundException through', async () => {
    ordersService.findById.mockRejectedValue(new NotFoundException());

    await expect(ordersController.findOne(order.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('POST /discounts/validate returns code, type, and value only', async () => {
    ordersService.findActiveDiscount.mockResolvedValue({
      id: 7,
      code: 'WELCOME10',
      type: DiscountType.Percent,
      value: 10,
      active: true,
    });

    await expect(
      discountsController.validate({ code: 'welcome10' }),
    ).resolves.toEqual({ code: 'WELCOME10', type: 'percent', value: 10 });
    expect(ordersService.findActiveDiscount).toHaveBeenCalledWith('welcome10');
  });
});
