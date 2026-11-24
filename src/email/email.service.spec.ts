import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BREVO_SEND_URL, EmailMessage, EmailService } from './email.service';

const ENV: Record<string, string | undefined> = {
  BREVO_API_KEY: 'xkeysib-test',
  EMAIL_FROM: 'orders@callixe.co',
  EMAIL_FROM_NAME: 'Callixe',
  EMAIL_REPLY_TO: undefined,
};

const MESSAGE: EmailMessage = {
  to: { email: 'customer@example.com', name: 'Ada Lovelace' },
  subject: 'Order #1001 confirmed – Callixe',
  html: '<p>Hi</p>',
  text: 'Hi',
  tags: ['order-confirmation'],
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  };
}

describe('EmailService', () => {
  let service: EmailService;
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  let env: Record<string, string | undefined>;

  beforeAll(() => {
    global.fetch = fetchMock;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(async () => {
    fetchMock.mockReset();
    env = { ...ENV };
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
      ],
    }).compile();
    service = moduleRef.get(EmailService);
  });

  function sentRequest(): { init: RequestInit; body: Record<string, unknown> } {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(BREVO_SEND_URL);
    return {
      init,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    };
  }

  it('sends the email through Brevo and returns the message id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { messageId: '<m1@brevo>' }));

    await expect(service.send(MESSAGE)).resolves.toBe('<m1@brevo>');

    const { init, body } = sentRequest();
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'api-key': 'xkeysib-test' });
    // Timeout signal, so a hung Brevo request is aborted.
    expect(init.signal).toBeDefined();
    expect(body).toEqual({
      sender: { email: 'orders@callixe.co', name: 'Callixe' },
      to: [{ email: 'customer@example.com', name: 'Ada Lovelace' }],
      subject: MESSAGE.subject,
      htmlContent: '<p>Hi</p>',
      textContent: 'Hi',
      tags: ['order-confirmation'],
    });
  });

  it('adds replyTo only when EMAIL_REPLY_TO is set', async () => {
    env.EMAIL_REPLY_TO = 'help@callixe.co';
    fetchMock.mockResolvedValue(jsonResponse(201, { messageId: '<m1@brevo>' }));

    await service.send(MESSAGE);

    expect(sentRequest().body.replyTo).toEqual({ email: 'help@callixe.co' });
  });

  it('cuts the recipient name to Brevo’s 70-character limit', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { messageId: '<m1@brevo>' }));

    await service.send({
      ...MESSAGE,
      to: { email: 'customer@example.com', name: 'x'.repeat(100) },
    });

    const [recipient] = sentRequest().body.to as { name: string }[];
    expect(recipient.name).toHaveLength(70);
  });

  it('throws with Brevo’s error code and message, never the API key', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { code: 'unauthorized', message: 'Key not found' }),
    );

    const error = (await service
      .send(MESSAGE)
      .catch((e: unknown) => e)) as Error;

    expect(error.message).toBe(
      'Brevo responded 401: unauthorized - Key not found',
    );
    expect(error.message).not.toContain('xkeysib-test');
  });

  it('still throws when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: jest.fn().mockRejectedValue(new SyntaxError('bad json')),
    });

    await expect(service.send(MESSAGE)).rejects.toThrow('Brevo responded 502');
  });

  it('passes network errors and timeouts to the caller', async () => {
    fetchMock.mockRejectedValue(new Error('The operation was aborted'));

    await expect(service.send(MESSAGE)).rejects.toThrow(
      'The operation was aborted',
    );
  });
});
