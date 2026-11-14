import { MigrationInterface, QueryRunner } from 'typeorm';

// Matches the frontend's checkoutContent.discountCodes in src/data/dummyData.js.
// Fixed values are in cents (500 = 5.00).
const DISCOUNT_CODES = [
  { code: 'WELCOME10', type: 'percent', value: 10 },
  { code: 'SAVE500', type: 'fixed', value: 500 },
];

export class SeedDiscountCodes1794441600003 implements MigrationInterface {
  name = 'SeedDiscountCodes1794441600003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const discount of DISCOUNT_CODES) {
      await queryRunner.query(
        `INSERT INTO "discount_codes" ("code", "type", "value")
         VALUES ($1, $2, $3)
         ON CONFLICT ("code") DO NOTHING`,
        [discount.code, discount.type, discount.value],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "discount_codes" WHERE "code" = ANY($1)`,
      [DISCOUNT_CODES.map((discount) => discount.code)],
    );
  }
}
