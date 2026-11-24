import { MigrationInterface, QueryRunner } from 'typeorm';

// Stripe Adaptive Pricing: the customer may pay in their local currency.
// These columns record what they paid (Checkout Session presentment_details)
// for display only; prices, totals and reports stay in "currency". Both
// nullable, so existing orders need no data change.
export class AddOrderPresentment1794441600012 implements MigrationInterface {
  name = 'AddOrderPresentment1794441600012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "presentment_amount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "presentment_currency" character varying(3)`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "CHK_orders_presentment" CHECK (("presentment_amount" IS NULL AND "presentment_currency" IS NULL) OR ("presentment_amount" >= 0 AND "presentment_currency" IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "CHK_orders_presentment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "presentment_currency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "presentment_amount"`,
    );
  }
}
