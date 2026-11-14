import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import {
  CREATE_ORDER_RATE_LIMIT,
  RATE_LIMIT_TTL_MS,
} from './orders/orders.constants';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { ProductsModule } from './products/products.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: `.env.${process.env.NODE_ENV ?? 'development'}`,
      validate: validateEnv,
    }),
    // Registered once (global storage). Not applied globally: ThrottlerGuard
    // is added only on the routes that need it (CLAUDE.md 8.3).
    ThrottlerModule.forRoot([
      { ttl: RATE_LIMIT_TTL_MS, limit: CREATE_ORDER_RATE_LIMIT },
    ]),
    DatabaseModule,
    ProductsModule,
    OrdersModule,
    PaymentsModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule {}
