import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { EnvironmentVariables } from '../config/env.validation';
import { OrdersModule } from '../orders/orders.module';
import { ProductsModule } from '../products/products.module';
import { ADMIN_TOKEN_TTL_SECONDS } from './admin.constants';
import { AdminAuthController } from './admin-auth.controller';
import { AdminCustomersController } from './admin-customers.controller';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminFeaturedCardsController } from './admin-featured-cards.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminProductImagesController } from './admin-product-images.controller';
import { AdminProductsController } from './admin-products.controller';
import { AdminShopHeroController } from './admin-shop-hero.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';

@Module({
  imports: [
    // Registered here only (not global): admin tokens are the only JWTs.
    // The algorithm is pinned on both sides so a token signed with another
    // algorithm (e.g. "none") is never accepted.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: ADMIN_TOKEN_TTL_SECONDS,
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    // Admin talks to other modules only through their exported services.
    ProductsModule,
    OrdersModule,
  ],
  controllers: [
    AdminAuthController,
    AdminProductsController,
    AdminProductImagesController,
    AdminShopHeroController,
    AdminFeaturedCardsController,
    AdminOrdersController,
    AdminCustomersController,
    AdminDashboardController,
  ],
  providers: [AdminAuthService, AdminGuard, AdminDashboardService],
})
export class AdminModule {}
