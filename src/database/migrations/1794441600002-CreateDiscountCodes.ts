import { MigrationInterface, QueryRunner } from 'typeorm';

// Matches src/orders/entities/discount-code.entity.ts exactly.
export class CreateDiscountCodes1794441600002 implements MigrationInterface {
  name = 'CreateDiscountCodes1794441600002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "discount_codes" (
        "id" SERIAL NOT NULL,
        "code" character varying(50) NOT NULL,
        "type" character varying(10) NOT NULL,
        "value" integer NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_discount_codes_code" UNIQUE ("code"),
        CONSTRAINT "CHK_discount_codes_type" CHECK ("type" IN ('percent', 'fixed')),
        CONSTRAINT "CHK_discount_codes_value" CHECK ("value" > 0),
        CONSTRAINT "CHK_discount_codes_percent_max" CHECK ("type" <> 'percent' OR "value" <= 100),
        CONSTRAINT "PK_discount_codes" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "discount_codes"`);
  }
}
