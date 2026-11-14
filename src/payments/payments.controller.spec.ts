import { BadRequestException, Logger } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { OrdersService } from '../orders/orders.service';
import { PaymentsController } from './payments.controller';
import { PaymentOutcome, PaymentsService } from './payments.service';

describe('PaymentsController (webhook)', () => {
  let controller: PaymentsController;

  const paymentsService = {
    constructWebhookEvent: jest.fn(),
    toPaymentOutcome: jest.fn(),
  };
  const ordersService = { applyPaymentOutcome: jest.fn() };

  const rawBody = Buffer.from('{"id":"evt_1"}');
  const req = { rawBody } as RawBodyRequest<Request>;
  const event = { id: 'evt_1', type: 'checkout.session.completed' };
  const outcome: PaymentOutcome = {
    eventId: 'evt_1',
    eventType: 'checkout.session.completed',
    sessionId: 'cs_test_1',
    result: 'paid',
    paymentIntentId: 'pi_1',
    amountTotal: 72600,
    currency: 'usd',
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: paymentsService },
        { provide: OrdersService, useValue: ordersService },
      ],
    }).compile();
    controller = moduleRef.get(PaymentsController);
  });

  it('passes the raw body and signature header to verification', async () => {
    paymentsService.constructWebhookEvent.mockReturnValue(event);
    paymentsService.toPaymentOutcome.mockReturnValue(outcome);

    await controller.handleWebhook(req, 't=1,v1=ok');

    expect(paymentsService.constructWebhookEvent).toHaveBeenCalledWith(
      rawBody,
      't=1,v1=ok',
    );
  });

  it('rejects an invalid signature with 400 and changes nothing', async () => {
    paymentsService.constructWebhookEvent.mockImplementation(() => {
      throw new BadRequestException('Invalid Stripe signature');
    });

    await expect(
      controller.handleWebhook(req, 't=1,v1=bad'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ordersService.applyPaymentOutcome).not.toHaveBeenCalled();
  });

  it('applies a handled event to the order', async () => {
    paymentsService.constructWebhookEvent.mockReturnValue(event);
    paymentsService.toPaymentOutcome.mockReturnValue(outcome);

    await expect(controller.handleWebhook(req, 'sig')).resolves.toEqual({
      received: true,
    });
    expect(ordersService.applyPaymentOutcome).toHaveBeenCalledTimes(1);
    expect(ordersService.applyPaymentOutcome).toHaveBeenCalledWith(outcome);
  });

  it('acknowledges unhandled events without touching orders', async () => {
    paymentsService.constructWebhookEvent.mockReturnValue({
      id: 'evt_2',
      type: 'charge.refunded',
    });
    paymentsService.toPaymentOutcome.mockReturnValue(null);

    await expect(controller.handleWebhook(req, 'sig')).resolves.toEqual({
      received: true,
    });
    expect(ordersService.applyPaymentOutcome).not.toHaveBeenCalled();
  });
});
