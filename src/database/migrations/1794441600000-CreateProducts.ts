import { MigrationInterface, QueryRunner } from 'typeorm';

// Matches src/products/entities/product.entity.ts exactly
// (column names, types, defaults, and constraint names).
export class CreateProducts1794441600000 implements MigrationInterface {
  name = 'CreateProducts1794441600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" SERIAL NOT NULL,
        "slug" character varying(100) NOT NULL,
        "name" character varying(200) NOT NULL,
        "price" integer NOT NULL,
        "compare_at_price" integer,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_products_slug" UNIQUE ("slug"),
        CONSTRAINT "CHK_products_price" CHECK ("price" >= 0),
        CONSTRAINT "CHK_products_compare_at_price" CHECK ("compare_at_price" IS NULL OR "compare_at_price" >= 0),
        CONSTRAINT "PK_products" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "products"`);
  }
}
