import {
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Trim, TrimOrNull } from '../../common/validation/transforms';
import {
  SHOP_HERO_EYEBROW_MAX_LENGTH,
  SHOP_HERO_IMAGE_ALT_MAX_LENGTH,
  SHOP_HERO_TITLE_MAX_LENGTH,
} from '../../products/shop-hero.service';

// Only validate a field when it was sent. Unlike @IsOptional(), this still
// validates null, so the required text can't be set to null or blank.
const isPresent = (_: object, value: unknown) => value !== undefined;

// PATCH /admin/shop-hero. Every field is optional. The image is changed
// through its own routes (multipart upload), not here. null or an empty
// string clears imageAlt (the storefront then uses the title).
export class UpdateShopHeroDto {
  @ValidateIf(isPresent)
  @Trim()
  @IsString()
  @Length(1, SHOP_HERO_EYEBROW_MAX_LENGTH)
  eyebrow?: string;

  @ValidateIf(isPresent)
  @Trim()
  @IsString()
  @Length(1, SHOP_HERO_TITLE_MAX_LENGTH)
  title?: string;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @MaxLength(SHOP_HERO_IMAGE_ALT_MAX_LENGTH)
  imageAlt?: string | null;
}
