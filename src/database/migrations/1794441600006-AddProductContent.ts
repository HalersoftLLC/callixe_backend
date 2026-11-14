import { MigrationInterface, QueryRunner } from 'typeorm';

// Matches Product.description and Product.badge in
// src/products/entities/product.entity.ts. Both nullable, so existing rows
// need no backfill; the storefront falls back to its own text while null.
export class AddProductContent1794441600006 implements MigrationInterface {
  name = 'AddProductContent1794441600006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD "description" text`);
    await queryRunner.query(
      `ALTER TABLE "products" ADD "badge" character varying(50)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "badge"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "description"`);
  }
}
