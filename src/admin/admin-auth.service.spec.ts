import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { compare } from 'bcrypt';
import { AdminAuthService } from './admin-auth.service';

jest.mock('bcrypt', () => ({ compare: jest.fn() }));

const compareMock = compare as jest.MockedFunction<
  (data: string, encrypted: string) => Promise<boolean>
>;

const env: Record<string, string> = {
  ADMIN_EMAIL: 'Admin@Example.com',
  ADMIN_PASSWORD_HASH:
    '$2b$12$hashhashhashhashhashhashhashhashhashhashhashhashhash',
};

describe('AdminAuthService', () => {
  let service: AdminAuthService;
  const jwtService = { signAsync: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    jwtService.signAsync.mockResolvedValue('signed-token');

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminAuthService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = moduleRef.get(AdminAuthService);
  });

  it('returns a token for the correct email and password', async () => {
    compareMock.mockResolvedValue(true);

    await expect(
      service.login('admin@example.com', 'correct-password'),
    ).resolves.toBe('signed-token');
    expect(compareMock).toHaveBeenCalledWith(
      'correct-password',
      env.ADMIN_PASSWORD_HASH,
    );
    // The token identifies the admin role only, no personal data.
    expect(jwtService.signAsync).toHaveBeenCalledWith({ sub: 'admin' });
  });

  it('compares the email case-insensitively', async () => {
    compareMock.mockResolvedValue(true);

    await expect(
      service.login('ADMIN@EXAMPLE.COM', 'correct-password'),
    ).resolves.toBe('signed-token');
  });

  it('rejects a wrong password with 401', async () => {
    compareMock.mockResolvedValue(false);

    await expect(
      service.login('admin@example.com', 'wrong'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('rejects a wrong email with the same 401 and still runs bcrypt', async () => {
    compareMock.mockResolvedValue(true);

    await expect(
      service.login('someone@example.com', 'correct-password'),
    ).rejects.toThrow('Invalid credentials');
    expect(compareMock).toHaveBeenCalledTimes(1);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('returns the admin email for the profile route', () => {
    expect(service.getAdminEmail()).toBe('Admin@Example.com');
  });
});
