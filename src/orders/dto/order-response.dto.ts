import { DiscountCode, DiscountType } from '../entities/discount-code.entity';
import { Order, OrderStatus } from '../entities/order.entity';

// Response of POST /orders/payment-session. The frontend mounts Stripe
// Elements (Currency Selector + Payment Element) with `clientSecret` and
// sends `sessionId` back as `paymentSessionId` with POST /orders.
export class PaymentSessionResponseDto {
  sessionId!: string;
  clientSecret!: string;
  total!: number;
}

// Response of POST /orders. The frontend then calls Stripe's confirm() with
// returnUrl /order-confirmation/<orderId>.
export class CreateOrderResponseDto {
  orderId!: string;
  orderNumber!: number;
  total!: number;

  static fromEntity(order: Order): CreateOrderResponseDto {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      total: order.total,
    };
  }
}

export class OrderItemResponseDto {
  slug!: string;
  name!: string;
  unitPrice!: number;
  quantity!: number;
  // "Buy one, get one 50% off" saving, already subtracted from lineTotal.
  dealDiscount!: number;
  lineTotal!: number;
}

// Response of GET /orders/:id: only what the confirmation page shows.
// Phone, Stripe IDs, and internal timestamps are never returned.
export class OrderResponseDto {
  orderId!: string;
  orderNumber!: number;
  status!: OrderStatus;
  email!: string;
  delivery!: {
    firstName: string;
    lastName: string;
    address: string;
    apartment: string | null;
    city: string;
    postalCode: string | null;
    country: string;
  };
  items!: OrderItemResponseDto[];
  subtotal!: number;
  discountCode!: string | null;
  discountAmount!: number;
  shipping!: number;
  total!: number;
  currency!: string;
  // What the customer paid in their own currency (Stripe Adaptive Pricing);
  // null when they paid in `currency` or the order isn't paid. Display only.
  presentment!: { amount: number; currency: string } | null;

  static fromEntity(order: Order): OrderResponseDto {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      email: order.email,
      delivery: {
        firstName: order.firstName,
        lastName: order.lastName,
        address: order.address,
        apartment: order.apartment,
        city: order.city,
        postalCode: order.postalCode,
        country: order.country,
      },
      items: order.items.map((item) => ({
        slug: item.slug,
        name: item.name,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        dealDiscount: item.dealDiscount,
        lineTotal: item.lineTotal,
      })),
      subtotal: order.subtotal,
      discountCode: order.discountCode,
      discountAmount: order.discountAmount,
      shipping: order.shipping,
      total: order.total,
      currency: order.currency,
      presentment: toPresentmentResponse(order),
    };
  }
}

// Shared by the public and admin order responses.
export function toPresentmentResponse(
  order: Pick<Order, 'presentmentAmount' | 'presentmentCurrency'>,
): { amount: number; currency: string } | null {
  return order.presentmentAmount !== null && order.presentmentCurrency
    ? { amount: order.presentmentAmount, currency: order.presentmentCurrency }
    : null;
}

export class DiscountResponseDto {
  code!: string;
  type!: DiscountType;
  value!: number;

  static fromEntity(discount: DiscountCode): DiscountResponseDto {
    return { code: discount.code, type: discount.type, value: discount.value };
  }
}
