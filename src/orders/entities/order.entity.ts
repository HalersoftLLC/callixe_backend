import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Generated,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { OrderItem } from './order-item.entity';

export enum OrderStatus {
  Pending = 'pending',
  Paid = 'paid',
  Failed = 'failed',
}

// All money columns are integers in cents (CLAUDE.md section 5).
// The total check makes the database itself reject an inconsistent order.
@Entity('orders')
@Unique('UQ_orders_order_number', ['orderNumber'])
@Unique('UQ_orders_stripe_payment_intent_id', ['stripePaymentIntentId'])
@Unique('UQ_orders_stripe_checkout_session_id', ['stripeCheckoutSessionId'])
@Check('CHK_orders_status', `"status" IN ('pending', 'paid', 'failed')`)
@Check(
  'CHK_orders_amounts',
  '"subtotal" >= 0 AND "discount_amount" >= 0 AND "shipping" >= 0 AND "total" >= 0',
)
@Check(
  'CHK_orders_total',
  '"total" = "subtotal" - "discount_amount" + "shipping"',
)
// Admin reports read paid orders by date and group customers by email.
// The lower(email) expression index is created in the migration
// (1794441600008); TypeORM can't declare expression indexes, so
// `synchronize: false` is what keeps it from being dropped.
@Index('IDX_orders_status_created_at', ['status', 'createdAt'])
export class Order {
  // Unguessable; used in the confirmation page URL.
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_orders' })
  id!: string;

  // Short, human-friendly number for display and emails (starts at 1001).
  @Column({ name: 'order_number', type: 'integer' })
  @Generated('increment')
  orderNumber!: number;

  @Column({ type: 'varchar', length: 254 })
  email!: string;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName!: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName!: string;

  @Column({ type: 'varchar', length: 200 })
  address!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  apartment!: string | null;

  @Column({ type: 'varchar', length: 100 })
  city!: string;

  @Column({ name: 'postal_code', type: 'varchar', length: 20, nullable: true })
  postalCode!: string | null;

  @Column({ type: 'varchar', length: 100 })
  country!: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @Column({ type: 'integer' })
  subtotal!: number;

  @Column({
    name: 'discount_code',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  discountCode!: string | null;

  @Column({ name: 'discount_amount', type: 'integer', default: 0 })
  discountAmount!: number;

  @Column({ type: 'integer' })
  shipping!: number;

  @Column({ type: 'integer' })
  total!: number;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: OrderStatus.Pending })
  status!: OrderStatus;

  // Set right after the Stripe Checkout Session is created; the webhook
  // finds the order by it.
  @Column({
    name: 'stripe_checkout_session_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeCheckoutSessionId!: string | null;

  // Copied from the Checkout Session when the order is paid (refund lookups).
  @Column({
    name: 'stripe_payment_intent_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripePaymentIntentId!: string | null;

  @OneToMany(() => OrderItem, (item) => item.order)
  items!: OrderItem[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
