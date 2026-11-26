import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from './order.entity';

// A snapshot of the product at order time. No foreign key to products:
// later price changes or deactivations must never alter a past order.
@Entity('order_items')
@Check('CHK_order_items_quantity', '"quantity" BETWEEN 1 AND 10')
@Check('CHK_order_items_unit_price', '"unit_price" >= 0')
@Check('CHK_order_items_deal_discount', '"deal_discount" >= 0')
@Check(
  'CHK_order_items_line_total',
  '"line_total" = "unit_price" * "quantity" - "deal_discount"',
)
export class OrderItem {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_order_items' })
  id!: number;

  @Index('IDX_order_items_order_id')
  @ManyToOne(() => Order, (order) => order.items, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'FK_order_items_order_id',
  })
  order!: Order;

  @Column({ type: 'varchar', length: 100 })
  slug!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'unit_price', type: 'integer' })
  unitPrice!: number;

  @Column({ type: 'integer' })
  quantity!: number;

  // What "buy one, get one 50% off" took off this line at order time; 0 when
  // the product had no deal. line_total already has it subtracted.
  @Column({ name: 'deal_discount', type: 'integer', default: 0 })
  dealDiscount!: number;

  @Column({ name: 'line_total', type: 'integer' })
  lineTotal!: number;
}
