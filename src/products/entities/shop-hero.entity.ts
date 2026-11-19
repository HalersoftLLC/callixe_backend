import {
  Check,
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

// The Shop page hero the admin edits: the small line above the heading
// ("eyebrow"), the heading, and an optional image. There is exactly one row
// (id = 1), created by the CreateShopHero migration.
// Only the image's storage key is saved; the URL is built from
// STORAGE_PUBLIC_URL, like product images. A null image means the storefront
// shows its own bundled image.
// Constraint names match the hand-written migration.
@Entity('shop_hero')
@Check('CHK_shop_hero_single_row', '"id" = 1')
// Key and content type are set and cleared together.
@Check(
  'CHK_shop_hero_image',
  '("image_storage_key" IS NULL) = ("image_content_type" IS NULL)',
)
@Check(
  'CHK_shop_hero_image_content_type',
  `"image_content_type" IS NULL OR "image_content_type" IN ('image/jpeg', 'image/png', 'image/webp')`,
)
export class ShopHero {
  @PrimaryColumn({
    type: 'integer',
    primaryKeyConstraintName: 'PK_shop_hero',
  })
  id!: number;

  @Column({ type: 'varchar', length: 150 })
  eyebrow!: string;

  @Column({ type: 'varchar', length: 100 })
  title!: string;

  @Column({
    name: 'image_storage_key',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  imageStorageKey!: string | null;

  @Column({
    name: 'image_content_type',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  imageContentType!: string | null;

  // Describes the image for screen readers. Null falls back to the title.
  @Column({ name: 'image_alt', type: 'varchar', length: 200, nullable: true })
  imageAlt!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
