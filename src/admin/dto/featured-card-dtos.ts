import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  SLUG_MAX_LENGTH,
  SLUG_MESSAGE,
  SLUG_PATTERN,
} from '../../common/validation/slug';
import { TrimOrNull } from '../../common/validation/transforms';
import {
  FEATURED_CARD_SLOTS,
  FEATURED_IMAGE_POSITIONS,
  FEATURED_PROMO_MAX_LENGTH,
  type FeaturedCardSlot,
  type FeaturedImagePosition,
} from '../../products/featured-cards.service';

// Only validate a field when it was sent. Unlike @IsOptional(), this still
// validates null, so productSlug and imagePosition can't be set to null.
const isPresent = (_: object, value: unknown) => value !== undefined;

// Route param for /admin/featured-cards/:slot. There are always two cards.
export class FeaturedCardSlotParamDto {
  @Type(() => Number)
  @IsInt()
  @IsIn(FEATURED_CARD_SLOTS, { message: 'slot must be 1 or 2' })
  slot!: FeaturedCardSlot;
}

// PATCH /admin/featured-cards/:slot. Card settings only: the product's own
// details are changed with PATCH /admin/products/:slug.
// - productSlug: a product's slug. Not nullable: the Shop page always shows
//   both cards, so a card can't be emptied through the API.
// - promo: null or blank removes it.
export class UpdateFeaturedCardDto {
  @ValidateIf(isPresent)
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  productSlug?: string;

  @ValidateIf(isPresent)
  @IsIn(FEATURED_IMAGE_POSITIONS, {
    message: 'imagePosition must be left or right',
  })
  imagePosition?: FeaturedImagePosition;

  @TrimOrNull()
  @IsOptional()
  @IsString()
  @Length(1, FEATURED_PROMO_MAX_LENGTH)
  promo?: string | null;
}
