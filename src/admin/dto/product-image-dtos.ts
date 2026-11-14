import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  SLUG_MAX_LENGTH,
  SLUG_MESSAGE,
  SLUG_PATTERN,
} from '../../common/validation/slug';
import { MAX_IMAGES_PER_PRODUCT } from '../../products/product-images.service';

// Route params for /admin/products/:slug/images/:imageId. One DTO for both
// params: with forbidNonWhitelisted, a slug-only DTO would reject imageId.
export class ProductImageParamDto {
  @MaxLength(SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  imageId!: number;
}

// Multipart text field next to the file. Form fields always arrive as text,
// so only the exact words "true"/"false" are accepted.
export class UploadProductImageDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isMain?: boolean;
}

// PATCH body. isMain only accepts true: the main image changes by making
// another image main, so a product with images always has exactly one.
export class UpdateProductImageDto {
  @IsOptional()
  @IsIn([true], { message: 'isMain can only be true' })
  isMain?: true;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_IMAGES_PER_PRODUCT - 1)
  position?: number;
}
