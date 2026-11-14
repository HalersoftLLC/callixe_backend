import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../admin.constants';

// Shared by every admin list endpoint. Query strings arrive as text, so
// @Type converts them; "abc" becomes NaN and fails @IsInt with a 400.
export class PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;
}
