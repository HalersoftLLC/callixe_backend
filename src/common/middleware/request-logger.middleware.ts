import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

// Global functional middleware (registered with app.use in main.ts).
// Logs client IP, method, path, status, and duration once the response is sent.
// The IP shows whether TRUST_PROXY_HOPS is right: on DigitalOcean it must be
// the customer's IP, not the proxy's (the same IP the rate limiter uses).
// Never logs bodies, headers or query strings: they can contain customer
// details (e.g. /admin/orders?email=…) and secrets. Only the path is logged.
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();
  const { method } = req;
  const path = withoutQuery(req.originalUrl);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const message = `${req.ip} ${method} ${path} ${res.statusCode} - ${durationMs.toFixed(1)}ms`;

    if (res.statusCode >= 500) logger.error(message);
    else if (res.statusCode >= 400) logger.warn(message);
    else logger.log(message);
  });

  next();
}

export function withoutQuery(url: string): string {
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : url.slice(0, queryStart);
}
