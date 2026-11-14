import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

// A browser's Origin header is scheme + host (+ port) only. A trailing slash
// or path here would never match it and CORS would silently fail.
const ORIGIN_PATTERN = /^https?:\/\/[^/?#]+$/;
const ORIGIN_MESSAGE =
  '$property must be an origin like http://localhost:5173 (no path or trailing slash)';

// bcrypt hash format ($2a$/$2b$/$2y$, cost, 53 chars). Catches a plain
// password pasted into ADMIN_PASSWORD_HASH by mistake.
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

// Where product images are stored. `local` writes to ./uploads and serves it
// at /uploads (development only); `spaces` uses DigitalOcean Spaces.
export enum StorageDriver {
  Local = 'local',
  Spaces = 'spaces',
}

// Base URL images are served from, e.g. http://localhost:3000/uploads or the
// Spaces CDN URL. A path is allowed; a trailing slash is not (keys are
// appended as "/<key>").
const PUBLIC_BASE_URL_PATTERN = /^https?:\/\/[^?#\s]*[^/?#\s]$/;

const usesSpaces = (env: EnvironmentVariables) =>
  env.STORAGE_DRIVER === StorageDriver.Spaces;

// Every variable the app reads. Validated once at startup so a missing or
// malformed value stops the app immediately instead of failing mid-request.
export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsUrl({ require_tld: false, require_protocol: true })
  @Matches(ORIGIN_PATTERN, { message: ORIGIN_MESSAGE })
  FRONTEND_URL!: string;

  // Origin of the admin app (allowed by CORS next to FRONTEND_URL).
  @IsUrl({ require_tld: false, require_protocol: true })
  @Matches(ORIGIN_PATTERN, { message: ORIGIN_MESSAGE })
  ADMIN_URL!: string;

  // Single admin user; there is no admin users table.
  @IsEmail()
  ADMIN_EMAIL!: string;

  @Matches(BCRYPT_HASH_PATTERN, {
    message: 'ADMIN_PASSWORD_HASH must be a bcrypt hash, not a plain password',
  })
  ADMIN_PASSWORD_HASH!: string;

  // Signs admin tokens. Long enough that it can't be brute-forced offline.
  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  DB_HOST!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT: number = 5432;

  @IsString()
  @IsNotEmpty()
  DB_USERNAME!: string;

  @IsString()
  DB_PASSWORD!: string;

  @IsString()
  @IsNotEmpty()
  DB_NAME!: string;

  // Implicit conversion would turn the string "false" into true,
  // so read the raw value and accept only "true".
  @Transform(({ obj }: { obj: Record<string, unknown> }) => {
    const raw = obj.DB_SSL;
    return raw === true || raw === 'true';
  })
  @IsBoolean()
  DB_SSL: boolean = false;

  @IsString()
  @IsNotEmpty()
  STRIPE_SECRET_KEY!: string;

  @IsString()
  @IsNotEmpty()
  STRIPE_WEBHOOK_SECRET!: string;

  @IsString()
  @Length(3, 3)
  CURRENCY: string = 'usd';

  // Number of proxies in front of the app (DigitalOcean load balancer, CDN).
  // 0 locally. Lets rate limiting see the customer's real IP without
  // trusting IPs a client could fake in X-Forwarded-For.
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY_HOPS: number = 0;

  @IsEnum(StorageDriver)
  STORAGE_DRIVER: StorageDriver = StorageDriver.Local;

  @IsUrl({ require_tld: false, require_protocol: true })
  @Matches(PUBLIC_BASE_URL_PATTERN, {
    message: 'STORAGE_PUBLIC_URL must not end with a slash',
  })
  STORAGE_PUBLIC_URL!: string;

  // Required only when STORAGE_DRIVER=spaces.
  @ValidateIf(usesSpaces)
  @IsUrl({ require_protocol: true })
  SPACES_ENDPOINT?: string;

  @ValidateIf(usesSpaces)
  @IsString()
  @IsNotEmpty()
  SPACES_REGION?: string;

  @ValidateIf(usesSpaces)
  @IsString()
  @IsNotEmpty()
  SPACES_BUCKET?: string;

  @ValidateIf(usesSpaces)
  @IsString()
  @IsNotEmpty()
  SPACES_KEY?: string;

  @ValidateIf(usesSpaces)
  @IsString()
  @IsNotEmpty()
  SPACES_SECRET?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('\n  - ');
    throw new Error(`Invalid environment variables:\n  - ${details}`);
  }

  // Guard against loading the wrong env file: live Stripe keys only in
  // production, test keys everywhere else.
  const isLiveKey = /^(sk|rk)_live_/.test(validated.STRIPE_SECRET_KEY);
  const isProduction = validated.NODE_ENV === Environment.Production;
  if (isProduction && !isLiveKey) {
    throw new Error(
      'NODE_ENV is "production" but STRIPE_SECRET_KEY is not a live key.',
    );
  }
  if (!isProduction && isLiveKey) {
    throw new Error(
      `NODE_ENV is "${validated.NODE_ENV}" but STRIPE_SECRET_KEY is a live key. Use a test key (sk_test_...).`,
    );
  }

  // The app's disk on DigitalOcean is wiped on every deploy, so local image
  // storage would silently lose every uploaded product image.
  if (isProduction && validated.STORAGE_DRIVER !== StorageDriver.Spaces) {
    throw new Error(
      'NODE_ENV is "production" but STORAGE_DRIVER is not "spaces". Local uploads are lost on every deploy.',
    );
  }

  return validated;
}
