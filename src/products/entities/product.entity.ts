import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ProductImage } from './product-image.entity';

// Checkout data plus the content the admin manages (description, badge).
// Layout-only fields (promo, featured, imagePosition) stay in the frontend
// and are matched to this row by slug.
// Constraint names are explicit so they match the hand-written migration.
@Entity('products')
@Unique('UQ_products_slug', ['slug'])
@Check('CHK_products_price', '"price" >= 0')
@Check(
  'CHK_products_compare_at_price',
  '"compare_at_price" IS NULL OR "compare_at_price" >= 0',
)
export class Product {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_products' })
  id!: number;

  @Column({ type: 'varchar', length: 100 })
  slug!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  // Smallest currency unit (cents). Never a float (CLAUDE.md section 5).
  @Column({ type: 'integer' })
  price!: number;

  @Column({ name: 'compare_at_price', type: 'integer', nullable: true })
  compareAtPrice!: number | null;

  // Managed in the admin panel. Null means the storefront falls back to its
  // own text in dummyData.js.
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  badge!: string | null;

  // "Buy one, get one 50% off": every second unit costs half
  // (orders/pricing.ts calculateDealDiscount). Set by migration
  // (EnableNeckPillowDeal); the admin panel has no switch for it.
  @Column({ name: 'second_unit_half_off', type: 'boolean', default: false })
  secondUnitHalfOff!: boolean;

  // Inactive products are hidden from the catalog and cannot be ordered.
  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  // Loaded only when a query asks for it (relations: { images: true }).
  @OneToMany(() => ProductImage, (image) => image.product)
  images?: ProductImage[];
}
