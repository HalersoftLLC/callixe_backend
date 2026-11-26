import { MigrationInterface, QueryRunner } from 'typeorm';

// Turns on "buy one, get one 50% off" for Thera Pillow 2.0 (the storefront's
// "2 Thera Pillows" card). There is no admin switch for it, so a migration
// sets it; `down` turns it off again. Matches nothing (no error) if the
// product doesn't exist.
export class EnableNeckPillowDeal1794441600014 implements MigrationInterface {
  name = 'EnableNeckPillowDeal1794441600014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "products" SET "second_unit_half_off" = true WHERE "slug" = 'neck-pillow-2-0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "products" SET "second_unit_half_off" = false WHERE "slug" = 'neck-pillow-2-0'`,
    );
  }
}
