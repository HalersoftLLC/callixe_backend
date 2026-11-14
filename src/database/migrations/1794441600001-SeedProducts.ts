import { MigrationInterface, QueryRunner } from 'typeorm';

// Initial catalog, matching the frontend's src/data/dummyData.js.
// Prices are in cents. Kept in a migration so one `migration:run`
// creates the table and its data in every environment, including production.
const PRODUCTS = [
  {
    slug: 'neck-pillow-2-0',
    name: 'Neck Pillow 2.0',
    price: 36300,
    compareAtPrice: 55900,
  },
  {
    slug: 'neck-back-bundle',
    name: 'Neck & Back Bundle',
    price: 64100,
    compareAtPrice: 98000,
  },
  {
    slug: 'back-pillow',
    name: 'Back Pillow',
    price: 27800,
    compareAtPrice: 41900,
  },
  {
    slug: 'travel-pillow',
    name: 'Travel Pillow',
    price: 19400,
    compareAtPrice: 27800,
  },
  {
    slug: 'neck-pillow-1-0',
    name: 'Neck Pillow 1.0',
    price: 27800,
    compareAtPrice: 41900,
  },
  {
    slug: 'heat-wrap',
    name: 'Heat Wrap',
    price: 13800,
    compareAtPrice: 16600,
  },
];

export class SeedProducts1794441600001 implements MigrationInterface {
  name = 'SeedProducts1794441600001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const product of PRODUCTS) {
      // Parameterized values; ON CONFLICT keeps it safe if a row already exists.
      await queryRunner.query(
        `INSERT INTO "products" ("slug", "name", "price", "compare_at_price")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("slug") DO NOTHING`,
        [product.slug, product.name, product.price, product.compareAtPrice],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "products" WHERE "slug" = ANY($1)`, [
      PRODUCTS.map((product) => product.slug),
    ]);
  }
}
