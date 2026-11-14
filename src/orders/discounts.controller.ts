import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { DiscountResponseDto } from './dto/order-response.dto';
import { ValidateDiscountDto } from './dto/validate-discount.dto';
import {
  RATE_LIMIT_TTL_MS,
  VALIDATE_DISCOUNT_RATE_LIMIT,
} from './orders.constants';
import { OrdersService } from './orders.service';

@Controller('discounts')
export class DiscountsController {
  constructor(private readonly ordersService: OrdersService) {}

  // Rate limited so discount codes can't be guessed by brute force.
  // 200 instead of 201: this checks a code, it creates nothing.
  @Post('validate')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: { limit: VALIDATE_DISCOUNT_RATE_LIMIT, ttl: RATE_LIMIT_TTL_MS },
  })
  async validate(
    @Body() dto: ValidateDiscountDto,
  ): Promise<DiscountResponseDto> {
    const discount = await this.ordersService.findActiveDiscount(dto.code);
    return DiscountResponseDto.fromEntity(discount);
  }
}
