import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TrimOrUndefined } from '../../common/validation/transforms';
import {
  PRODUCT_SORT_OPTIONS,
  type ProductSort,
} from '../../products/products.service';
import { SEARCH_MAX_LENGTH } from '../admin.constants';
import { PaginationQueryDto } from './pagination-query.dto';

// GET /admin/products?search=&active=&sort=&page=&limit=
export class ListProductsQueryDto extends PaginationQueryDto {
  @TrimOrUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_MAX_LENGTH)
  search?: string;

  // Query strings are text: only the exact words "true"/"false" count.
  // Anything else stays a string and fails @IsBoolean.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  active?: boolean;

  @IsIn(PRODUCT_SORT_OPTIONS)
  sort: ProductSort = '-createdAt';
}
