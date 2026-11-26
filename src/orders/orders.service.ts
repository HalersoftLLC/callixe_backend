import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, QueryFailedError, Repository } from 'typeorm';
import { EnvironmentVariables } from '../config/env.validation';
import {
  PaymentOutcome,
  PaymentsService,
  SESSION_CLOSED_MESSAGE,
} from '../payments/payments.service';
import { ProductsService } from '../products/products.service';
import {
  CreateOrderDto,
  CreatePaymentSessionDto,
  OrderItemDto,
} from './dto/create-order.dto';
import { DiscountCode } from './entities/discount-code.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderEmailsService } from './order-emails.service';
import { STANDARD_SHIPPING_PRICE } from './orders.constants';
import {
  calculateDealDiscount,
  calculateLineTotal,
  calculateTotals,
} from './pricing';

// The cart priced from the database: what the session charges and the
// order stores.
interface PricedCart {
  lines: {
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
}

const PAYMENT_UNAVAILABLE_MESSAGE =
  'Payment is temporarily unavailable, please try again';
const CART_CHANGED_MESSAGE =
  'Your cart changed. Please reload checkout and try again.';

// PostgreSQL unique_violation (here: UQ_orders_stripe_checkout_session_id).
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err.driverError as { code?: string } | undefined)?.code === '23505'
  );
}

export interface ShipOrderResult {
  shippedAt: Date;
  // Last successful send (this one, or an earlier one if this one failed).
  shippingEmailSentAt: Date | null;
  emailSent: boolean;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(DiscountCode)
    private readonly discountCodesRepository: Repository<DiscountCode>,
    private readonly productsService: ProductsService,
    private readonly paymentsService: PaymentsService,
    private readonly orderEmailsService: OrderEmailsService,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // Checkout opened: price the cart and create the Stripe session that shows
  // the card form. Nothing is saved; the order is created by `create` when
  // the customer clicks Complete Purchase.
  async createPaymentSession(
    dto: CreatePaymentSessionDto,
  ): Promise<{ sessionId: string; clientSecret: string; total: number }> {
    const cart = await this.priceCart(dto);
    try {
      const session = await this.paymentsService.createPaymentSession({
        currency: cart.currency,
        total: cart.total,
        discountCode: cart.discountCode,
        discountAmount: cart.discountAmount,
        items: cart.lines,
      });
      return {
        sessionId: session.id,
        clientSecret: session.clientSecret,
        total: cart.total,
      };
    } catch (err) {
      this.logger.error(`Checkout session failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(PAYMENT_UNAVAILABLE_MESSAGE);
    }
  }

  // Complete Purchase: saves the pending order against the session the card
  // form was opened with. The session must still be open and charge exactly
  // the re-priced total, so a session made for another cart can't pay for
  // this one. The unique session id means one session pays one order.
  async create(dto: CreateOrderDto): Promise<Order> {
    const session = await this.getOpenSession(dto.paymentSessionId);
    const cart = await this.priceCart(dto);

    const sameCurrency =
      session.currency?.toLowerCase() === cart.currency.toLowerCase();
    if (session.amountTotal !== cart.total || !sameCurrency) {
      throw new ConflictException(CART_CHANGED_MESSAGE);
    }

    let order: Order;
    try {
      order = await this.saveOrder(dto, cart, session.id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(SESSION_CLOSED_MESSAGE);
      }
      throw err;
    }

    // Outside the transaction (network call); never throws.
    await this.paymentsService.linkOrder(session.id, order.id);
    this.logger.log(
      `Order #${order.orderNumber} created for session ${session.id}`,
    );
    return order;
  }

  // 409 for a closed/unknown session passes through; Stripe being down is 503.
  private async getOpenSession(sessionId: string) {
    try {
      return await this.paymentsService.getOpenSession(sessionId);
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      this.logger.error(
        `Checkout session ${sessionId} lookup failed: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(PAYMENT_UNAVAILABLE_MESSAGE);
    }
  }

  // Called by the Stripe webhook. Conditional updates make duplicate and
  // out-of-order events harmless (CLAUDE.md 6.2): paid is set at most once
  // and only a pending order can become failed.
  async applyPaymentOutcome(outcome: PaymentOutcome): Promise<void> {
    const tag = `${outcome.eventId} ${outcome.eventType}`;
    const order = await this.ordersRepository.findOneBy({
      stripeCheckoutSessionId: outcome.sessionId,
    });
    if (!order) {
      this.logger.warn(`${tag} → no order for session ${outcome.sessionId}`);
      return;
    }
    const label = `order #${order.orderNumber}`;

    if (outcome.result === 'paid') {
      const sameCurrency =
        outcome.currency?.toLowerCase() === order.currency.toLowerCase();
      if (outcome.amountTotal !== order.total || !sameCurrency) {
        this.logger.error(
          `${tag} → amount mismatch for ${label} (session ${outcome.amountTotal} ${outcome.currency}, order ${order.total} ${order.currency}); not marked paid`,
        );
        return;
      }
      // presentment_* only records what the customer saw in their own
      // currency (Adaptive Pricing); the check above is on the order currency.
      const { affected } = await this.ordersRepository.update(
        { id: order.id, status: Not(OrderStatus.Paid) },
        {
          status: OrderStatus.Paid,
          stripePaymentIntentId: outcome.paymentIntentId,
          presentmentAmount: outcome.presentment?.amount ?? null,
          presentmentCurrency: outcome.presentment?.currency ?? null,
        },
      );
      this.logger.log(
        affected
          ? `${tag} → ${label} paid`
          : `${tag} → ${label} already paid (duplicate)`,
      );
      // Only the event that actually marked it paid sends the email, so a
      // duplicate event never emails twice. Not awaited: Stripe gets its
      // 2xx without waiting for Brevo, and sendConfirmation never throws.
      if (affected) {
        void this.orderEmailsService.sendConfirmation(order.id);
      }
      return;
    }

    const { affected } = await this.ordersRepository.update(
      { id: order.id, status: OrderStatus.Pending },
      { status: OrderStatus.Failed },
    );
    this.logger.log(
      affected
        ? `${tag} → ${label} failed`
        : `${tag} → ${label} not pending, unchanged`,
    );
  }

  // Admin "Mark as shipped" (and "Resend shipping email"): one call sets
  // shipped_at the first time and emails the customer every time. Only paid
  // orders; payment status itself is never touched here. The email is
  // awaited because the admin is waiting to see whether it went out.
  async markShipped(id: string): Promise<ShipOrderResult> {
    const order = await this.ordersRepository.findOneBy({
      id,
      status: OrderStatus.Paid,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    let shippedAt = order.shippedAt;
    if (!shippedAt) {
      const now = new Date();
      // The condition keeps the first shipping date if two clicks race.
      const { affected } = await this.ordersRepository.update(
        { id, status: OrderStatus.Paid, shippedAt: IsNull() },
        { shippedAt: now },
      );
      if (affected) {
        shippedAt = now;
        this.logger.log(`Order #${order.orderNumber} marked shipped`);
      } else {
        const current = await this.ordersRepository.findOneBy({ id });
        shippedAt = current?.shippedAt ?? now;
      }
    }

    const sentAt = await this.orderEmailsService.sendShipped(id);
    return {
      shippedAt,
      shippingEmailSentAt: sentAt ?? order.shippingEmailSentAt,
      emailSent: sentAt !== null,
    };
  }

  // Prices come only from the database via ProductsService; the request
  // carries slugs and quantities and nothing else (CLAUDE.md section 5).
  private async priceCart(dto: CreatePaymentSessionDto): Promise<PricedCart> {
    this.assertUniqueSlugs(dto.items);

    const slugs = dto.items.map((item) => item.slug);
    const products = await this.productsService.findActiveBySlugs(slugs);
    const productsBySlug = new Map(products.map((p) => [p.slug, p]));

    const unavailable = slugs.filter((slug) => !productsBySlug.has(slug));
    if (unavailable.length > 0) {
      throw new BadRequestException(
        `Unknown or unavailable products: ${unavailable.join(', ')}`,
      );
    }

    const discount = dto.discountCode
      ? await this.findActiveDiscount(dto.discountCode)
      : null;

    const lines = dto.items.map((item) => {
      const product = productsBySlug.get(item.slug)!;
      const dealDiscount = calculateDealDiscount(
        product.price,
        item.quantity,
        product.secondUnitHalfOff,
      );
      return {
        slug: product.slug,
        name: product.name,
        unitPrice: product.price,
        quantity: item.quantity,
        dealDiscount,
        lineTotal: calculateLineTotal(
          product.price,
          item.quantity,
          dealDiscount,
        ),
      };
    });
    const totals = calculateTotals(lines, discount, STANDARD_SHIPPING_PRICE);

    return {
      lines,
      subtotal: totals.subtotal,
      discountCode: discount?.code ?? null,
      discountAmount: totals.discountAmount,
      shipping: totals.shipping,
      total: totals.total,
      currency: this.config.get('CURRENCY', { infer: true }),
    };
  }

  // Order and items are saved together or not at all (CLAUDE.md 7.1), with
  // the Stripe session id already set (unique: one session, one order).
  private saveOrder(
    dto: CreateOrderDto,
    cart: PricedCart,
    sessionId: string,
  ): Promise<Order> {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.save(
        manager.create(Order, {
          email: dto.email,
          firstName: dto.delivery.firstName,
          lastName: dto.delivery.lastName,
          address: dto.delivery.address,
          apartment: dto.delivery.apartment ?? null,
          city: dto.delivery.city,
          postalCode: dto.delivery.postalCode ?? null,
          country: dto.delivery.country,
          phone: dto.delivery.phone ?? null,
          subtotal: cart.subtotal,
          discountCode: cart.discountCode,
          discountAmount: cart.discountAmount,
          shipping: cart.shipping,
          total: cart.total,
          currency: cart.currency,
          stripeCheckoutSessionId: sessionId,
        }),
      );

      order.items = await manager.save(
        cart.lines.map((line) => manager.create(OrderItem, { ...line, order })),
      );
      return order;
    });
  }

  async findById(id: string): Promise<Order> {
    const order = await this.ordersRepository.findOne({
      where: { id },
      relations: { items: true },
      order: { items: { id: 'ASC' } },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  // Codes are case-insensitive: stored uppercase, input uppercased here.
  // Unknown and inactive codes get the same message so codes can't be probed.
  async findActiveDiscount(code: string): Promise<DiscountCode> {
    const discount = await this.discountCodesRepository.findOneBy({
      code: code.trim().toUpperCase(),
      active: true,
    });
    if (!discount) {
      throw new BadRequestException('Invalid discount code');
    }
    return discount;
  }

  private assertUniqueSlugs(items: OrderItemDto[]): void {
    const slugs = items.map((item) => item.slug);
    if (new Set(slugs).size !== slugs.length) {
      throw new BadRequestException(
        'Each product may appear only once; combine quantities instead',
      );
    }
  }
}
