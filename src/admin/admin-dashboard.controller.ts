import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  type AdminDashboard,
  AdminDashboardService,
} from './admin-dashboard.service';
import { AdminGuard } from './admin.guard';

@Controller('admin/dashboard')
@UseGuards(AdminGuard)
export class AdminDashboardController {
  constructor(private readonly adminDashboardService: AdminDashboardService) {}

  @Get()
  get(): Promise<AdminDashboard> {
    return this.adminDashboardService.getDashboard();
  }
}
