import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ADMIN_LOGIN_RATE_LIMIT } from './admin.constants';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';

describe('AdminAuthController', () => {
  let controller: AdminAuthController;
  const adminAuthService = {
    login: jest.fn(),
    getAdminEmail: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      // ThrottlerGuard needs the throttler options to be resolvable.
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 8 }])],
      controllers: [AdminAuthController],
      providers: [
        { provide: AdminAuthService, useValue: adminAuthService },
        AdminGuard,
        { provide: JwtService, useValue: {} },
      ],
    }).compile();

    controller = moduleRef.get(AdminAuthController);
  });

  it('login returns the access token from the service', async () => {
    adminAuthService.login.mockResolvedValue('signed-token');

    await expect(
      controller.login({ email: 'admin@example.com', password: 'secret' }),
    ).resolves.toEqual({ accessToken: 'signed-token' });
    expect(adminAuthService.login).toHaveBeenCalledWith(
      'admin@example.com',
      'secret',
    );
  });

  it('login is rate limited and not behind AdminGuard', () => {
    const handler = AdminAuthController.prototype.login;
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];

    expect(guards).toEqual([ThrottlerGuard]);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(
      ADMIN_LOGIN_RATE_LIMIT,
    );
  });

  it('me is protected by AdminGuard and returns the admin email', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AdminAuthController.prototype.me,
    ) as unknown[];
    adminAuthService.getAdminEmail.mockReturnValue('admin@example.com');

    expect(guards).toEqual([AdminGuard]);
    expect(controller.me()).toEqual({ email: 'admin@example.com' });
  });
});
