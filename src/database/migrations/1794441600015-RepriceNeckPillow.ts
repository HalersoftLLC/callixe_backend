import { MigrationInterface, QueryRunner } from 'typeorm';

// Thera Pillow 2.0 was seeded at 36300 / 55900, the reference site's rupee
// numbers stored as US cents ($363 / $559). The real USD price is $129.00
// (compare-at $199.00, the same ratio as the reference's Rs.36,200 /
// Rs.55,900), which the storefront converts to about Rs.36,200.
//
// Only rows still at the seeded prices change, so a price the admin has
// already edited is never overwritten (same rule in `down`).
export class RepriceNeckPillow1794441600015 implements MigrationInterface {
  name = 'RepriceNeckPillow1794441600015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "products" SET "price" = 12900, "compare_at_price" = 19900 WHERE "slug" = 'neck-pillow-2-0' AND "price" = 36300 AND "compare_at_price" = 55900`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "products" SET "price" = 36300, "compare_at_price" = 55900 WHERE "slug" = 'neck-pillow-2-0' AND "price" = 12900 AND "compare_at_price" = 19900`,
    );
  }
}
