import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AdminOrderDetail,
  type AdminOrderListItem,
  OrderReportsService,
} from '../orders/order-reports.service';
import { OrdersService, type ShipOrderResult } from '../orders/orders.service';
import type { Page } from '../products/products.service';
import { AdminGuard } from './admin.guard';
import { ListOrdersQueryDto } from './dto/order-report-dtos';

// Paid orders only. Payment status changes only via the Stripe webhook,
// never from the admin panel; the admin can only mark an order shipped.
@Controller('admin/orders')
@UseGuards(AdminGuard)
export class AdminOrdersController {
  constructor(
    private readonly orderReportsService: OrderReportsService,
    private readonly ordersService: OrdersService,
  ) {}

  @Get()
  list(@Query() query: ListOrdersQueryDto): Promise<Page<AdminOrderListItem>> {
    return this.orderReportsService.listPaidOrders(query);
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<AdminOrderDetail> {
    return this.orderReportsService.findPaidOrder(id);
  }

  // Marks the order shipped (first time) and emails the customer; calling it
  // again only resends the email.
  @Post(':id/ship')
  @HttpCode(HttpStatus.OK)
  ship(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ShipOrderResult> {
    return this.ordersService.markShipped(id);
  }
}
