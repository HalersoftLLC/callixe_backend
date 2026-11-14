import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AdminLoginDto } from './admin-login.dto';

// Same options as the global ValidationPipe.
function errorsFor(body: Record<string, unknown>) {
  return validateSync(plainToInstance(AdminLoginDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('AdminLoginDto', () => {
  it('accepts a valid email and password', () => {
    expect(
      errorsFor({ email: 'admin@example.com', password: 'secret' }),
    ).toHaveLength(0);
  });

  it('trims the email', () => {
    const dto = plainToInstance(AdminLoginDto, {
      email: '  admin@example.com ',
      password: 'secret',
    });
    expect(dto.email).toBe('admin@example.com');
  });

  it('does not trim the password', () => {
    const dto = plainToInstance(AdminLoginDto, {
      email: 'admin@example.com',
      password: ' secret ',
    });
    expect(dto.password).toBe(' secret ');
  });

  it.each([
    ['an invalid email', { email: 'not-an-email', password: 'secret' }],
    ['a missing email', { password: 'secret' }],
    ['an empty password', { email: 'admin@example.com', password: '' }],
    ['a missing password', { email: 'admin@example.com' }],
    [
      'a password over 72 characters',
      { email: 'admin@example.com', password: 'a'.repeat(73) },
    ],
    [
      'unknown fields',
      { email: 'admin@example.com', password: 'secret', role: 'admin' },
    ],
  ])('rejects %s', (_case, body) => {
    expect(errorsFor(body).length).toBeGreaterThan(0);
  });
});
