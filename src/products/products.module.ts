import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeaturedCard } from './entities/featured-card.entity';
import { ProductImage } from './entities/product-image.entity';
import { Product } from './entities/product.entity';
import { ShopHero } from './entities/shop-hero.entity';
import { FeaturedCardsController } from './featured-cards.controller';
import { FeaturedCardsService } from './featured-cards.service';
import { ProductImagesService } from './product-images.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ShopHeroController } from './shop-hero.controller';
import { ShopHeroService } from './shop-hero.service';
import { imageStorageProvider } from './storage/image-storage.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, ProductImage, ShopHero, FeaturedCard]),
  ],
  controllers: [
    ProductsController,
    ShopHeroController,
    FeaturedCardsController,
  ],
  providers: [
    ProductsService,
    ProductImagesService,
    ShopHeroService,
    FeaturedCardsService,
    imageStorageProvider,
  ],
  // Orders needs server-side prices; Admin manages products, images, the
  // Shop page hero and the featured cards. Both use the services, never the
  // repositories or storage.
  exports: [
    ProductsService,
    ProductImagesService,
    ShopHeroService,
    FeaturedCardsService,
  ],
})
export class ProductsModule {}
