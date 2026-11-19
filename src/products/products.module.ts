import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductImage } from './entities/product-image.entity';
import { Product } from './entities/product.entity';
import { ShopHero } from './entities/shop-hero.entity';
import { ProductImagesService } from './product-images.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ShopHeroController } from './shop-hero.controller';
import { ShopHeroService } from './shop-hero.service';
import { imageStorageProvider } from './storage/image-storage.provider';

@Module({
  imports: [TypeOrmModule.forFeature([Product, ProductImage, ShopHero])],
  controllers: [ProductsController, ShopHeroController],
  providers: [
    ProductsService,
    ProductImagesService,
    ShopHeroService,
    imageStorageProvider,
  ],
  // Orders needs server-side prices; Admin manages products, images and the
  // Shop page hero. Both use the services, never the repositories or storage.
  exports: [ProductsService, ProductImagesService, ShopHeroService],
})
export class ProductsModule {}
