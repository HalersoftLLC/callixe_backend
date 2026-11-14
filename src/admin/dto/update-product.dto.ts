import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim, TrimOrNull } from '../../common/validation/transforms';
import {
  MAX_PRODUCT_PRICE,
  PRODUCT_BADGE_MAX_LENGTH,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
} from '../admin.constants';

// Only validate a field when it was sent. Unlike @IsOptional(), this still
// validates null, so a required column can't be set to null.
const isPresent = (_: object, value: unknown) => value !== undefined;

// PATCH /admin/products/:slug. Every field is optional. slug is not
// declared, so sending it fails with 400 (forbidNonWhitelisted): it is the
// product's permanent key. null clears the nullable fields.
export class UpdateProductDto {
  @ValidateIf(isPresent)
  @Trim()
  @IsString()
  @Length(1, PRODUCT_NAME_MAX_LENGTH)
  name?: string;

  @ValidateIf(isPresent)
  @IsInt()
  @Min(0)
  @Max(MAX_PRODUCT_PRICE)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRODUCT_PRICE)
  compareAtPrice?: number | null;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_BADGE_MAX_LENGTH)
  badge?: string | null;

  @ValidateIf(isPresent)
  @IsBoolean()
  active?: boolean;
}
