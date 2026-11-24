import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderReportsService, toSafeInteger } from './order-reports.service';

type QueryCall = [sql: string, params: unknown[]];

const orderRow = {
  id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  order_number: 1001,
  created_at: new Date('2026-11-01T10:00:00Z'),
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'Ada@Example.com',
  country: 'Pakistan',
  item_count: '3',
  total: 32670,
  currency: 'usd',
};

const customerRow = {
  email: 'Ada@Example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  phone: '+92 300 0000000',
  address: '1 Main St',
  apartment: null,
  city: 'Lahore',
  postal_code: null,
  country: 'Pakistan',
  currency: 'usd',
  order_count: '2',
  total_spent: '65340',
  first_order_at: new Date('2026-10-01T00:00:00Z'),
  last_order_at: new Date('2026-11-01T10:00:00Z'),
};

describe('OrderReportsService', () => {
  let service: OrderReportsService;
  const repository = { query: jest.fn(), findOne: jest.fn() };

  function queryCalls(): QueryCall[] {
    return repository.query.mock.calls as QueryCall[];
  }

  // Answers by statement: COUNT queries get a count, others get `rows`.
  function answerWith(rows: unknown[], count = rows.length) {
    repository.query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('COUNT(*) AS count') ? [{ count: String(count) }] : rows,
      ),
    );
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderReportsService,
        { provide: getRepositoryToken(Order), useValue: repository },
      ],
    }).compile();
    service = moduleRef.get(OrderReportsService);
  });

  describe('listPaidOrders', () => {
    it('queries paid orders only and maps rows (bigint strings → numbers)', async () => {
      answerWith([orderRow], 41);

      const page = await service.listPaidOrders({
        sort: '-createdAt',
        page: 3,
        limit: 20,
      });

      expect(page).toEqual({
        items: [
          {
            id: orderRow.id,
            orderNumber: 1001,
            createdAt: orderRow.created_at,
            customerName: 'Ada Lovelace',
            email: 'Ada@Example.com',
            country: 'Pakistan',
            itemCount: 3,
            total: 32670,
            currency: 'usd',
          },
        ],
        page: 3,
        limit: 20,
        total: 41,
      });
      const [[countSql, countParams], [listSql, listParams]] = queryCalls();
      expect(countSql).toContain('o.status = $1');
      expect(listSql).toContain('o.status = $1');
      // The count gets only filter params; LIMIT/OFFSET only in the list.
      expect(countParams).toEqual([OrderStatus.Paid]);
      expect(listParams).toEqual([OrderStatus.Paid, 20, 40]);
      expect(listSql).toContain('ORDER BY o.created_at DESC, o.id ASC');
      expect(listSql).toContain('LIMIT $2 OFFSET $3');
    });

    it('binds every filter as a parameter, never into the SQL text', async () => {
      answerWith([]);

      await service.listPaidOrders({
        email: "x'; DROP TABLE orders; --@example.com",
        orderNumber: 1005,
        from: '2026-11-01',
        to: '2026-11-13',
        sort: 'total',
        page: 1,
        limit: 10,
      });

      const [[countSql, countParams], [listSql, listParams]] = queryCalls();
      expect(countSql).not.toContain('DROP TABLE');
      expect(listSql).not.toContain('DROP TABLE');
      expect(countParams).toEqual([
        OrderStatus.Paid,
        "x'; DROP TABLE orders; --@example.com",
        1005,
        '2026-11-01',
        '2026-11-13',
      ]);
      expect(listParams).toEqual([...countParams, 10, 0]);
      expect(countSql).toContain('lower(o.email) = lower($2)');
      expect(countSql).toContain('o.order_number = $3');
      expect(listSql).toContain('ORDER BY o.total ASC, o.id ASC');
    });

    it('treats dates as whole UTC days, including the full "to" day', async () => {
      answerWith([]);

      await service.listPaidOrders({
        from: '2026-11-01',
        to: '2026-11-13',
        sort: '-createdAt',
        page: 1,
        limit: 20,
      });

      const [[countSql]] = queryCalls();
      expect(countSql).toContain(
        `o.created_at >= ($2::date)::timestamp AT TIME ZONE 'UTC'`,
      );
      expect(countSql).toContain(
        `o.created_at < ($3::date + 1)::timestamp AT TIME ZONE 'UTC'`,
      );
    });

    it('rejects "from" after "to" without querying', async () => {
      await expect(
        service.listPaidOrders({
          from: '2026-11-14',
          to: '2026-11-13',
          sort: '-createdAt',
          page: 1,
          limit: 20,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.query).not.toHaveBeenCalled();
    });

    it.each([
      ['orderNumber', 'o.order_number ASC'],
      ['-orderNumber', 'o.order_number DESC'],
      ['-total', 'o.total DESC'],
      ['createdAt', 'o.created_at ASC'],
    ] as const)('maps sort "%s" to %s', async (sort, expected) => {
      answerWith([]);

      await service.listPaidOrders({ sort, page: 1, limit: 20 });
      expect(queryCalls()[1][0]).toContain(`ORDER BY ${expected}, o.id ASC`);
    });
  });

  describe('findPaidOrder', () => {
    it('only finds paid orders, with items in a stable order', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findPaidOrder(orderRow.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: orderRow.id, status: OrderStatus.Paid },
        relations: { items: true },
        order: { items: { id: 'ASC' } },
      });
    });

    it('returns the full order without internal item ids', async () => {
      repository.findOne.mockResolvedValue({
        id: orderRow.id,
        orderNumber: 1001,
        status: OrderStatus.Paid,
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: null,
        address: '1 Main St',
        apartment: 'Flat 2',
        city: 'Lahore',
        postalCode: '54000',
        country: 'Pakistan',
        subtotal: 36300,
        discountCode: 'WELCOME10',
        discountAmount: 3630,
        shipping: 0,
        total: 32670,
        currency: 'usd',
        stripeCheckoutSessionId: 'cs_test_1',
        stripePaymentIntentId: 'pi_test_1',
        createdAt: new Date('2026-11-01'),
        updatedAt: new Date('2026-11-01'),
        items: [
          {
            id: 9,
            slug: 'neck-pillow-2-0',
            name: 'Neck Pillow 2.0',
            unitPrice: 36300,
            quantity: 1,
            lineTotal: 36300,
          },
        ],
      });

      const detail = await service.findPaidOrder(orderRow.id);
      expect(detail.items).toEqual([
        {
          slug: 'neck-pillow-2-0',
          name: 'Neck Pillow 2.0',
          unitPrice: 36300,
          quantity: 1,
          lineTotal: 36300,
        },
      ]);
      expect(detail.delivery).toEqual({
        address: '1 Main St',
        apartment: 'Flat 2',
        city: 'Lahore',
        postalCode: '54000',
        country: 'Pakistan',
      });
      expect(detail.stripe).toEqual({
        checkoutSessionId: 'cs_test_1',
        paymentIntentId: 'pi_test_1',
      });
      expect(detail.total).toBe(32670);
    });
  });

  describe('listCustomers', () => {
    it('groups paid orders by lower(email) and maps totals to numbers', async () => {
      answerWith([customerRow], 1);

      const page = await service.listCustomers({
        sort: '-lastOrderAt',
        page: 1,
        limit: 20,
      });

      expect(page.items).toEqual([
        {
          email: 'Ada@Example.com',
          name: 'Ada Lovelace',
          country: 'Pakistan',
          orderCount: 2,
          totalSpent: 65340,
          currency: 'usd',
          firstOrderAt: customerRow.first_order_at,
          lastOrderAt: customerRow.last_order_at,
        },
      ]);
      expect(page.total).toBe(1);
      const [[countSql, countParams], [listSql, listParams]] = queryCalls();
      expect(countSql).toContain('WHERE status = $1');
      expect(countSql).toContain('GROUP BY lower(email)');
      expect(countParams).toEqual([OrderStatus.Paid]);
      expect(listParams).toEqual([OrderStatus.Paid, 20, 0]);
      expect(listSql).toContain('ORDER BY t.last_order_at DESC, t.key ASC');
      expect(listSql).toContain('LIMIT $2 OFFSET $3');
    });

    it('searches email or name with LIKE wildcards escaped', async () => {
      answerWith([]);

      await service.listCustomers({
        search: '50%_ada',
        sort: 'totalSpent',
        page: 2,
        limit: 10,
      });

      const [[countSql, countParams], [listSql, listParams]] = queryCalls();
      expect(countSql).toContain('l.key ILIKE $2');
      expect(countParams).toEqual([OrderStatus.Paid, '%50\\%\\_ada%']);
      expect(listParams).toEqual([OrderStatus.Paid, '%50\\%\\_ada%', 10, 10]);
      expect(listSql).toContain('LIMIT $3 OFFSET $4');
      expect(listSql).toContain('ORDER BY t.total_spent ASC');
    });
  });

  describe('findCustomer', () => {
    it('returns the summary, latest contact details and paid orders', async () => {
      repository.query.mockImplementation((sql: string) => {
        if (sql.includes('t.key = lower($2)'))
          return Promise.resolve([customerRow]);
        if (sql.includes('COUNT(*) AS count'))
          return Promise.resolve([{ count: '1' }]);
        return Promise.resolve([orderRow]);
      });

      const detail = await service.findCustomer('ada@example.com', {
        page: 1,
        limit: 20,
      });

      expect(detail.customer).toMatchObject({
        email: 'Ada@Example.com',
        orderCount: 2,
        totalSpent: 65340,
        phone: '+92 300 0000000',
        latestAddress: { city: 'Lahore', country: 'Pakistan' },
      });
      expect(detail.orders.total).toBe(1);
      expect(queryCalls()[0][1]).toEqual([OrderStatus.Paid, 'ada@example.com']);
      // The order list is filtered by the same email.
      expect(queryCalls()[1][1]).toEqual([OrderStatus.Paid, 'ada@example.com']);
    });

    it('returns 404 when the email has no paid orders', async () => {
      repository.query.mockResolvedValue([]);

      await expect(
        service.findCustomer('nobody@example.com', { page: 1, limit: 20 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getStats', () => {
    it('computes dashboard numbers from paid orders', async () => {
      repository.query.mockImplementation((sql: string) => {
        if (sql.includes('AS paid_orders')) {
          return Promise.resolve([
            {
              paid_orders: '4',
              paid_orders_30d: '3',
              revenue: '100001',
              revenue_30d: '75000',
              customers: '2',
            },
          ]);
        }
        if (sql.includes('AS quantity_sold')) {
          return Promise.resolve([
            {
              slug: 'neck-pillow-2-0',
              name: 'Neck Pillow 2.0',
              quantity_sold: '5',
              revenue: '181500',
            },
          ]);
        }
        if (sql.includes('COUNT(*) AS count'))
          return Promise.resolve([{ count: '1' }]);
        return Promise.resolve([orderRow]);
      });

      const stats = await service.getStats();

      expect(stats).toMatchObject({
        paidOrders: 4,
        paidOrdersLast30Days: 3,
        customers: 2,
        revenue: 100001,
        revenueLast30Days: 75000,
        averageOrderValue: 25000, // round(100001 / 4)
        topProducts: [
          {
            slug: 'neck-pillow-2-0',
            name: 'Neck Pillow 2.0',
            quantitySold: 5,
            revenue: 181500,
          },
        ],
      });
      expect(stats.recentOrders).toHaveLength(1);
      for (const [, params] of queryCalls()) {
        expect(params[0]).toBe(OrderStatus.Paid);
      }
    });

    it('reports an average of 0 when there are no paid orders', async () => {
      repository.query.mockImplementation((sql: string) => {
        if (sql.includes('AS paid_orders')) {
          return Promise.resolve([
            {
              paid_orders: '0',
              paid_orders_30d: '0',
              revenue: '0',
              revenue_30d: '0',
              customers: '0',
            },
          ]);
        }
        if (sql.includes('COUNT(*) AS count'))
          return Promise.resolve([{ count: '0' }]);
        return Promise.resolve([]);
      });

      await expect(service.getStats()).resolves.toMatchObject({
        paidOrders: 0,
        averageOrderValue: 0,
        recentOrders: [],
        topProducts: [],
      });
    });
  });
});

describe('toSafeInteger', () => {
  it.each([
    ['42', 42],
    [42, 42],
    ['0', 0],
    ['9007199254740991', 9007199254740991],
  ] as const)('converts %p', (input, expected) => {
    expect(toSafeInteger(input)).toBe(expected);
  });

  it.each(['9007199254740993', '12.5', 'abc', ''])(
    'refuses %p instead of showing a wrong number',
    (input) => {
      expect(() => toSafeInteger(input)).toThrow('safe integer');
    },
  );
});
