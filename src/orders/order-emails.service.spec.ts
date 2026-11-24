import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmailService } from '../email/email.service';
import { Order } from './entities/order.entity';
import { OrderEmailsService } from './order-emails.service';

const ENV: Record<string, string> = {
  FRONTEND_URL: 'https://callixe.co',
  EMAIL_FROM_NAME: 'Callixe',
};

const PAID_ORDER = {
  id: 'order-uuid',
  orderNumber: 1001,
  email: 'customer@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  address: '1 Main St',
  apartment: null,
  city: 'Lahore',
  postalCode: null,
  country: 'Pakistan',
  phone: null,
  subtotal: 36300,
  discountCode: null,
  discountAmount: 0,
  shipping: 0,
  total: 36300,
  currency: 'usd',
  items: [
    {
      id: 1,
      slug: 'neck-pillow-2-0',
      name: 'Neck Pillow 2.0',
      unitPrice: 36300,
      quantity: 1,
      lineTotal: 36300,
    },
  ],
  createdAt: new Date('2026-11-24T10:00:00Z'),
};

describe('OrderEmailsService', () => {
  let service: OrderEmailsService;
  const ordersRepository = { findOne: jest.fn() };
  const emailService = { send: jest.fn() };
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(async () => {
    jest.resetAllMocks();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    ordersRepository.findOne.mockResolvedValue(PAID_ORDER);
    emailService.send.mockResolvedValue('<m1@brevo>');

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderEmailsService,
        { provide: getRepositoryToken(Order), useValue: ordersRepository },
        { provide: EmailService, useValue: emailService },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => ENV[key] },
        },
      ],
    }).compile();
    service = moduleRef.get(OrderEmailsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads the order with its items and emails the customer', async () => {
    await service.sendConfirmation('order-uuid');

    expect(ordersRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'order-uuid' },
      relations: { items: true },
      order: { items: { id: 'ASC' } },
    });
    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: { email: 'customer@example.com', name: 'Ada Lovelace' },
        subject: 'Order #1001 confirmed – Callixe',
        tags: ['order-confirmation'],
        html: expect.stringContaining(
          'https://callixe.co/order-confirmation/order-uuid',
        ) as unknown,
      }),
    );
    expect(log).toHaveBeenCalledWith(
      'Confirmation email sent for order #1001 (<m1@brevo>)',
    );
  });

  it('never throws when Brevo fails, and logs without the customer email', async () => {
    emailService.send.mockRejectedValue(new Error('Brevo responded 401'));

    await expect(
      service.sendConfirmation('order-uuid'),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      'Confirmation email failed for order order-uuid: Brevo responded 401',
    );
  });

  it('never throws when the database read fails', async () => {
    ordersRepository.findOne.mockRejectedValue(new Error('connection lost'));

    await expect(
      service.sendConfirmation('order-uuid'),
    ).resolves.toBeUndefined();

    expect(emailService.send).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('skips a missing order with a warning', async () => {
    ordersRepository.findOne.mockResolvedValue(null);

    await service.sendConfirmation('order-uuid');

    expect(emailService.send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Confirmation email: order order-uuid not found',
    );
  });
});
