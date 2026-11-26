import { MigrationInterface, QueryRunner } from 'typeorm';

// "Buy one, get one 50% off" (orders/pricing.ts calculateDealDiscount).
// products.second_unit_half_off: off for every existing product, so no price
// changes here (EnableNeckPillowDeal turns it on for Thera Pillow 2.0). order_items.deal_discount: what the
// deal took off a line; existing lines get 0, so the new line_total check
// holds for them unchanged.
//
// `down` restores the old check (line_total = unit_price * quantity), which
// fails while any order line has a deal discount.
export class AddSecondUnitHalfOff1794441600013 implements MigrationInterface {
  name = 'AddSecondUnitHalfOff1794441600013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD "second_unit_half_off" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD "deal_discount" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD CONSTRAINT "CHK_order_items_deal_discount" CHECK ("deal_discount" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP CONSTRAINT "CHK_order_items_line_total"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD CONSTRAINT "CHK_order_items_line_total" CHECK ("line_total" = "unit_price" * "quantity" - "deal_discount")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP CONSTRAINT "CHK_order_items_line_total"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD CONSTRAINT "CHK_order_items_line_total" CHECK ("line_total" = "unit_price" * "quantity")`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP CONSTRAINT "CHK_order_items_deal_discount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP COLUMN "deal_discount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP COLUMN "second_unit_half_off"`,
    );
  }
}
