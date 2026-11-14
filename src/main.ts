import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { requestLogger } from './common/middleware/request-logger.middleware';
import { EnvironmentVariables, StorageDriver } from './config/env.validation';
import {
  LOCAL_UPLOADS_DIR,
  UPLOADS_ROUTE,
} from './products/storage/local-image-storage';

async function bootstrap() {
  // rawBody keeps the unparsed request body available for
  // Stripe webhook signature verification (CLAUDE.md section 6).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  // Behind DigitalOcean's proxy every request would otherwise appear to come
  // from the proxy's IP, and all customers would share one rate limit.
  // Trust exactly the configured number of hops, never `true` (spoofable).
  const trustProxyHops = config.get('TRUST_PROXY_HOPS', { infer: true });
  if (trustProxyHops > 0) {
    app.set('trust proxy', trustProxyHops);
  }

  // Global middleware: runs first for every route
  app.use(requestLogger);

  // Only the storefront and the admin app may call this API from a browser.
  // Authorization carries the admin token; PATCH/PUT/DELETE are admin-only routes.
  // Stripe webhooks are server-to-server and are not affected by CORS.
  app.enableCors({
    origin: [
      config.get('FRONTEND_URL', { infer: true }),
      config.get('ADMIN_URL', { infer: true }),
    ],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Development image storage: serve ./uploads at /uploads, the same way the
  // Spaces CDN serves files in production. Read-only, no directory listing,
  // no dotfiles. Keys are never reused, so files can be cached forever.
  // nosniff stops a browser from treating an image as anything else.
  if (config.get('STORAGE_DRIVER', { infer: true }) === StorageDriver.Local) {
    app.useStaticAssets(LOCAL_UPLOADS_DIR, {
      prefix: `${UPLOADS_ROUTE}/`,
      index: false,
      dotfiles: 'deny',
      immutable: true,
      maxAge: '1y',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    });
  }

  // Runs lifecycle shutdown hooks so the database pool closes cleanly.
  app.enableShutdownHooks();

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
