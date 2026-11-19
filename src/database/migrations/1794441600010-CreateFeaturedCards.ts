import { MigrationInterface, QueryRunner } from 'typeorm';

// Matches src/products/entities/featured-card.entity.ts exactly (column names,
// types, defaults and constraint names), and inserts the two cards the Shop
// page shows today (previously hard-coded in the storefront's dummyData.js).
// Products are looked up by slug; a missing product leaves that card empty
// instead of failing. ON CONFLICT keeps the seed safe to rerun.
export class CreateFeaturedCards1794441600010 implements MigrationInterface {
  name = 'CreateFeaturedCards1794441600010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "featured_cards" (
        "slot" smallint NOT NULL,
        "product_id" integer,
        "image_position" character varying(5) NOT NULL DEFAULT 'left',
        "promo" character varying(30),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_featured_cards_slot" CHECK ("slot" IN (1, 2)),
        CONSTRAINT "CHK_featured_cards_image_position" CHECK ("image_position" IN ('left', 'right')),
        CONSTRAINT "UQ_featured_cards_product_id" UNIQUE ("product_id"),
        CONSTRAINT "PK_featured_cards" PRIMARY KEY ("slot"),
        CONSTRAINT "FK_featured_cards_product_id" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `INSERT INTO "featured_cards" ("slot", "product_id", "image_position", "promo")
       VALUES
         (1, (SELECT "id" FROM "products" WHERE "slug" = $1), 'left', $2),
         (2, (SELECT "id" FROM "products" WHERE "slug" = $3), 'right', NULL)
       ON CONFLICT ("slot") DO NOTHING`,
      ['neck-pillow-2-0', 'BOGO 50% OFF', 'neck-back-bundle'],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "featured_cards"`);
  }
}
