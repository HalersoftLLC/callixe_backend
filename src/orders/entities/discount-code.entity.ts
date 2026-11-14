import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum DiscountType {
  Percent = 'percent',
  Fixed = 'fixed',
}

@Entity('discount_codes')
@Unique('UQ_discount_codes_code', ['code'])
@Check('CHK_discount_codes_type', `"type" IN ('percent', 'fixed')`)
@Check('CHK_discount_codes_value', '"value" > 0')
@Check(
  'CHK_discount_codes_percent_max',
  `"type" <> 'percent' OR "value" <= 100`,
)
export class DiscountCode {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_discount_codes' })
  id!: number;

  // Always stored uppercase; lookups uppercase the input first.
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'varchar', length: 10 })
  type!: DiscountType;

  // Percent: 1–100. Fixed: amount in cents.
  @Column({ type: 'integer' })
  value!: number;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
