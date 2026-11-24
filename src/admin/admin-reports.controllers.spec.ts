import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { OrderReportsService } from '../orders/order-reports.service';
import { ProductsService } from '../products/products.service';
import { AdminCustomersController } from './admin-customers.controller';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminGuard } from './admin.guard';
import {
  CustomerDetailQueryDto,
  ListCustomersQueryDto,
  ListOrdersQueryDto,
} from './dto/order-report-dtos';

const ORDER_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('Admin report controllers', () => {
  let ordersController: AdminOrdersController;
  let customersController: AdminCustomersController;
  let dashboardController: AdminDashboardController;
  const orderReportsService = {
    listPaidOrders: jest.fn(),
    findPaidOrder: jest.fn(),
    listCustomers: jest.fn(),
    findCustomer: jest.fn(),
    getStats: jest.fn(),
  };
  const productsService = { countByActive: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [
        AdminOrdersController,
        AdminCustomersController,
        AdminDashboardController,
      ],
      providers: [
        AdminDashboardService,
        { provide: OrderReportsService, useValue: orderReportsService },
        { provide: ProductsService, useValue: productsService },
        AdminGuard,
        { provide: JwtService, useValue: {} },
      ],
    }).compile();

    ordersController = moduleRef.get(AdminOrdersController);
    customersController = moduleRef.get(AdminCustomersController);
    dashboardController = moduleRef.get(AdminDashboardController);
  });

  it.each([
    ['orders', AdminOrdersController],
    ['customers', AdminCustomersController],
    ['dashboard', AdminDashboardController],
  ])('protects every %s route with AdminGuard', (_name, controller) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([
      AdminGuard,
    ]);
  });

  it('GET /admin/orders passes the filters through', async () => {
    const page = { items: [], page: 1, limit: 20, total: 0 };
    orderReportsService.listPaidOrders.mockResolvedValue(page);
    const query = {
      email: 'ada@example.com',
      sort: '-createdAt' as const,
      page: 1,
      limit: 20,
    };

    await expect(ordersController.list(query)).resolves.toBe(page);
    expect(orderReportsService.listPaidOrders).toHaveBeenCalledWith(query);
  });

  it('GET /admin/orders/:id returns one paid order', async () => {
    const detail = { id: ORDER_ID };
    orderReportsService.findPaidOrder.mockResolvedValue(detail);

    await expect(ordersController.findOne(ORDER_ID)).resolves.toBe(detail);
    expect(orderReportsService.findPaidOrder).toHaveBeenCalledWith(ORDER_ID);
  });

  it('GET /admin/customers/detail passes the email and paging', async () => {
    orderReportsService.findCustomer.mockResolvedValue({});

    await customersController.detail({
      email: 'ada@example.com',
      page: 2,
      limit: 10,
    });
    expect(orderReportsService.findCustomer).toHaveBeenCalledWith(
      'ada@example.com',
      { page: 2, limit: 10 },
    );
  });

  it('GET /admin/dashboard combines product counts and order stats', async () => {
    productsService.countByActive.mockResolvedValue({
      total: 7,
      active: 6,
      inactive: 1,
    });
    orderReportsService.getStats.mockResolvedValue({
      paidOrders: 4,
      paidOrdersLast30Days: 3,
      customers: 2,
      revenue: 100001,
      revenueLast30Days: 75000,
      averageOrderValue: 25000,
      recentOrders: [],
      topProducts: [],
    });

    await expect(dashboardController.get()).resolves.toEqual({
      products: { total: 7, active: 6, inactive: 1 },
      orders: { paid: 4, paidLast30Days: 3 },
      customers: { total: 2 },
      revenue: { total: 100001, last30Days: 75000, averageOrderValue: 25000 },
      recentOrders: [],
      topProducts: [],
    });
  });
});

// Same options as the global ValidationPipe; query values arrive as text.
function validate<T extends object>(cls: new () => T, query: object) {
  const dto = plainToInstance(cls, query);
  return {
    dto,
    errors: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }),
  };
}

describe('report query DTOs', () => {
  it('ListOrdersQueryDto applies defaults and converts text', () => {
    const { dto, errors } = validate(ListOrdersQueryDto, {
      email: ' Ada@Example.com ',
      orderNumber: '1005',
      from: '2026-11-01',
      to: '2026-11-13',
    });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({
      email: 'Ada@Example.com',
      orderNumber: 1005,
      sort: '-createdAt',
      page: 1,
      limit: 20,
    });
  });

  it.each([
    ['an invalid email', { email: 'nope' }],
    ['an order number below 1001', { orderNumber: '1000' }],
    ['a non-numeric order number', { orderNumber: 'abc' }],
    ['a date with a time', { from: '2026-11-01T00:00:00Z' }],
    ['an impossible date', { to: '2026-02-30' }],
    ['a non-date', { from: 'yesterday' }],
    ['an unknown sort', { sort: 'email' }],
    ['an unknown parameter', { status: 'pending' }],
  ])('ListOrdersQueryDto rejects %s', (_case, query) => {
    expect(validate(ListOrdersQueryDto, query).errors.length).toBeGreaterThan(
      0,
    );
  });

  it('ListCustomersQueryDto defaults to most recent customers first', () => {
    const { dto, errors } = validate(ListCustomersQueryDto, {});
    expect(errors).toHaveLength(0);
    expect(dto.sort).toBe('-lastOrderAt');
  });

  it.each([
    ['an unknown sort', { sort: 'email' }],
    ['a 101-character search', { search: 'a'.repeat(101) }],
  ])('ListCustomersQueryDto rejects %s', (_case, query) => {
    expect(
      validate(ListCustomersQueryDto, query).errors.length,
    ).toBeGreaterThan(0);
  });

  it('CustomerDetailQueryDto requires a valid email', () => {
    expect(validate(CustomerDetailQueryDto, {}).errors.length).toBeGreaterThan(
      0,
    );
    expect(
      validate(CustomerDetailQueryDto, { email: 'x' }).errors.length,
    ).toBeGreaterThan(0);
    expect(
      validate(CustomerDetailQueryDto, { email: 'ada@example.com' }).errors,
    ).toHaveLength(0);
  });
});
