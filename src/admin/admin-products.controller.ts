import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AdminProductView,
  type Page,
  ProductsService,
} from '../products/products.service';
import { AdminGuard } from './admin.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ProductSlugParamDto } from './dto/product-slug-param.dto';
import { UpdateProductDto } from './dto/update-product.dto';

// Product management for the admin panel. No DELETE: deactivating
// (active: false) hides a product and keeps past orders and links intact.
@Controller('admin/products')
@UseGuards(AdminGuard)
export class AdminProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  list(@Query() query: ListProductsQueryDto): Promise<Page<AdminProductView>> {
    return this.productsService.findAllForAdmin(query);
  }

  @Get(':slug')
  findOne(@Param() { slug }: ProductSlugParamDto): Promise<AdminProductView> {
    return this.productsService.findOneForAdmin(slug);
  }

  @Post()
  create(@Body() dto: CreateProductDto): Promise<AdminProductView> {
    return this.productsService.create(dto);
  }

  @Patch(':slug')
  update(
    @Param() { slug }: ProductSlugParamDto,
    @Body() dto: UpdateProductDto,
  ): Promise<AdminProductView> {
    return this.productsService.update(slug, dto);
  }
}
