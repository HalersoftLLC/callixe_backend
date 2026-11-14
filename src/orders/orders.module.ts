import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsModule } from '../payments/payments.module';
import { ProductsModule } from '../products/products.module';
import { DiscountsController } from './discounts.controller';
import { DiscountCode } from './entities/discount-code.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { OrderReportsService } from './order-reports.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, DiscountCode]),
    // Gives OrdersService access to ProductsService (server-side prices).
    ProductsModule,
    // Creates Checkout Sessions; Payments imports Orders back for the webhook.
    forwardRef(() => PaymentsModule),
  ],
  controllers: [OrdersController, DiscountsController],
  providers: [OrdersService, OrderReportsService],
  // The Stripe webhook (PaymentsController) applies payment results;
  // the Admin module reads paid-order reports.
  exports: [OrdersService, OrderReportsService],
})
export class OrdersModule {}
