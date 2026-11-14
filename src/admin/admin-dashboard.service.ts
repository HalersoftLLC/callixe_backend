import { Injectable } from '@nestjs/common';
import {
  type AdminOrderListItem,
  OrderReportsService,
} from '../orders/order-reports.service';
import {
  type ProductCounts,
  ProductsService,
} from '../products/products.service';

export interface AdminDashboard {
  products: ProductCounts;
  orders: { paid: number; paidLast30Days: number };
  customers: { total: number };
  revenue: { total: number; last30Days: number; averageOrderValue: number };
  recentOrders: AdminOrderListItem[];
  topProducts: {
    slug: string;
    name: string;
    quantitySold: number;
    revenue: number;
  }[];
}

// Combines the product and paid-order figures for the dashboard. Holds no
// repositories: each module computes its own numbers.
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly productsService: ProductsService,
    private readonly orderReportsService: OrderReportsService,
  ) {}

  async getDashboard(): Promise<AdminDashboard> {
    const [products, stats] = await Promise.all([
      this.productsService.countByActive(),
      this.orderReportsService.getStats(),
    ]);
    return {
      products,
      orders: {
        paid: stats.paidOrders,
        paidLast30Days: stats.paidOrdersLast30Days,
      },
      customers: { total: stats.customers },
      revenue: {
        total: stats.revenue,
        last30Days: stats.revenueLast30Days,
        averageOrderValue: stats.averageOrderValue,
      },
      recentOrders: stats.recentOrders,
      topProducts: stats.topProducts,
    };
  }
}
