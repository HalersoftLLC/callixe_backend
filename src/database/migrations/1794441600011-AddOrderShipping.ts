import { MigrationInterface, QueryRunner } from 'typeorm';

// "Mark as shipped" in the admin panel. Both columns are nullable, so
// existing orders simply start as not shipped. shipped_at null = unfulfilled.
// Payment status (status column) is unrelated and still changes only through
// the Stripe webhook.
export class AddOrderShipping1794441600011 implements MigrationInterface {
  name = 'AddOrderShipping1794441600011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "shipped_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "shipping_email_sent_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "shipping_email_sent_at"`,
    );
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "shipped_at"`);
  }
}
