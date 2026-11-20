import { validateEnv } from './env.validation';

const validEnv: Record<string, unknown> = {
  NODE_ENV: 'development',
  FRONTEND_URL: 'http://localhost:5173',
  ADMIN_URL: 'http://localhost:5174',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD_HASH: `$2b$12$${'a'.repeat(53)}`,
  JWT_SECRET: 'x'.repeat(32),
  DB_HOST: 'localhost',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_NAME: 'shop',
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_123',
  STORAGE_PUBLIC_URL: 'http://localhost:3000/uploads',
};

const spacesEnv = {
  STORAGE_DRIVER: 'spaces',
  STORAGE_PUBLIC_URL: 'https://shop.fra1.cdn.digitaloceanspaces.com',
  SPACES_ENDPOINT: 'https://fra1.digitaloceanspaces.com',
  SPACES_REGION: 'fra1',
  SPACES_BUCKET: 'shop',
  SPACES_KEY: 'key',
  SPACES_SECRET: 'secret',
};

function envWith(overrides: Record<string, unknown>) {
  return { ...validEnv, ...overrides };
}

describe('validateEnv', () => {
  it('accepts a complete development environment', () => {
    expect(() => validateEnv(validEnv)).not.toThrow();
  });

  it.each(['ADMIN_URL', 'ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH', 'JWT_SECRET'])(
    'requires %s',
    (key) => {
      expect(() => validateEnv(envWith({ [key]: undefined }))).toThrow(
        'Invalid environment variables',
      );
    },
  );

  it.each([
    ['FRONTEND_URL', 'http://localhost:5173/'],
    ['ADMIN_URL', 'http://localhost:5174/'],
    ['ADMIN_URL', 'https://admin.example.com/login'],
    ['ADMIN_URL', 'localhost:5174'],
  ])('rejects %s = %s (must be an origin)', (key, value) => {
    expect(() => validateEnv(envWith({ [key]: value }))).toThrow(
      'must be an origin',
    );
  });

  it('accepts https origins with a port', () => {
    expect(() =>
      validateEnv(envWith({ ADMIN_URL: 'https://admin.example.com:8443' })),
    ).not.toThrow();
  });

  it('rejects a plain password in ADMIN_PASSWORD_HASH', () => {
    expect(() =>
      validateEnv(envWith({ ADMIN_PASSWORD_HASH: 'my-password' })),
    ).toThrow('must be a bcrypt hash');
  });

  it('rejects an invalid ADMIN_EMAIL', () => {
    expect(() => validateEnv(envWith({ ADMIN_EMAIL: 'admin' }))).toThrow(
      'Invalid environment variables',
    );
  });

  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    expect(() => validateEnv(envWith({ JWT_SECRET: 'x'.repeat(31) }))).toThrow(
      'Invalid environment variables',
    );
  });

  describe('image storage', () => {
    it('defaults to local storage without Spaces variables', () => {
      expect(validateEnv(validEnv).STORAGE_DRIVER).toBe('local');
    });

    it('requires STORAGE_PUBLIC_URL', () => {
      expect(() =>
        validateEnv(envWith({ STORAGE_PUBLIC_URL: undefined })),
      ).toThrow('Invalid environment variables');
    });

    it('rejects a STORAGE_PUBLIC_URL ending in a slash', () => {
      expect(() =>
        validateEnv(
          envWith({ STORAGE_PUBLIC_URL: 'http://localhost:3000/uploads/' }),
        ),
      ).toThrow('must not end with a slash');
    });

    it('rejects an unknown driver', () => {
      expect(() => validateEnv(envWith({ STORAGE_DRIVER: 's3' }))).toThrow(
        'Invalid environment variables',
      );
    });

    it('accepts a complete Spaces configuration', () => {
      expect(() => validateEnv(envWith(spacesEnv))).not.toThrow();
    });

    it.each([
      'SPACES_ENDPOINT',
      'SPACES_REGION',
      'SPACES_BUCKET',
      'SPACES_KEY',
      'SPACES_SECRET',
    ])('requires %s when STORAGE_DRIVER=spaces', (key) => {
      expect(() =>
        validateEnv(envWith({ ...spacesEnv, [key]: undefined })),
      ).toThrow('Invalid environment variables');
    });

    it('refuses local storage in production (uploads are lost on deploy)', () => {
      expect(() =>
        validateEnv(
          envWith({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_1' }),
        ),
      ).toThrow('STORAGE_DRIVER is not "spaces"');
    });

    it('accepts Spaces in production', () => {
      expect(() =>
        validateEnv(
          envWith({
            ...spacesEnv,
            NODE_ENV: 'production',
            STRIPE_SECRET_KEY: 'sk_live_1',
          }),
        ),
      ).not.toThrow();
    });
  });

  describe('database CA certificate', () => {
    const pem =
      '-----BEGIN CERTIFICATE-----\nMIIEQTCC\n-----END CERTIFICATE-----';

    it('is optional', () => {
      expect(validateEnv(validEnv).DB_CA_CERT).toBeUndefined();
    });

    it('treats a blank value as not set', () => {
      const env = validateEnv(envWith({ DB_CA_CERT: '  ' }));
      expect(env.DB_CA_CERT).toBeUndefined();
    });

    it('accepts a multi-line PEM with DB_SSL=true', () => {
      const env = validateEnv(envWith({ DB_SSL: 'true', DB_CA_CERT: pem }));
      expect(env.DB_CA_CERT).toBe(pem);
    });

    it('turns a one-line value with literal \\n back into line breaks', () => {
      const oneLine = pem.replace(/\n/g, '\\n');
      const env = validateEnv(envWith({ DB_SSL: 'true', DB_CA_CERT: oneLine }));
      expect(env.DB_CA_CERT).toBe(pem);
    });

    it('rejects a value that is not a PEM certificate', () => {
      expect(() =>
        validateEnv(envWith({ DB_SSL: 'true', DB_CA_CERT: 'not-a-cert' })),
      ).toThrow('DB_CA_CERT must be a PEM certificate');
    });

    it('rejects a CA certificate without DB_SSL', () => {
      expect(() => validateEnv(envWith({ DB_CA_CERT: pem }))).toThrow(
        'DB_CA_CERT is set but DB_SSL is not "true"',
      );
    });
  });

  it('still rejects a live Stripe key outside production', () => {
    expect(() =>
      validateEnv(envWith({ STRIPE_SECRET_KEY: 'sk_live_123' })),
    ).toThrow('is a live key');
  });
});
