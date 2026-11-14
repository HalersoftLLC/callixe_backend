import { Matches, MaxLength } from 'class-validator';
import {
  SLUG_MAX_LENGTH,
  SLUG_MESSAGE,
  SLUG_PATTERN,
} from '../../common/validation/slug';

// Rejects malformed slugs with a 400 before they reach the database.
export class ProductSlugParamDto {
  @MaxLength(SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug!: string;
}
