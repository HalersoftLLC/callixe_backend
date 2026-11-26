import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { escapeLikePattern, type Page } from '../products/products.service';
import { toPresentmentResponse } from './dto/order-response.dto';
import { Order, OrderStatus } from './entities/order.entity';

// Read-only reports for the admin panel. Kept apart from OrdersService, which
// handles checkout and the Stripe webhook (money-critical writes), so report
// changes can never touch those paths.
//
// Rules for every query here:
// - only paid orders (status = 'paid'); pending/failed orders never appear;
// - every user value is a bound parameter ($1, $2, …); sort columns come
//   from fixed maps, never from user text;
// - all counting and summing happens in SQL.

export const ORDER_SORT_OPTIONS = [
  'createdAt',
  '-createdAt',
  'total',
  '-total',
  'orderNumber',
  '-orderNumber',
] as const;
export type OrderSort = (typeof ORDER_SORT_OPTIONS)[number];

export const CUSTOMER_SORT_OPTIONS = [
  'lastOrderAt',
  '-lastOrderAt',
  'totalSpent',
  '-totalSpent',
  'orderCount',
  '-orderCount',
] as const;
export type CustomerSort = (typeof CUSTOMER_SORT_OPTIONS)[number];

export interface PaidOrderListOptions {
  email?: string;
  orderNumber?: number;
  shipped?: boolean;
  from?: string; // YYYY-MM-DD, UTC, inclusive
  to?: string; // YYYY-MM-DD, UTC, inclusive (whole day)
  sort: OrderSort;
  page: number;
  limit: number;
}

export interface CustomerListOptions {
  search?: string;
  sort: CustomerSort;
  page: number;
  limit: number;
}

export interface AdminOrderListItem {
  id: string;
  orderNumber: number;
  createdAt: Date;
  customerName: string;
  email: string;
  country: string;
  itemCount: number;
  total: number;
  currency: string;
  // Display only (Stripe Adaptive Pricing): what the customer paid locally.
  presentment: Presentment | null;
  shippedAt: Date | null;
}

export interface Presentment {
  amount: number;
  currency: string;
}

export interface AdminOrderDetail {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  customer: {
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
  };
  delivery: {
    address: string;
    apartment: string | null;
    city: string;
    postalCode: string | null;
    country: string;
  };
  items: {
    slug: string;
    name: string;
    unitPrice: number;
    quantity: number;
    dealDiscount: number;
    lineTotal: number;
  }[];
  subtotal: number;
  discountCode: string | null;
  discountAmount: number;
  shipping: number;
  total: number;
  currency: string;
  presentment: Presentment | null;
  stripe: {
    checkoutSessionId: string | null;
    paymentIntentId: string | null;
  };
  // Admin "Mark as shipped" (not the shipping price above).
  fulfillment: {
    shippedAt: Date | null;
    emailSentAt: Date | null;
  };
}

export interface AdminCustomerSummary {
  email: string; // as typed on the latest paid order
  name: string;
  country: string;
  orderCount: number;
  totalSpent: number;
  currency: string;
  firstOrderAt: Date;
  lastOrderAt: Date;
}

export interface AdminCustomerDetail {
  customer: AdminCustomerSummary & {
    phone: string | null;
    latestAddress: AdminOrderDetail['delivery'];
  };
  orders: Page<AdminOrderListItem>;
}

export interface OrderStats {
  paidOrders: number;
  paidOrdersLast30Days: number;
  customers: number;
  revenue: number;
  revenueLast30Days: number;
  averageOrderValue: number;
  recentOrders: AdminOrderListItem[];
  topProducts: {
    slug: string;
    name: string;
    quantitySold: number;
    revenue: number;
  }[];
}

const ORDER_SORT_COLUMNS: Record<string, string> = {
  createdAt: 'o.created_at',
  total: 'o.total',
  orderNumber: 'o.order_number',
};

const CUSTOMER_SORT_COLUMNS: Record<string, string> = {
  lastOrderAt: 't.last_order_at',
  totalSpent: 't.total_spent',
  orderCount: 't.order_count',
};

const RECENT_ORDERS = 5;
const TOP_PRODUCTS = 5;

// Paid orders grouped per customer (case-insensitive email): totals from
// every paid order, contact details from the latest one. $1 = 'paid'.
const CUSTOMERS_CTE = `
  WITH paid AS (
    SELECT * FROM orders WHERE status = $1
  ),
  totals AS (
    SELECT lower(email) AS key,
           COUNT(*) AS order_count,
           SUM(total) AS total_spent,
           MIN(created_at) AS first_order_at,
           MAX(created_at) AS last_order_at
    FROM paid
    GROUP BY lower(email)
  ),
  latest AS (
    SELECT DISTINCT ON (lower(email))
           lower(email) AS key, email, first_name, last_name, phone,
           address, apartment, city, postal_code, country, currency
    FROM paid
    ORDER BY lower(email), created_at DESC, id DESC
  )`;

interface OrderListRow {
  id: string;
  order_number: number;
  created_at: Date;
  first_name: string;
  last_name: string;
  email: string;
  country: string;
  item_count: string | number;
  total: number;
  currency: string;
  presentment_amount: number | null;
  presentment_currency: string | null;
  shipped_at: Date | null;
}

interface CustomerRow {
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  address: string;
  apartment: string | null;
  city: string;
  postal_code: string | null;
  country: string;
  currency: string;
  order_count: string | number;
  total_spent: string | number;
  first_order_at: Date;
  last_order_at: Date;
}

interface CountRow {
  count: string | number;
}

interface StatsRow {
  paid_orders: string | number;
  paid_orders_30d: string | number;
  revenue: string | number;
  revenue_30d: string | number;
  customers: string | number;
}

interface TopProductRow {
  slug: string;
  name: string;
  quantity_sold: string | number;
  revenue: string | number;
}

@Injectable()
export class OrderReportsService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
  ) {}

  async listPaidOrders(
    options: PaidOrderListOptions,
  ): Promise<Page<AdminOrderListItem>> {
    const { page, limit } = options;
    const params: unknown[] = [OrderStatus.Paid];
    const conditions = ['o.status = $1'];
    const bind = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (options.email) {
      conditions.push(`lower(o.email) = lower(${bind(options.email)})`);
    }
    if (options.orderNumber !== undefined) {
      conditions.push(`o.order_number = ${bind(options.orderNumber)}`);
    }
    // Fixed SQL, no user text: shipped is already a boolean.
    if (options.shipped !== undefined) {
      conditions.push(
        options.shipped ? 'o.shipped_at IS NOT NULL' : 'o.shipped_at IS NULL',
      );
    }
    if (options.from && options.to && options.from > options.to) {
      throw new BadRequestException('"from" must not be after "to"');
    }
    // Dates are whole UTC days; "to" includes its full day.
    if (options.from) {
      conditions.push(
        `o.created_at >= (${bind(options.from)}::date)::timestamp AT TIME ZONE 'UTC'`,
      );
    }
    if (options.to) {
      conditions.push(
        `o.created_at < (${bind(options.to)}::date + 1)::timestamp AT TIME ZONE 'UTC'`,
      );
    }

    const where = conditions.join(' AND ');
    // The count query gets only the filter parameters: PostgreSQL rejects
    // parameters a statement doesn't use.
    const countParams = [...params];
    const limitParam = bind(limit);
    const offsetParam = bind((page - 1) * limit);

    const [countRows, rows] = await Promise.all([
      this.ordersRepository.query<CountRow[]>(
        `SELECT COUNT(*) AS count FROM orders o WHERE ${where}`,
        countParams,
      ),
      this.ordersRepository.query<OrderListRow[]>(
        `SELECT o.id, o.order_number, o.created_at, o.first_name, o.last_name,
                o.email, o.country, o.total, o.currency,
                o.presentment_amount, o.presentment_currency, o.shipped_at,
                (SELECT COALESCE(SUM(i.quantity), 0)
                   FROM order_items i WHERE i.order_id = o.id) AS item_count
         FROM orders o
         WHERE ${where}
         ORDER BY ${orderBy(options.sort, ORDER_SORT_COLUMNS)}, o.id ASC
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params,
      ),
    ]);

    return {
      items: rows.map(toOrderListItem),
      page,
      limit,
      total: toSafeInteger(countRows[0]?.count ?? 0),
    };
  }

  async findPaidOrder(id: string): Promise<AdminOrderDetail> {
    const order = await this.ordersRepository.findOne({
      where: { id, status: OrderStatus.Paid },
      relations: { items: true },
      order: { items: { id: 'ASC' } },
    });
    // Pending and failed orders are not part of the admin panel: same 404.
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return toOrderDetail(order);
  }

  async listCustomers(
    options: CustomerListOptions,
  ): Promise<Page<AdminCustomerSummary>> {
    const { page, limit } = options;
    const params: unknown[] = [OrderStatus.Paid];
    let where = '';
    if (options.search) {
      params.push(`%${escapeLikePattern(options.search)}%`);
      where = `WHERE l.key ILIKE $2
               OR (l.first_name || ' ' || l.last_name) ILIKE $2`;
    }
    // Filter parameters only, before LIMIT/OFFSET are added (see above).
    const countParams = [...params];
    const limitParam = params.push(limit);
    const offsetParam = params.push((page - 1) * limit);

    const [countRows, rows] = await Promise.all([
      this.ordersRepository.query<CountRow[]>(
        `${CUSTOMERS_CTE}
         SELECT COUNT(*) AS count
         FROM totals t JOIN latest l ON l.key = t.key
         ${where}`,
        countParams,
      ),
      this.ordersRepository.query<CustomerRow[]>(
        `${CUSTOMERS_CTE}
         SELECT l.*, t.order_count, t.total_spent,
                t.first_order_at, t.last_order_at
         FROM totals t JOIN latest l ON l.key = t.key
         ${where}
         ORDER BY ${orderBy(options.sort, CUSTOMER_SORT_COLUMNS)}, t.key ASC
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        params,
      ),
    ]);

    return {
      items: rows.map(toCustomerSummary),
      page,
      limit,
      total: toSafeInteger(countRows[0]?.count ?? 0),
    };
  }

  async findCustomer(
    email: string,
    paging: { page: number; limit: number },
  ): Promise<AdminCustomerDetail> {
    const rows = await this.ordersRepository.query<CustomerRow[]>(
      `${CUSTOMERS_CTE}
       SELECT l.*, t.order_count, t.total_spent,
              t.first_order_at, t.last_order_at
       FROM totals t JOIN latest l ON l.key = t.key
       WHERE t.key = lower($2)`,
      [OrderStatus.Paid, email],
    );
    const row = rows[0];
    // An email with only pending/failed orders is not a customer here.
    if (!row) {
      throw new NotFoundException('Customer not found');
    }

    const orders = await this.listPaidOrders({
      email,
      sort: '-createdAt',
      ...paging,
    });
    return {
      customer: {
        ...toCustomerSummary(row),
        phone: row.phone,
        latestAddress: {
          address: row.address,
          apartment: row.apartment,
          city: row.city,
          postalCode: row.postal_code,
          country: row.country,
        },
      },
      orders,
    };
  }

  async getStats(): Promise<OrderStats> {
    const [statsRows, topRows, recent] = await Promise.all([
      this.ordersRepository.query<StatsRow[]>(
        `SELECT COUNT(*) AS paid_orders,
                COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days') AS paid_orders_30d,
                COALESCE(SUM(total), 0) AS revenue,
                COALESCE(SUM(total) FILTER (WHERE created_at >= now() - interval '30 days'), 0) AS revenue_30d,
                COUNT(DISTINCT lower(email)) AS customers
         FROM orders
         WHERE status = $1`,
        [OrderStatus.Paid],
      ),
      // Name from the most recent sale, in case the product was renamed.
      this.ordersRepository.query<TopProductRow[]>(
        `SELECT i.slug,
                (array_agg(i.name ORDER BY o.created_at DESC))[1] AS name,
                SUM(i.quantity) AS quantity_sold,
                SUM(i.line_total) AS revenue
         FROM order_items i
         JOIN orders o ON o.id = i.order_id
         WHERE o.status = $1
         GROUP BY i.slug
         ORDER BY quantity_sold DESC, revenue DESC, i.slug ASC
         LIMIT $2`,
        [OrderStatus.Paid, TOP_PRODUCTS],
      ),
      this.listPaidOrders({
        sort: '-createdAt',
        page: 1,
        limit: RECENT_ORDERS,
      }),
    ]);

    const stats = statsRows[0];
    const paidOrders = toSafeInteger(stats.paid_orders);
    const revenue = toSafeInteger(stats.revenue);
    return {
      paidOrders,
      paidOrdersLast30Days: toSafeInteger(stats.paid_orders_30d),
      customers: toSafeInteger(stats.customers),
      revenue,
      revenueLast30Days: toSafeInteger(stats.revenue_30d),
      averageOrderValue:
        paidOrders === 0 ? 0 : Math.round(revenue / paidOrders),
      recentOrders: recent.items,
      topProducts: topRows.map((row) => ({
        slug: row.slug,
        name: row.name,
        quantitySold: toSafeInteger(row.quantity_sold),
        revenue: toSafeInteger(row.revenue),
      })),
    };
  }
}

// pg returns COUNT/SUM (bigint) as strings. Money must never be shown wrong,
// so anything that isn't an exact safe integer is an error, not a guess.
export function toSafeInteger(value: string | number): number {
  // Number('') is 0; an empty value must not silently become zero.
  const number =
    typeof value === 'number'
      ? value
      : value.trim() === ''
        ? NaN
        : Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(
      `Expected a safe integer from the database, got "${value}"`,
    );
  }
  return number;
}

function orderBy(sort: string, columns: Record<string, string>): string {
  const direction = sort.startsWith('-') ? 'DESC' : 'ASC';
  const column = columns[sort.replace('-', '')];
  // Unreachable with validated input; guards against a future caller.
  if (!column) {
    throw new BadRequestException(`Unknown sort "${sort}"`);
  }
  return `${column} ${direction}`;
}

function toOrderListItem(row: OrderListRow): AdminOrderListItem {
  return {
    id: row.id,
    orderNumber: row.order_number,
    createdAt: row.created_at,
    customerName: `${row.first_name} ${row.last_name}`,
    email: row.email,
    country: row.country,
    itemCount: toSafeInteger(row.item_count),
    total: row.total,
    currency: row.currency,
    presentment: toPresentmentResponse({
      presentmentAmount: row.presentment_amount,
      presentmentCurrency: row.presentment_currency,
    }),
    shippedAt: row.shipped_at,
  };
}

function toCustomerSummary(row: CustomerRow): AdminCustomerSummary {
  return {
    email: row.email,
    name: `${row.first_name} ${row.last_name}`,
    country: row.country,
    orderCount: toSafeInteger(row.order_count),
    totalSpent: toSafeInteger(row.total_spent),
    currency: row.currency,
    firstOrderAt: row.first_order_at,
    lastOrderAt: row.last_order_at,
  };
}

function toOrderDetail(order: Order): AdminOrderDetail {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    customer: {
      email: order.email,
      firstName: order.firstName,
      lastName: order.lastName,
      phone: order.phone,
    },
    delivery: {
      address: order.address,
      apartment: order.apartment,
      city: order.city,
      postalCode: order.postalCode,
      country: order.country,
    },
    // Snapshot from order time (CLAUDE.md 7.1); no ids.
    items: order.items.map((item) => ({
      slug: item.slug,
      name: item.name,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      dealDiscount: item.dealDiscount,
      lineTotal: item.lineTotal,
    })),
    subtotal: order.subtotal,
    discountCode: order.discountCode,
    discountAmount: order.discountAmount,
    shipping: order.shipping,
    total: order.total,
    currency: order.currency,
    presentment: toPresentmentResponse(order),
    stripe: {
      checkoutSessionId: order.stripeCheckoutSessionId,
      paymentIntentId: order.stripePaymentIntentId,
    },
    fulfillment: {
      shippedAt: order.shippedAt,
      emailSentAt: order.shippingEmailSentAt,
    },
  };
}
