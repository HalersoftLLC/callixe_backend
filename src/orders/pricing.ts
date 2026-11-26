import { DiscountType } from './entities/discount-code.entity';

// Pure money functions: no database, no Nest. All amounts are integer cents.

export interface PricedLine {
  unitPrice: number;
  quantity: number;
  // From calculateDealDiscount; 0 or missing = no deal on this line.
  dealDiscount?: number;
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

// "Buy one, get one 50% off": every second unit of the same product costs
// half. Half the price is rounded down to whole cents, so 2 units of 36301
// take 18150 off. Must match the storefront's cart (CartProvider).
export function calculateDealDiscount(
  unitPrice: number,
  quantity: number,
  secondUnitHalfOff: boolean,
): number {
  if (!secondUnitHalfOff) return 0;
  return Math.floor(quantity / 2) * Math.floor(unitPrice / 2);
}

export function calculateLineTotal(
  unitPrice: number,
  quantity: number,
  dealDiscount = 0,
) {
  return unitPrice * quantity - dealDiscount;
}

export function calculateSubtotal(lines: PricedLine[]): number {
  return lines.reduce(
    (sum, line) =>
      sum +
      calculateLineTotal(line.unitPrice, line.quantity, line.dealDiscount),
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
