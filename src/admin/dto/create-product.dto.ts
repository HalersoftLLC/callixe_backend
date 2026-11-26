import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
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
import { Trim, TrimOrNull } from '../../common/validation/transforms';
import {
  MAX_PRODUCT_PRICE,
  PRODUCT_BADGE_MAX_LENGTH,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
} from '../admin.constants';

// POST /admin/products. Prices are integer cents (CLAUDE.md section 5).
// "compareAtPrice > price" needs both values, so ProductsService checks it.
export class CreateProductDto {
  @Trim()
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug!: string;

  @Trim()
  @IsString()
  @Length(1, PRODUCT_NAME_MAX_LENGTH)
  name!: string;

  @IsInt()
  @Min(0)
  @Max(MAX_PRODUCT_PRICE)
  price!: number;

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

  // "Buy one, get one 50% off". Defaults to false when not sent.
  @IsOptional()
  @IsBoolean()
  secondUnitHalfOff?: boolean;

  // Defaults to true in ProductsService when not sent.
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
