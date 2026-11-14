import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { EnvironmentVariables } from '../config/env.validation';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService, STRIPE_CLIENT } from './payments.service';

@Module({
  // Orders creates Checkout Sessions through PaymentsService, and the webhook
  // updates orders through OrdersService, so the two modules import each other.
  imports: [forwardRef(() => OrdersModule)],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      // The only place the Stripe client is created (CLAUDE.md 8.2).
      // apiVersion is omitted: the SDK uses the version it was released with,
      // pinned by package-lock.json.
      provide: STRIPE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new Stripe(config.get('STRIPE_SECRET_KEY', { infer: true })),
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
