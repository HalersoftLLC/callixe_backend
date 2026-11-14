import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminGuard } from './admin.guard';

const SECRET = 'test-secret-that-is-at-least-32-characters';

// Real JwtService (no network, no I/O) so signatures and expiry are
// checked for real, configured like AdminModule.
const jwtService = new JwtService({
  secret: SECRET,
  signOptions: { algorithm: 'HS256', expiresIn: 60 },
  verifyOptions: { algorithms: ['HS256'] },
});

function contextWith(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const guard = new AdminGuard(jwtService);

  it('allows a valid admin token', async () => {
    const token = jwtService.sign({ sub: 'admin' });

    await expect(
      guard.canActivate(contextWith(`Bearer ${token}`)),
    ).resolves.toBe(true);
  });

  it.each([
    ['no Authorization header', undefined],
    ['an empty header', ''],
    ['a non-Bearer scheme', 'Basic dXNlcjpwYXNz'],
    ['"Bearer" without a token', 'Bearer '],
    ['a malformed token', 'Bearer not-a-jwt'],
  ])('rejects %s', async (_case, header) => {
    await expect(guard.canActivate(contextWith(header))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const token = jwtService.sign({ sub: 'admin' }, { expiresIn: -10 });

    await expect(
      guard.canActivate(contextWith(`Bearer ${token}`)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed with another secret', async () => {
    const otherSigner = new JwtService({
      secret: 'another-secret-that-is-at-least-32-chars',
    });
    const token = otherSigner.sign({ sub: 'admin' });

    await expect(
      guard.canActivate(contextWith(`Bearer ${token}`)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a validly signed token for another subject', async () => {
    const token = jwtService.sign({ sub: 'customer' });

    await expect(
      guard.canActivate(contextWith(`Bearer ${token}`)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
