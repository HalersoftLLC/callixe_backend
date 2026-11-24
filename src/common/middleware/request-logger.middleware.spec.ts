import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { requestLogger, withoutQuery } from './request-logger.middleware';

function run(originalUrl: string, statusCode = 200): string[] {
  const lines: string[] = [];
  const record = (message: unknown) => {
    lines.push(String(message));
  };
  jest.spyOn(Logger.prototype, 'log').mockImplementation(record);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(record);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(record);

  const res = Object.assign(new EventEmitter(), { statusCode });
  const next: NextFunction = jest.fn();
  requestLogger(
    { method: 'GET', originalUrl, ip: '203.0.113.7' } as Request,
    res as unknown as Response,
    next,
  );
  res.emit('finish');
  return lines;
}

describe('requestLogger', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs IP, method, path and status', () => {
    const [line] = run('/admin/orders');

    expect(line).toMatch(/^203\.0\.113\.7 GET \/admin\/orders 200 - [\d.]+ms$/);
  });

  it('never logs the query string (it can hold customer emails)', () => {
    const [line] = run(
      '/admin/orders?email=customer%40example.com&page=2',
      404,
    );

    expect(line).toContain('GET /admin/orders 404');
    expect(line).not.toContain('email');
    expect(line).not.toContain('example.com');
    expect(line).not.toContain('?');
  });
});

describe('withoutQuery', () => {
  it.each([
    ['/products', '/products'],
    ['/admin/customers/detail?email=a%40b.c', '/admin/customers/detail'],
    ['/x?', '/x'],
  ])('%s → %s', (url, expected) => {
    expect(withoutQuery(url)).toBe(expected);
  });
});
