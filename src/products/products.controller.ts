import { Controller, Get, Param } from '@nestjs/common';
import { ProductResponseDto } from './dto/product-response.dto';
import { ProductSlugParamDto } from './dto/product-slug-param.dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async findAll(): Promise<ProductResponseDto[]> {
    const products = await this.productsService.findAll();
    return products.map((product) =>
      ProductResponseDto.fromEntity(
        product,
        this.productsService.toPublicImages(product),
      ),
    );
  }

  @Get(':slug')
  async findOne(
    @Param() { slug }: ProductSlugParamDto,
  ): Promise<ProductResponseDto> {
    const product = await this.productsService.findBySlug(slug);
    return ProductResponseDto.fromEntity(
      product,
      this.productsService.toPublicImages(product),
    );
  }
}
