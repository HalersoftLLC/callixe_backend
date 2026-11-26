import { OrderItem } from '../entities/order-item.entity';
import { Order, OrderStatus } from '../entities/order.entity';
import { buildOrderShippedEmail } from './order-shipped.email';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-uuid',
    orderNumber: 1011,
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
    shippedAt: new Date('2026-11-25T09:00:00Z'),
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

describe('buildOrderShippedEmail', () => {
  const OPTIONS = { storeName: 'Callixe' };

  it('uses the order number in the subject', () => {
    const email = buildOrderShippedEmail(makeOrder(), OPTIONS);

    expect(email.subject).toBe('Your order #1011 is on its way – Callixe');
  });

  it('tells the customer the order was dispatched, in HTML and text', () => {
    const email = buildOrderShippedEmail(makeOrder(), OPTIONS);

    for (const body of [email.html, email.text]) {
      expect(body).toContain('#1011');
      expect(body).toContain('handed to our delivery partner');
      expect(body).toContain('Neck Pillow 2.0');
      expect(body).toContain('$726.00');
      expect(body).toContain('1 Main St');
      expect(body).toContain('Lahore 54000');
    }
  });

  it('has no link to the order page', () => {
    const email = buildOrderShippedEmail(makeOrder(), OPTIONS);

    expect(email.html).not.toContain('<a href');
    expect(email.html).not.toContain('order-confirmation');
    expect(email.text).not.toContain('http');
  });

  it('escapes customer input in the HTML', () => {
    const email = buildOrderShippedEmail(
      makeOrder({
        firstName: '<script>alert(1)</script>',
        address: '"><img src=x>',
      }),
      OPTIONS,
    );

    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<img src=x>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
