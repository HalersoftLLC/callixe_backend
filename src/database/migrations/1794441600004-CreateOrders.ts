import { MigrationInterface, QueryRunner } from 'typeorm';

// Matches src/orders/entities/order.entity.ts and order-item.entity.ts exactly.
export class CreateOrders1794441600004 implements MigrationInterface {
  name = 'CreateOrders1794441600004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "order_number" SERIAL NOT NULL,
        "email" character varying(254) NOT NULL,
        "first_name" character varying(100) NOT NULL,
        "last_name" character varying(100) NOT NULL,
        "address" character varying(200) NOT NULL,
        "apartment" character varying(100),
        "city" character varying(100) NOT NULL,
        "postal_code" character varying(20),
        "country" character varying(100) NOT NULL,
        "phone" character varying(30),
        "subtotal" integer NOT NULL,
        "discount_code" character varying(50),
        "discount_amount" integer NOT NULL DEFAULT 0,
        "shipping" integer NOT NULL,
        "total" integer NOT NULL,
        "currency" character varying(3) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "stripe_payment_intent_id" character varying(255),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_orders_order_number" UNIQUE ("order_number"),
        CONSTRAINT "UQ_orders_stripe_payment_intent_id" UNIQUE ("stripe_payment_intent_id"),
        CONSTRAINT "CHK_orders_status" CHECK ("status" IN ('pending', 'paid', 'failed')),
        CONSTRAINT "CHK_orders_amounts" CHECK ("subtotal" >= 0 AND "discount_amount" >= 0 AND "shipping" >= 0 AND "total" >= 0),
        CONSTRAINT "CHK_orders_total" CHECK ("total" = "subtotal" - "discount_amount" + "shipping"),
        CONSTRAINT "PK_orders" PRIMARY KEY ("id")
      )
    `);

    // Human-friendly order numbers start at 1001.
    await queryRunner.query(
      `ALTER SEQUENCE "orders_order_number_seq" RESTART WITH 1001`,
    );

    await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id" SERIAL NOT NULL,
        "order_id" uuid NOT NULL,
        "slug" character varying(100) NOT NULL,
        "name" character varying(200) NOT NULL,
        "unit_price" integer NOT NULL,
        "quantity" integer NOT NULL,
        "line_total" integer NOT NULL,
        CONSTRAINT "CHK_order_items_quantity" CHECK ("quantity" BETWEEN 1 AND 10),
        CONSTRAINT "CHK_order_items_unit_price" CHECK ("unit_price" >= 0),
        CONSTRAINT "CHK_order_items_line_total" CHECK ("line_total" = "unit_price" * "quantity"),
        CONSTRAINT "PK_order_items" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_order_items_order_id" ON "order_items" ("order_id")`,
    );

    await queryRunner.query(`
      ALTER TABLE "order_items"
        ADD CONSTRAINT "FK_order_items_order_id"
        FOREIGN KEY ("order_id") REFERENCES "orders"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "order_items"`);
    await queryRunner.query(`DROP TABLE "orders"`);
  }
}
