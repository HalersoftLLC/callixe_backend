import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  IsInt,
} from 'class-validator';
import { TrimOrUndefined } from '../../common/validation/transforms';
import {
  CUSTOMER_SORT_OPTIONS,
  type CustomerSort,
  ORDER_SORT_OPTIONS,
  type OrderSort,
} from '../../orders/order-reports.service';
import { SEARCH_MAX_LENGTH } from '../admin.constants';
import { PaginationQueryDto } from './pagination-query.dto';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = '$property must be a date like 2026-11-13';
const EMAIL_MAX_LENGTH = 254;
// Order numbers start at 1001 (CLAUDE.md section 7).
const FIRST_ORDER_NUMBER = 1001;

// GET /admin/orders?email=&orderNumber=&shipped=&from=&to=&sort=&page=&limit=
// "from" after "to" is rejected by OrderReportsService (needs both values).
export class ListOrdersQueryDto extends PaginationQueryDto {
  @TrimOrUndefined()
  @IsOptional()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(FIRST_ORDER_NUMBER)
  orderNumber?: number;

  // Only the exact words "true"/"false" count (same rule as products'
  // ?active=); anything else stays text and fails @IsBoolean.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  shipped?: boolean;

  // Strict ISO check also rejects impossible dates such as 2026-02-30.
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  @IsISO8601({ strict: true }, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  @IsISO8601({ strict: true }, { message: DATE_MESSAGE })
  to?: string;

  @IsIn(ORDER_SORT_OPTIONS)
  sort: OrderSort = '-createdAt';
}

// GET /admin/customers?search=&sort=&page=&limit=
export class ListCustomersQueryDto extends PaginationQueryDto {
  @TrimOrUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_MAX_LENGTH)
  search?: string;

  @IsIn(CUSTOMER_SORT_OPTIONS)
  sort: CustomerSort = '-lastOrderAt';
}

// GET /admin/customers/detail?email=&page=&limit=
// The email is a query parameter (it contains "@"); requestLogger never logs
// query strings, so it stays out of the logs.
export class CustomerDetailQueryDto extends PaginationQueryDto {
  @TrimOrUndefined()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;
}
