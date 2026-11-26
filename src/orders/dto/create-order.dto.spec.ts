import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateOrderDto, CreatePaymentSessionDto } from './create-order.dto';

function validBody(): Record<string, any> {
  return {
    email: 'customer@example.com',
    delivery: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      address: '1 Main St',
      apartment: '',
      city: 'Lahore',
      postalCode: '',
      country: 'Pakistan',
      phone: '',
    },
    items: [{ slug: 'neck-pillow-2-0', quantity: 1 }],
    discountCode: '',
    paymentSessionId: 'cs_test_a1B2c3',
  };
}

// Same options as the global ValidationPipe.
function validate(body: Record<string, any>) {
  const dto = plainToInstance(CreateOrderDto, body);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, errors };
}

describe('CreateOrderDto', () => {
  it('accepts a valid checkout body', () => {
    expect(validate(validBody()).errors).toHaveLength(0);
  });

  it('turns blank optional fields into undefined and trims text', () => {
    const body = validBody();
    body.delivery.firstName = '  Ada  ';
    const { dto, errors } = validate(body);

    expect(errors).toHaveLength(0);
    expect(dto.delivery.firstName).toBe('Ada');
    expect(dto.delivery.apartment).toBeUndefined();
    expect(dto.delivery.phone).toBeUndefined();
    expect(dto.discountCode).toBeUndefined();
  });

  it.each([
    ['an invalid email', (b: any) => (b.email = 'not-an-email')],
    ['a missing delivery', (b: any) => delete b.delivery],
    ['a blank first name', (b: any) => (b.delivery.firstName = '   ')],
    ['a missing city', (b: any) => delete b.delivery.city],
    ['a country not in the list', (b: any) => (b.delivery.country = 'France')],
    ['letters in the phone', (b: any) => (b.delivery.phone = 'call me')],
    ['an empty cart', (b: any) => (b.items = [])],
    ['quantity 0', (b: any) => (b.items[0].quantity = 0)],
    ['quantity 11', (b: any) => (b.items[0].quantity = 11)],
    ['a decimal quantity', (b: any) => (b.items[0].quantity = 1.5)],
    ['a malformed slug', (b: any) => (b.items[0].slug = 'Bad_Slug')],
    ['a price sent by the client', (b: any) => (b.items[0].price = 1)],
    ['a total sent by the client', (b: any) => (b.total = 1)],
    ['an unknown delivery field', (b: any) => (b.delivery.extra = 'x')],
    ['a missing payment session', (b: any) => delete b.paymentSessionId],
    [
      'a payment session that is not a Stripe session id',
      (b: any) => (b.paymentSessionId = 'pi_123'),
    ],
  ])('rejects %s', (_label, mutate) => {
    const body = validBody();
    mutate(body);
    expect(validate(body).errors.length).toBeGreaterThan(0);
  });

  it('rejects more than 20 cart lines', () => {
    const body = validBody();
    body.items = Array.from({ length: 21 }, (_, i) => ({
      slug: `product-${i}`,
      quantity: 1,
    }));
    expect(validate(body).errors.length).toBeGreaterThan(0);
  });
});

describe('CreatePaymentSessionDto', () => {
  function validateSession(body: Record<string, any>) {
    return validateSync(plainToInstance(CreatePaymentSessionDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  }

  it('accepts just the cart and a discount code', () => {
    expect(
      validateSession({
        items: [{ slug: 'neck-pillow-2-0', quantity: 2 }],
        discountCode: 'WELCOME10',
      }),
    ).toHaveLength(0);
  });

  it.each([
    ['an empty cart', { items: [] }],
    [
      'an email (not part of the session request)',
      {
        items: [{ slug: 'neck-pillow-2-0', quantity: 1 }],
        email: 'customer@example.com',
      },
    ],
    [
      'a total sent by the client',
      {
        items: [{ slug: 'neck-pillow-2-0', quantity: 1 }],
        total: 1,
      },
    ],
  ])('rejects %s', (_label, body) => {
    expect(validateSession(body).length).toBeGreaterThan(0);
  });
});
