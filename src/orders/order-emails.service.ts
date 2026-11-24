import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EnvironmentVariables } from '../config/env.validation';
import { EmailService } from '../email/email.service';
import { buildOrderConfirmationEmail } from './emails/order-confirmation.email';
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
      const order = await this.ordersRepository.findOne({
        where: { id: orderId },
        relations: { items: true },
        order: { items: { id: 'ASC' } },
      });
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
