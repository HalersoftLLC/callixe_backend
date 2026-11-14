import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AdminOrderDetail,
  type AdminOrderListItem,
  OrderReportsService,
} from '../orders/order-reports.service';
import type { Page } from '../products/products.service';
import { AdminGuard } from './admin.guard';
import { ListOrdersQueryDto } from './dto/order-report-dtos';

// Paid orders only, read-only. Order status changes only via the Stripe
// webhook, never from the admin panel.
@Controller('admin/orders')
@UseGuards(AdminGuard)
export class AdminOrdersController {
  constructor(private readonly orderReportsService: OrderReportsService) {}

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
}
