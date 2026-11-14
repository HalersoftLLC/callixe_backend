import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Product } from './product.entity';

// One stored image file of a product. Only the storage key is saved; the
// URL is built from STORAGE_PUBLIC_URL, so moving storage or CDN needs no
// data migration. Constraint names match the hand-written migration.
@Entity('product_images')
@Unique('UQ_product_images_storage_key', ['storageKey'])
@Check('CHK_product_images_position', '"position" >= 0')
@Check(
  'CHK_product_images_content_type',
  `"content_type" IN ('image/jpeg', 'image/png', 'image/webp')`,
)
// At most one main image per product, enforced by the database.
@Index('UQ_product_images_one_main', ['productId'], {
  unique: true,
  where: '"is_main"',
})
@Index('IDX_product_images_product_id_position', ['productId', 'position'])
export class ProductImage {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_product_images' })
  id!: number;

  @Column({ name: 'product_id', type: 'integer' })
  productId!: number;

  @ManyToOne(() => Product, (product) => product.images, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'FK_product_images_product_id',
  })
  product?: Product;

  @Column({ name: 'storage_key', type: 'varchar', length: 300 })
  storageKey!: string;

  @Column({ name: 'content_type', type: 'varchar', length: 20 })
  contentType!: string;

  @Column({ name: 'is_main', type: 'boolean', default: false })
  isMain!: boolean;

  // 0-based display order, kept dense (0, 1, 2, …) by ProductImagesService.
  @Column({ type: 'integer', default: 0 })
  position!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
