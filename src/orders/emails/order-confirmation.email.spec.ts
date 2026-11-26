import { OrderItem } from '../entities/order-item.entity';
import { Order, OrderStatus } from '../entities/order.entity';
import {
  buildOrderConfirmationEmail,
  escapeHtml,
  moneyFormatter,
} from './order-confirmation.email';

const OPTIONS = {
  storeName: 'Callixe',
  orderUrl: 'https://callixe.co/order-confirmation/order-uuid',
};

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-uuid',
    orderNumber: 1001,
    email: 'customer@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    address: '1 Main St',
    apartment: null,
    city: 'Lahore',
    postalCode: '54000',
    country: 'Pakistan',
    phone: null,
    subtotal: 72600,
    discountCode: null,
    discountAmount: 0,
    shipping: 0,
    total: 72600,
    currency: 'usd',
    presentmentAmount: null,
    presentmentCurrency: null,
    status: OrderStatus.Paid,
    stripeCheckoutSessionId: 'cs_test_1',
    stripePaymentIntentId: 'pi_1',
    shippedAt: null,
    shippingEmailSentAt: null,
    items: [
      {
        id: 1,
        slug: 'neck-pillow-2-0',
        name: 'Neck Pillow 2.0',
        unitPrice: 36300,
        quantity: 2,
        dealDiscount: 0,
        lineTotal: 72600,
      } as OrderItem,
    ],
    createdAt: new Date('2026-11-24T10:00:00Z'),
    updatedAt: new Date('2026-11-24T10:00:00Z'),
    ...overrides,
  };
}

describe('buildOrderConfirmationEmail', () => {
  it('builds the subject from the order number and store name', () => {
    const { subject } = buildOrderConfirmationEmail(makeOrder(), OPTIONS);

    expect(subject).toBe('Order #1001 confirmed – Callixe');
  });

  it('shows items, totals, date, address and the order link', () => {
    const { html, text } = buildOrderConfirmationEmail(makeOrder(), OPTIONS);

    for (const body of [html, text]) {
      expect(body).toContain('Neck Pillow 2.0');
      expect(body).toContain('$726.00');
      expect(body).toContain('November 24, 2026');
      expect(body).toContain('1 Main St');
      expect(body).toContain('Lahore 54000');
      expect(body).toContain('Pakistan');
      expect(body).toContain(OPTIONS.orderUrl);
    }
    expect(html).toContain('Qty 2 × $363.00');
    expect(html).toContain('Free');
  });

  it('marks a "buy one, get one 50% off" line', () => {
    const plain = buildOrderConfirmationEmail(makeOrder(), OPTIONS);
    expect(plain.html).not.toContain('2nd 50% off');

    const deal = buildOrderConfirmationEmail(
      makeOrder({
        items: [
          {
            id: 1,
            slug: 'neck-pillow-2-0',
            name: 'Neck Pillow 2.0',
            unitPrice: 36300,
            quantity: 2,
            dealDiscount: 18150,
            lineTotal: 54450,
          } as OrderItem,
        ],
        subtotal: 54450,
        total: 54450,
      }),
      OPTIONS,
    );
    expect(deal.html).toContain('Qty 2 × $363.00 · 2nd 50% off');
    expect(deal.html).toContain('$544.50');
    expect(deal.text).toContain('Neck Pillow 2.0 x 2 (2nd 50% off)  $544.50');
  });

  it('shows the discount line only when there is a discount', () => {
    const plain = buildOrderConfirmationEmail(makeOrder(), OPTIONS);
    expect(plain.html).not.toContain('Discount');
    expect(plain.text).not.toContain('Discount');

    const discounted = buildOrderConfirmationEmail(
      makeOrder({
        discountCode: 'WELCOME10',
        discountAmount: 7260,
        total: 65340,
      }),
      OPTIONS,
    );
    expect(discounted.html).toContain('Discount (WELCOME10)');
    expect(discounted.html).toContain('−$72.60');
    expect(discounted.html).toContain('$653.40');
    expect(discounted.text).toContain('Discount (WELCOME10): -$72.60');
  });

  it('adds what the customer paid in their own currency, after the USD total', () => {
    const plain = buildOrderConfirmationEmail(makeOrder(), OPTIONS);
    expect(plain.html).not.toContain('Paid in your currency');
    expect(plain.text).not.toContain('Paid in your currency');

    const converted = buildOrderConfirmationEmail(
      makeOrder({ presentmentAmount: 20480000, presentmentCurrency: 'pkr' }),
      OPTIONS,
    );
    expect(converted.html).toContain('$726.00');
    expect(converted.html).toContain('Paid in your currency');
    expect(converted.html).toContain('PKR');
    expect(converted.html).toContain('204,800.00');
    expect(converted.text).toContain(
      'Total: $726.00\nPaid in your currency: PKR',
    );
  });

  it('leaves out empty optional address lines', () => {
    const { text } = buildOrderConfirmationEmail(
      makeOrder({ apartment: 'Flat 2', postalCode: null, phone: '+92 300' }),
      OPTIONS,
    );

    expect(text).toContain('1 Main St\nFlat 2\nLahore\nPakistan\n+92 300');
  });

  it('escapes customer input so it cannot inject HTML', () => {
    const { html } = buildOrderConfirmationEmail(
      makeOrder({
        firstName: '<script>alert(1)</script>',
        address: '<a href="https://evil.example">click</a>',
      }),
      OPTIONS,
    );

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="https://evil.example"');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('moneyFormatter', () => {
  it('uses each currency’s smallest unit', () => {
    expect(moneyFormatter('usd')(72600)).toBe('$726.00');
    expect(moneyFormatter('jpy')(1500)).toBe('¥1,500');
    // Intl puts a non-breaking space after the code.
    expect(moneyFormatter('kwd')(1234)).toMatch(/^KWD\s1\.234$/);
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
