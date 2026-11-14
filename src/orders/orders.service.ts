import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { EnvironmentVariables } from '../config/env.validation';
import { PaymentOutcome, PaymentsService } from '../payments/payments.service';
import { ProductsService } from '../products/products.service';
import { CreateOrderDto, OrderItemDto } from './dto/create-order.dto';
import { DiscountCode } from './entities/discount-code.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderStatus } from './entities/order.entity';
import { STANDARD_SHIPPING_PRICE } from './orders.constants';
import { calculateLineTotal, calculateTotals } from './pricing';

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
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // Saves the pending order, then opens a Stripe Checkout Session for it.
  async create(
    dto: CreateOrderDto,
  ): Promise<{ order: Order; checkoutUrl: string }> {
    const order = await this.saveOrder(dto);

    // Outside the transaction: never hold a DB transaction open during a
    // network call to Stripe.
    try {
      const session = await this.paymentsService.createCheckoutSession(order);
      await this.ordersRepository.update(
        { id: order.id },
        { stripeCheckoutSessionId: session.id },
      );
      order.stripeCheckoutSessionId = session.id;
      return { order, checkoutUrl: session.url };
    } catch (err) {
      // This order can never be paid; close it so it is not left pending.
      this.logger.error(
        `Checkout session failed for order #${order.orderNumber}: ${(err as Error).message}`,
      );
      await this.ordersRepository.update(
        { id: order.id },
        { status: OrderStatus.Failed },
      );
      throw new ServiceUnavailableException(
        'Payment is temporarily unavailable, please try again',
      );
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
      const { affected } = await this.ordersRepository.update(
        { id: order.id, status: Not(OrderStatus.Paid) },
        {
          status: OrderStatus.Paid,
          stripePaymentIntentId: outcome.paymentIntentId,
        },
      );
      this.logger.log(
        affected
          ? `${tag} → ${label} paid`
          : `${tag} → ${label} already paid (duplicate)`,
      );
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

  // Prices come only from the database via ProductsService; the request
  // carries slugs and quantities and nothing else (CLAUDE.md section 5).
  private async saveOrder(dto: CreateOrderDto): Promise<Order> {
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
      return {
        slug: product.slug,
        name: product.name,
        unitPrice: product.price,
        quantity: item.quantity,
        lineTotal: calculateLineTotal(product.price, item.quantity),
      };
    });
    const totals = calculateTotals(lines, discount, STANDARD_SHIPPING_PRICE);

    // Order and items are saved together or not at all (CLAUDE.md 7.1).
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
          subtotal: totals.subtotal,
          discountCode: discount?.code ?? null,
          discountAmount: totals.discountAmount,
          shipping: totals.shipping,
          total: totals.total,
          currency: this.config.get('CURRENCY', { infer: true }),
        }),
      );

      order.items = await manager.save(
        lines.map((line) => manager.create(OrderItem, { ...line, order })),
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
