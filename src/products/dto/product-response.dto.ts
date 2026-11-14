import { Product } from '../entities/product.entity';
import type { PublicProductImage } from '../products.service';

// Public shape of a product. Internal fields (id, active, timestamps, image
// ids and storage keys) are never sent to the client. description and badge
// are null until the admin sets them; the storefront then falls back to its
// own text. images is empty until the admin uploads one.
export class ProductResponseDto {
  slug!: string;
  name!: string;
  price!: number;
  compareAtPrice!: number | null;
  description!: string | null;
  badge!: string | null;
  images!: PublicProductImage[];

  static fromEntity(
    product: Product,
    images: PublicProductImage[],
  ): ProductResponseDto {
    return {
      slug: product.slug,
      name: product.name,
      price: product.price,
      compareAtPrice: product.compareAtPrice,
      description: product.description,
      badge: product.badge,
      images,
    };
  }
}
