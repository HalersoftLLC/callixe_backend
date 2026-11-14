import { DiscountType } from './entities/discount-code.entity';

// Pure money functions: no database, no Nest. All amounts are integer cents.

export interface PricedLine {
  unitPrice: number;
  quantity: number;
}

export interface Discount {
  type: DiscountType;
  value: number;
}

export interface OrderTotals {
  subtotal: number;
  discountAmount: number;
  shipping: number;
  total: number;
}

export function calculateLineTotal(unitPrice: number, quantity: number) {
  return unitPrice * quantity;
}

export function calculateSubtotal(lines: PricedLine[]): number {
  return lines.reduce(
    (sum, line) => sum + calculateLineTotal(line.unitPrice, line.quantity),
    0,
  );
}

// Same rule as the frontend: percent rounds to the nearest cent, and a
// discount can never exceed the subtotal.
export function calculateDiscountAmount(
  discount: Discount | null,
  subtotal: number,
): number {
  if (!discount) return 0;
  const amount =
    discount.type === DiscountType.Percent
      ? Math.round((subtotal * discount.value) / 100)
      : discount.value;
  return Math.min(amount, subtotal);
}

export function calculateTotals(
  lines: PricedLine[],
  discount: Discount | null,
  shipping: number,
): OrderTotals {
  const subtotal = calculateSubtotal(lines);
  const discountAmount = calculateDiscountAmount(discount, subtotal);
  return {
    subtotal,
    discountAmount,
    shipping,
    total: subtotal - discountAmount + shipping,
  };
}
