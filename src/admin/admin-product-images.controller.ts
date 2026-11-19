import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  type AdminProductImageView,
  ProductImagesService,
} from '../products/product-images.service';
import { AdminGuard } from './admin.guard';
import {
  ProductImageParamDto,
  UpdateProductImageDto,
  UploadProductImageDto,
} from './dto/product-image-dtos';
import { ProductSlugParamDto } from './dto/product-slug-param.dto';
import {
  IMAGE_UPLOAD_OPTIONS,
  requiredImageFile as requiredFile,
} from './image-upload.options';

@Controller('admin/products/:slug/images')
@UseGuards(AdminGuard)
export class AdminProductImagesController {
  constructor(private readonly productImagesService: ProductImagesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  upload(
    @Param() { slug }: ProductSlugParamDto,
    @UploadedFile(requiredFile) file: Express.Multer.File,
    @Body() body: UploadProductImageDto,
  ): Promise<AdminProductImageView> {
    return this.productImagesService.upload(slug, file, {
      isMain: body.isMain,
    });
  }

  // Returns every image of the product: moving one changes the others' order.
  @Patch(':imageId')
  update(
    @Param() { slug, imageId }: ProductImageParamDto,
    @Body() dto: UpdateProductImageDto,
  ): Promise<AdminProductImageView[]> {
    return this.productImagesService.update(slug, imageId, dto);
  }

  @Put(':imageId/file')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  replaceFile(
    @Param() { slug, imageId }: ProductImageParamDto,
    @UploadedFile(requiredFile) file: Express.Multer.File,
  ): Promise<AdminProductImageView> {
    return this.productImagesService.replaceFile(slug, imageId, file);
  }

  @Delete(':imageId')
  @HttpCode(204)
  remove(@Param() { slug, imageId }: ProductImageParamDto): Promise<void> {
    return this.productImagesService.remove(slug, imageId);
  }
}
