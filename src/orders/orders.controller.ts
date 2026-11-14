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
import { CreateOrderDto } from './dto/create-order.dto';
import {
  CreateOrderResponseDto,
  OrderResponseDto,
} from './dto/order-response.dto';
import { CREATE_ORDER_RATE_LIMIT, RATE_LIMIT_TTL_MS } from './orders.constants';
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
    const { order, checkoutUrl } = await this.ordersService.create(dto);
    return CreateOrderResponseDto.fromEntity(order, checkoutUrl);
  }

  @Get(':id')
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OrderResponseDto> {
    const order = await this.ordersService.findById(id);
    return OrderResponseDto.fromEntity(order);
  }
}
