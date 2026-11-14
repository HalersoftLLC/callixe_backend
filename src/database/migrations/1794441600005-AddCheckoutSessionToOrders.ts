import { MigrationInterface, QueryRunner } from 'typeorm';

// Matches Order.stripeCheckoutSessionId in src/orders/entities/order.entity.ts.
// The webhook finds the order by this ID (CLAUDE.md section 14).
export class AddCheckoutSessionToOrders1794441600005 implements MigrationInterface {
  name = 'AddCheckoutSessionToOrders1794441600005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "stripe_checkout_session_id" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "UQ_orders_stripe_checkout_session_id" UNIQUE ("stripe_checkout_session_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "UQ_orders_stripe_checkout_session_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "stripe_checkout_session_id"`,
    );
  }
}
