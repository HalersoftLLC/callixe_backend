import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EnvironmentVariables } from '../config/env.validation';
import { EmailService } from '../email/email.service';
import { buildOrderConfirmationEmail } from './emails/order-confirmation.email';
import { buildOrderShippedEmail } from './emails/order-shipped.email';
import { Order } from './entities/order.entity';

// Customer emails about an order. Sending never throws: by the time an
// email is sent the order is already saved, so a failed email is logged
// and must not undo or block anything.
@Injectable()
export class OrderEmailsService {
  private readonly logger = new Logger(OrderEmailsService.name);

  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    private readonly emailService: EmailService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async sendConfirmation(orderId: string): Promise<void> {
    try {
      const order = await this.loadOrder(orderId);
      if (!order) {
        this.logger.warn(`Confirmation email: order ${orderId} not found`);
        return;
      }

      const frontendUrl = this.config.get('FRONTEND_URL', { infer: true });
      const email = buildOrderConfirmationEmail(order, {
        storeName: this.config.get('EMAIL_FROM_NAME', { infer: true }),
        orderUrl: `${frontendUrl}/order-confirmation/${order.id}`,
      });

      const messageId = await this.emailService.send({
        to: {
          email: order.email,
          name: `${order.firstName} ${order.lastName}`,
        },
        bcc: this.ownerCopy(order.email),
        ...email,
        tags: ['order-confirmation'],
      });
      // Order number only: no customer email address in the logs.
      this.logger.log(
        `Confirmation email sent for order #${order.orderNumber} (${messageId})`,
      );
    } catch (err) {
      this.logger.error(
        `Confirmation email failed for order ${orderId}: ${(err as Error).message}`,
      );
    }
  }

  // "Your order is on its way", from the admin's Mark as shipped / Resend.
  // Returns when it was sent, or null if it wasn't: the admin is waiting for
  // the answer, so a failure is reported instead of only logged.
  async sendShipped(orderId: string): Promise<Date | null> {
    const order = await this.trySendShipped(orderId);
    if (!order) {
      return null;
    }

    // The email is out; failing to record the time must not report it as
    // unsent (the admin would resend and the customer get it twice).
    const sentAt = new Date();
    try {
      await this.ordersRepository.update(
        { id: order.id },
        { shippingEmailSentAt: sentAt },
      );
    } catch (err) {
      this.logger.error(
        `Shipping email time not saved for order #${order.orderNumber}: ${(err as Error).message}`,
      );
    }
    return sentAt;
  }

  // Returns the order the email was sent for, or null (never throws).
  private async trySendShipped(orderId: string): Promise<Order | null> {
    try {
      const order = await this.loadOrder(orderId);
      if (!order) {
        this.logger.warn(`Shipping email: order ${orderId} not found`);
        return null;
      }
      const email = buildOrderShippedEmail(order, {
        storeName: this.config.get('EMAIL_FROM_NAME', { infer: true }),
      });
      const messageId = await this.emailService.send({
        to: {
          email: order.email,
          name: `${order.firstName} ${order.lastName}`,
        },
        bcc: this.ownerCopy(order.email),
        ...email,
        tags: ['order-shipped'],
      });
      this.logger.log(
        `Shipping email sent for order #${order.orderNumber} (${messageId})`,
      );
      return order;
    } catch (err) {
      this.logger.error(
        `Shipping email failed for order ${orderId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private loadOrder(orderId: string): Promise<Order | null> {
    return this.ordersRepository.findOne({
      where: { id: orderId },
      relations: { items: true },
      order: { items: { id: 'ASC' } },
    });
  }

  // The store owner gets a hidden copy of every confirmation. Skipped when
  // the owner is the customer (test orders), so the same inbox isn't
  // listed twice in one email.
  private ownerCopy(customerEmail: string): string[] {
    const owner = this.config.get('ORDER_NOTIFY_EMAIL', { infer: true });
    if (!owner || owner.toLowerCase() === customerEmail.toLowerCase()) {
      return [];
    }
    return [owner];
  }
}
