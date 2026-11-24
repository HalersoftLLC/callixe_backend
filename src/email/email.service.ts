import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/env.validation';

// Brevo transactional email API: https://developers.brevo.com/reference/sendtransacemail
export const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

// A hung request must not keep a promise (and its order data) alive forever.
const SEND_TIMEOUT_MS = 10_000;

// Brevo limits recipient and sender names to 70 characters.
const MAX_NAME_LENGTH = 70;

export interface EmailMessage {
  to: { email: string; name?: string };
  subject: string;
  html: string;
  // Plain-text version: shown by text-only clients and helps spam scoring.
  text: string;
  // Lets emails be filtered by kind in the Brevo dashboard.
  tags?: string[];
}

@Injectable()
export class EmailService {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // Sends one email and returns Brevo's message id. Throws on any failure;
  // callers decide whether a failed email matters.
  async send(message: EmailMessage): Promise<string> {
    const replyTo = this.config.get('EMAIL_REPLY_TO', { infer: true });
    const name = message.to.name?.slice(0, MAX_NAME_LENGTH);

    const response = await fetch(BREVO_SEND_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': this.config.get('BREVO_API_KEY', { infer: true }),
      },
      body: JSON.stringify({
        sender: {
          email: this.config.get('EMAIL_FROM', { infer: true }),
          name: this.config.get('EMAIL_FROM_NAME', { infer: true }),
        },
        to: [{ email: message.to.email, ...(name ? { name } : {}) }],
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
        ...(message.tags?.length ? { tags: message.tags } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `Brevo responded ${response.status}${await readBrevoError(response)}`,
      );
    }
    const body = (await response.json()) as { messageId?: string };
    return body.messageId ?? 'unknown';
  }
}

// Brevo errors look like { code, message }, e.g. "unauthorized" or an
// unrecognised IP. Only that is kept: never the request (API key, content).
async function readBrevoError(response: Response): Promise<string> {
  try {
    const { code, message } = (await response.json()) as {
      code?: string;
      message?: string;
    };
    return `: ${code ?? 'error'} - ${(message ?? '').slice(0, 200)}`;
  } catch {
    return '';
  }
}
