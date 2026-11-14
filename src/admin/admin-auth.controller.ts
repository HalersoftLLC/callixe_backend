import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ADMIN_LOGIN_RATE_LIMIT, ADMIN_LOGIN_TTL_MS } from './admin.constants';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';
import {
  AdminLoginResponseDto,
  AdminProfileResponseDto,
} from './dto/admin-auth-response.dto';
import { AdminLoginDto } from './dto/admin-login.dto';

@Controller('admin')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  // The only admin route without AdminGuard. 200 instead of 201: logging in
  // creates nothing on the server.
  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: { limit: ADMIN_LOGIN_RATE_LIMIT, ttl: ADMIN_LOGIN_TTL_MS },
  })
  async login(@Body() dto: AdminLoginDto): Promise<AdminLoginResponseDto> {
    const accessToken = await this.adminAuthService.login(
      dto.email,
      dto.password,
    );
    return { accessToken };
  }

  // Lets the admin app check on page load whether its saved token still works.
  @Get('me')
  @UseGuards(AdminGuard)
  me(): AdminProfileResponseDto {
    return { email: this.adminAuthService.getAdminEmail() };
  }
}
