import { MigrationInterface, QueryRunner } from 'typeorm';

// Matches src/products/entities/shop-hero.entity.ts exactly (column names,
// types, defaults and constraint names), and inserts the single row with the
// text the storefront shows today. No image: the storefront keeps its bundled
// image until the admin uploads one. ON CONFLICT keeps the seed safe to rerun.
export class CreateShopHero1794441600009 implements MigrationInterface {
  name = 'CreateShopHero1794441600009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "shop_hero" (
        "id" integer NOT NULL,
        "eyebrow" character varying(150) NOT NULL,
        "title" character varying(100) NOT NULL,
        "image_storage_key" character varying(300),
        "image_content_type" character varying(20),
        "image_alt" character varying(200),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_shop_hero_single_row" CHECK ("id" = 1),
        CONSTRAINT "CHK_shop_hero_image" CHECK (("image_storage_key" IS NULL) = ("image_content_type" IS NULL)),
        CONSTRAINT "CHK_shop_hero_image_content_type" CHECK ("image_content_type" IS NULL OR "image_content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
        CONSTRAINT "PK_shop_hero" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `INSERT INTO "shop_hero" ("id", "eyebrow", "title")
       VALUES (1, $1, $2)
       ON CONFLICT ("id") DO NOTHING`,
      ['Science backed relief at its lowest price', 'Black Friday Sale Is On'],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "shop_hero"`);
  }
}
