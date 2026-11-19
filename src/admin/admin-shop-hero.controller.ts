import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  type AdminShopHeroView,
  ShopHeroService,
} from '../products/shop-hero.service';
import { AdminGuard } from './admin.guard';
import { UpdateShopHeroDto } from './dto/update-shop-hero.dto';
import {
  IMAGE_UPLOAD_OPTIONS,
  requiredImageFile,
} from './image-upload.options';

// The Shop page hero: text and one image. Same upload limits as product
// images (JPEG/PNG/WebP checked from the bytes, at most 5 MB).
@Controller('admin/shop-hero')
@UseGuards(AdminGuard)
export class AdminShopHeroController {
  constructor(private readonly shopHeroService: ShopHeroService) {}

  @Get()
  find(): Promise<AdminShopHeroView> {
    return this.shopHeroService.getForAdmin();
  }

  @Patch()
  update(@Body() dto: UpdateShopHeroDto): Promise<AdminShopHeroView> {
    return this.shopHeroService.update(dto);
  }

  // Uploads the image, or replaces the current one.
  @Put('image')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  replaceImage(
    @UploadedFile(requiredImageFile) file: Express.Multer.File,
  ): Promise<AdminShopHeroView> {
    return this.shopHeroService.replaceImage(file);
  }

  // The storefront shows its own image again.
  @Delete('image')
  @HttpCode(204)
  removeImage(): Promise<void> {
    return this.shopHeroService.removeImage();
  }
}
