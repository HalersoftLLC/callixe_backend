import { DiscountCode, DiscountType } from '../entities/discount-code.entity';
import { Order, OrderStatus } from '../entities/order.entity';

// Response of POST /orders. The frontend redirects to `checkoutUrl`
// (Stripe-hosted payment page).
export class CreateOrderResponseDto {
  orderId!: string;
  orderNumber!: number;
  total!: number;
  checkoutUrl!: string;

  static fromEntity(order: Order, checkoutUrl: string): CreateOrderResponseDto {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      total: order.total,
      checkoutUrl,
    };
  }
}

export class OrderItemResponseDto {
  slug!: string;
  name!: string;
  unitPrice!: number;
  quantity!: number;
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
        lineTotal: item.lineTotal,
      })),
      subtotal: order.subtotal,
      discountCode: order.discountCode,
      discountAmount: order.discountAmount,
      shipping: order.shipping,
      total: order.total,
      currency: order.currency,
    };
  }
}

export class DiscountResponseDto {
  code!: string;
  type!: DiscountType;
  value!: number;

  static fromEntity(discount: DiscountCode): DiscountResponseDto {
    return { code: discount.code, type: discount.type, value: discount.value };
  }
}
