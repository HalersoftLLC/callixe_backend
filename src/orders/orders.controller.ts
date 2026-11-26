import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  CreateOrderDto,
  CreatePaymentSessionDto,
} from './dto/create-order.dto';
import {
  CreateOrderResponseDto,
  OrderResponseDto,
  PaymentSessionResponseDto,
} from './dto/order-response.dto';
import {
  CREATE_ORDER_RATE_LIMIT,
  PAYMENT_SESSION_RATE_LIMIT,
  RATE_LIMIT_TTL_MS,
} from './orders.constants';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // Guard scoped to this route only (CLAUDE.md 8.3): stops bots from
  // creating floods of pending orders.
  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: { limit: CREATE_ORDER_RATE_LIMIT, ttl: RATE_LIMIT_TTL_MS },
  })
  async create(@Body() dto: CreateOrderDto): Promise<CreateOrderResponseDto> {
    const order = await this.ordersService.create(dto);
    return CreateOrderResponseDto.fromEntity(order);
  }

  // Called when checkout opens (and when the discount changes) so the card
  // form can show before the customer has typed anything. Saves nothing.
  @Post('payment-session')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: { limit: PAYMENT_SESSION_RATE_LIMIT, ttl: RATE_LIMIT_TTL_MS },
  })
  createPaymentSession(
    @Body() dto: CreatePaymentSessionDto,
  ): Promise<PaymentSessionResponseDto> {
    return this.ordersService.createPaymentSession(dto);
  }

  @Get(':id')
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OrderResponseDto> {
    const order = await this.ordersService.findById(id);
    return OrderResponseDto.fromEntity(order);
  }
}
