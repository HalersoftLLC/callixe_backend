import { OrderItem } from '../entities/order-item.entity';
import { Order, OrderStatus } from '../entities/order.entity';
import {
  buildOrderConfirmationEmail,
  escapeHtml,
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
    status: OrderStatus.Paid,
    stripeCheckoutSessionId: 'cs_test_1',
    stripePaymentIntentId: 'pi_1',
    items: [
      {
        id: 1,
        slug: 'neck-pillow-2-0',
        name: 'Neck Pillow 2.0',
        unitPrice: 36300,
        quantity: 2,
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

describe('escapeHtml', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
