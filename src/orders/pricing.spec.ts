import { DiscountType } from './entities/discount-code.entity';
import {
  calculateDiscountAmount,
  calculateLineTotal,
  calculateSubtotal,
  calculateTotals,
} from './pricing';

describe('pricing', () => {
  describe('calculateLineTotal', () => {
    it('multiplies unit price by quantity', () => {
      expect(calculateLineTotal(36300, 2)).toBe(72600);
    });
  });

  describe('calculateSubtotal', () => {
    it('sums all lines', () => {
      expect(
        calculateSubtotal([
          { unitPrice: 36300, quantity: 2 },
          { unitPrice: 13800, quantity: 1 },
        ]),
      ).toBe(86400);
    });

    it('is 0 for no lines', () => {
      expect(calculateSubtotal([])).toBe(0);
    });
  });

  describe('calculateDiscountAmount', () => {
    it('is 0 without a discount', () => {
      expect(calculateDiscountAmount(null, 10000)).toBe(0);
    });

    it('applies a percent discount', () => {
      expect(
        calculateDiscountAmount(
          { type: DiscountType.Percent, value: 10 },
          36300,
        ),
      ).toBe(3630);
    });

    it('rounds a percent discount to the nearest cent', () => {
      // 10% of 13805 = 1380.5 -> 1381
      expect(
        calculateDiscountAmount(
          { type: DiscountType.Percent, value: 10 },
          13805,
        ),
      ).toBe(1381);
    });

    it('applies a fixed discount', () => {
      expect(
        calculateDiscountAmount(
          { type: DiscountType.Fixed, value: 500 },
          13800,
        ),
      ).toBe(500);
    });

    it('never exceeds the subtotal (fixed)', () => {
      expect(
        calculateDiscountAmount({ type: DiscountType.Fixed, value: 500 }, 300),
      ).toBe(300);
    });

    it('never exceeds the subtotal (100%)', () => {
      expect(
        calculateDiscountAmount(
          { type: DiscountType.Percent, value: 100 },
          13800,
        ),
      ).toBe(13800);
    });
  });

  describe('calculateTotals', () => {
    it('combines subtotal, discount, and shipping', () => {
      expect(
        calculateTotals(
          [{ unitPrice: 36300, quantity: 1 }],
          { type: DiscountType.Percent, value: 10 },
          0,
        ),
      ).toEqual({
        subtotal: 36300,
        discountAmount: 3630,
        shipping: 0,
        total: 32670,
      });
    });

    it('adds shipping to the total', () => {
      expect(
        calculateTotals([{ unitPrice: 1000, quantity: 1 }], null, 250),
      ).toEqual({
        subtotal: 1000,
        discountAmount: 0,
        shipping: 250,
        total: 1250,
      });
    });

    it('never produces a negative total', () => {
      const totals = calculateTotals(
        [{ unitPrice: 300, quantity: 1 }],
        { type: DiscountType.Fixed, value: 500 },
        0,
      );
      expect(totals.total).toBe(0);
    });
  });
});
