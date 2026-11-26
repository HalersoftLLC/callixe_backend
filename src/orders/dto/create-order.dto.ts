import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  SLUG_MAX_LENGTH,
  SLUG_MESSAGE,
  SLUG_PATTERN,
} from '../../common/validation/slug';
import { Trim, TrimOrUndefined } from '../../common/validation/transforms';
import {
  ALLOWED_COUNTRIES,
  DISCOUNT_CODE_MAX_LENGTH,
  MAX_ITEMS_PER_ORDER,
  MAX_QUANTITY_PER_ITEM,
} from '../orders.constants';

export class DeliveryDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  address!: string;

  @TrimOrUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  apartment?: string;

  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @TrimOrUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsIn(ALLOWED_COUNTRIES)
  country!: string;

  @TrimOrUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^[0-9+()\-.\s]+$/, {
    message: 'phone may contain only digits, spaces, and + ( ) - .',
  })
  phone?: string;
}

export class OrderItemDto {
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY_PER_ITEM)
  quantity!: number;
}

// POST /orders/payment-session: the cart only. Only slugs and quantities:
// prices and totals are always calculated on the server (CLAUDE.md
// section 5). Unknown fields are rejected by the global ValidationPipe
// (forbidNonWhitelisted).
export class CreatePaymentSessionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ITEMS_PER_ORDER)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @TrimOrUndefined()
  @IsOptional()
  @IsString()
  @MaxLength(DISCOUNT_CODE_MAX_LENGTH)
  discountCode?: string;
}

// POST /orders: the same cart, the customer's details, and the session the
// card form was opened with.
export class CreateOrderDto extends CreatePaymentSessionDto {
  @Trim()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => DeliveryDto)
  delivery!: DeliveryDto;

  @IsString()
  @MaxLength(255)
  @Matches(/^cs_(test|live)_[A-Za-z0-9]+$/, {
    message: 'paymentSessionId must be a Stripe Checkout Session id',
  })
  paymentSessionId!: string;
}
