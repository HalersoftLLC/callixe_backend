import { DiscountType } from './entities/discount-code.entity';
import {
  calculateDealDiscount,
  calculateDiscountAmount,
  calculateLineTotal,
  calculateSubtotal,
  calculateTotals,
} from './pricing';

describe('pricing', () => {
  describe('calculateDealDiscount', () => {
    it('is 0 when the product has no deal', () => {
      expect(calculateDealDiscount(36300, 2, false)).toBe(0);
    });

    it('is 0 for a single unit', () => {
      expect(calculateDealDiscount(36300, 1, true)).toBe(0);
    });

    it('takes half off every second unit', () => {
      expect(calculateDealDiscount(36300, 2, true)).toBe(18150);
      expect(calculateDealDiscount(36300, 3, true)).toBe(18150);
      expect(calculateDealDiscount(36300, 4, true)).toBe(36300);
    });

    it('rounds half an odd price down to whole cents', () => {
      expect(calculateDealDiscount(36301, 2, true)).toBe(18150);
    });
  });

  describe('calculateLineTotal', () => {
    it('multiplies unit price by quantity', () => {
      expect(calculateLineTotal(36300, 2)).toBe(72600);
    });

    it('subtracts the deal discount', () => {
      // 2 for 1.5x the price
      expect(calculateLineTotal(36300, 2, 18150)).toBe(54450);
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

    it('uses the line totals after the deal', () => {
      expect(
        calculateSubtotal([
          { unitPrice: 36300, quantity: 2, dealDiscount: 18150 },
          { unitPrice: 13800, quantity: 1 },
        ]),
      ).toBe(68250);
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

    it('applies a discount code after the deal', () => {
      expect(
        calculateTotals(
          [{ unitPrice: 36300, quantity: 2, dealDiscount: 18150 }],
          { type: DiscountType.Percent, value: 10 },
          0,
        ),
      ).toEqual({
        subtotal: 54450,
        discountAmount: 5445,
        shipping: 0,
        total: 49005,
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
