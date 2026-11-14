import { MigrationInterface, QueryRunner } from 'typeorm';

// Indexes for the admin reports (paid orders only). No table changes, so it
// is safe on existing data. IDX_orders_status_created_at matches the @Index
// on src/orders/entities/order.entity.ts; the lower(email) expression index
// exists only here (TypeORM entities can't declare expression indexes).
export class AddOrderAdminIndexes1794441600008 implements MigrationInterface {
  name = 'AddOrderAdminIndexes1794441600008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_status_created_at" ON "orders" ("status", "created_at")`,
    );
    // Emails are stored as typed; customers are grouped case-insensitively.
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_status_lower_email" ON "orders" ("status", lower("email"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_orders_status_lower_email"`);
    await queryRunner.query(`DROP INDEX "IDX_orders_status_created_at"`);
  }
}
