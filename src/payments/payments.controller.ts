import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger('StripeWebhook');

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly ordersService: OrdersService,
  ) {}

  // Stripe only. Not rate limited: Stripe retries on failure and the
  // signature check rejects everything else. Never log the body or headers.
  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    let event: Stripe.Event;
    try {
      event = this.paymentsService.constructWebhookEvent(
        req.rawBody,
        signature,
      );
    } catch (err) {
      if (err instanceof BadRequestException) {
        this.logger.warn(`Stripe webhook rejected: ${err.message}`);
      }
      throw err;
    }

    const outcome = this.paymentsService.toPaymentOutcome(event);
    if (outcome) {
      await this.ordersService.applyPaymentOutcome(outcome);
    } else {
      this.logger.log(`${event.id} ${event.type} ignored`);
    }
    return { received: true };
  }
}
