import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductImage } from './entities/product-image.entity';
import { Product } from './entities/product.entity';
import { ProductImagesService } from './product-images.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { imageStorageProvider } from './storage/image-storage.provider';

@Module({
  imports: [TypeOrmModule.forFeature([Product, ProductImage])],
  controllers: [ProductsController],
  providers: [ProductsService, ProductImagesService, imageStorageProvider],
  // Orders needs server-side prices; Admin manages products and images.
  // Both use the services, never the repositories or the storage.
  exports: [ProductsService, ProductImagesService],
})
export class ProductsModule {}
