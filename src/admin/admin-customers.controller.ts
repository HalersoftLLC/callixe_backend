import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  type AdminCustomerDetail,
  type AdminCustomerSummary,
  OrderReportsService,
} from '../orders/order-reports.service';
import type { Page } from '../products/products.service';
import { AdminGuard } from './admin.guard';
import {
  CustomerDetailQueryDto,
  ListCustomersQueryDto,
} from './dto/order-report-dtos';

// Customers are guests: each one is the set of paid orders sharing an email
// (case-insensitive). Read-only.
@Controller('admin/customers')
@UseGuards(AdminGuard)
export class AdminCustomersController {
  constructor(private readonly orderReportsService: OrderReportsService) {}

  @Get()
  list(
    @Query() query: ListCustomersQueryDto,
  ): Promise<Page<AdminCustomerSummary>> {
    return this.orderReportsService.listCustomers(query);
  }

  @Get('detail')
  detail(@Query() query: CustomerDetailQueryDto): Promise<AdminCustomerDetail> {
    return this.orderReportsService.findCustomer(query.email, {
      page: query.page,
      limit: query.limit,
    });
  }
}
