import { MigrationInterface, QueryRunner } from 'typeorm';

// Matches src/products/entities/product-image.entity.ts exactly
// (column names, types, defaults, and constraint/index names).
export class CreateProductImages1794441600007 implements MigrationInterface {
  name = 'CreateProductImages1794441600007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "product_images" (
        "id" SERIAL NOT NULL,
        "product_id" integer NOT NULL,
        "storage_key" character varying(300) NOT NULL,
        "content_type" character varying(20) NOT NULL,
        "is_main" boolean NOT NULL DEFAULT false,
        "position" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_product_images_storage_key" UNIQUE ("storage_key"),
        CONSTRAINT "CHK_product_images_position" CHECK ("position" >= 0),
        CONSTRAINT "CHK_product_images_content_type" CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
        CONSTRAINT "PK_product_images" PRIMARY KEY ("id"),
        CONSTRAINT "FK_product_images_product_id" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE
      )
    `);
    // Partial unique index: at most one main image per product.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_product_images_one_main" ON "product_images" ("product_id") WHERE "is_main"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_product_images_product_id_position" ON "product_images" ("product_id", "position")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "product_images"`);
  }
}
