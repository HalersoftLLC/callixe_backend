import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Product } from './product.entity';

// The two large product cards on the Shop page. Exactly two rows (slot 1 and
// 2), created by the CreateFeaturedCards migration. A card only chooses a
// product and how to show it; name, prices, description, badge and image come
// from that product, so a card can never disagree with the product or with
// checkout. product_id null = the card is hidden.
// Constraint names match the hand-written migration.
@Entity('featured_cards')
@Check('CHK_featured_cards_slot', '"slot" IN (1, 2)')
@Check(
  'CHK_featured_cards_image_position',
  `"image_position" IN ('left', 'right')`,
)
// One product can't fill both cards (several NULLs are allowed).
@Unique('UQ_featured_cards_product_id', ['productId'])
export class FeaturedCard {
  @PrimaryColumn({
    type: 'smallint',
    primaryKeyConstraintName: 'PK_featured_cards',
  })
  slot!: number;

  @Column({ name: 'product_id', type: 'integer', nullable: true })
  productId!: number | null;

  // Products are never hard-deleted, but if one ever is, the card just empties.
  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'FK_featured_cards_product_id',
  })
  product?: Product | null;

  // Which side of the card the image is on (from md screens up).
  @Column({
    name: 'image_position',
    type: 'varchar',
    length: 5,
    default: 'left',
  })
  imagePosition!: 'left' | 'right';

  // Small label under the price, e.g. "BOGO 50% OFF". Null = none.
  @Column({ type: 'varchar', length: 30, nullable: true })
  promo!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
