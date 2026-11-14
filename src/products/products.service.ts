import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindOptionsOrder,
  FindOptionsWhere,
  ILike,
  In,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { Product } from './entities/product.entity';
import {
  type AdminProductImageView,
  sortImages,
  toAdminImageView,
} from './product-images.service';
import { IMAGE_STORAGE, type ImageStorage } from './storage/image-storage';

// Types other modules (Admin) use to talk to this service. They live here so
// other modules import only the exported service, never Products internals.

export const PRODUCT_SORT_OPTIONS = [
  'name',
  '-name',
  'price',
  '-price',
  'createdAt',
  '-createdAt',
] as const;
export type ProductSort = (typeof PRODUCT_SORT_OPTIONS)[number];

export interface ProductListOptions {
  search?: string;
  active?: boolean;
  sort: ProductSort;
  page: number;
  limit: number;
}

export interface ProductCreateInput {
  slug: string;
  name: string;
  price: number;
  compareAtPrice?: number | null;
  description?: string | null;
  badge?: string | null;
  active?: boolean;
}

// The slug is the product's permanent key (storefront URLs, past orders).
export type ProductUpdateInput = Partial<Omit<ProductCreateInput, 'slug'>>;

// Everything the admin panel needs; never the internal numeric id.
export interface AdminProductView {
  slug: string;
  name: string;
  price: number;
  compareAtPrice: number | null;
  description: string | null;
  badge: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  mainImageUrl: string | null;
  images: AdminProductImageView[];
}

// What the storefront gets per image: no ids, no storage keys.
export interface PublicProductImage {
  url: string;
  isMain: boolean;
}

export interface ProductCounts {
  total: number;
  active: number;
  inactive: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @Inject(IMAGE_STORAGE) private readonly storage: ImageStorage,
  ) {}

  // Images are loaded in the same query (join), not one request per product.
  findAll(): Promise<Product[]> {
    return this.productsRepository.find({
      where: { active: true },
      relations: { images: true },
      order: { id: 'ASC' },
    });
  }

  async findBySlug(slug: string): Promise<Product> {
    const product = await this.productsRepository.findOne({
      where: { slug, active: true },
      relations: { images: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  // Public image list for the storefront, in display order.
  toPublicImages(product: Product): PublicProductImage[] {
    return sortImages(product.images ?? []).map((image) => ({
      url: this.storage.publicUrl(image.storageKey),
      isMain: image.isMain,
    }));
  }

  // Used by the Orders module to price a cart from the database.
  // Returns only active products that exist; the caller decides how to
  // handle slugs that are missing from the result.
  findActiveBySlugs(slugs: string[]): Promise<Product[]> {
    if (slugs.length === 0) {
      return Promise.resolve([]);
    }
    return this.productsRepository.findBy({ slug: In(slugs), active: true });
  }

  // ---- Admin (includes inactive products) ----

  // Dashboard counts.
  async countByActive(): Promise<ProductCounts> {
    const [active, inactive] = await Promise.all([
      this.productsRepository.count({ where: { active: true } }),
      this.productsRepository.count({ where: { active: false } }),
    ]);
    return { total: active + inactive, active, inactive };
  }

  async findAllForAdmin(
    options: ProductListOptions,
  ): Promise<Page<AdminProductView>> {
    const { search, active, sort, page, limit } = options;

    const base: FindOptionsWhere<Product> =
      active === undefined ? {} : { active };
    // An array of conditions is OR-ed: name matches, or slug matches.
    const where = search
      ? [
          { ...base, name: ILike(`%${escapeLikePattern(search)}%`) },
          { ...base, slug: ILike(`%${escapeLikePattern(search)}%`) },
        ]
      : base;

    const [products, total] = await this.productsRepository.findAndCount({
      where,
      relations: { images: true },
      order: toFindOrder(sort),
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: products.map((product) => this.toAdminView(product)),
      page,
      limit,
      total,
    };
  }

  async findOneForAdmin(slug: string): Promise<AdminProductView> {
    const product = await this.productsRepository.findOne({
      where: { slug },
      relations: { images: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return this.toAdminView(product);
  }

  async create(input: ProductCreateInput): Promise<AdminProductView> {
    const product = this.productsRepository.create({
      slug: input.slug,
      name: input.name,
      price: input.price,
      compareAtPrice: input.compareAtPrice ?? null,
      description: input.description ?? null,
      badge: input.badge ?? null,
      active: input.active ?? true,
    });
    assertCompareAtPriceAbovePrice(product);

    try {
      // A new product has no images yet.
      const saved = await this.productsRepository.save(product);
      return this.toAdminView({ ...saved, images: [] });
    } catch (error) {
      // Rely on the unique constraint rather than a "check then insert",
      // which two simultaneous requests could both pass.
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `A product with slug "${input.slug}" already exists`,
        );
      }
      throw error;
    }
  }

  async update(
    slug: string,
    input: ProductUpdateInput,
  ): Promise<AdminProductView> {
    const product = await this.findAnyBySlug(slug);

    // undefined = field not sent (keep); null = clear (nullable fields only,
    // the DTO rejects null for the others).
    if (input.name !== undefined) product.name = input.name;
    if (input.price !== undefined) product.price = input.price;
    if (input.compareAtPrice !== undefined) {
      product.compareAtPrice = input.compareAtPrice;
    }
    if (input.description !== undefined) {
      product.description = input.description;
    }
    if (input.badge !== undefined) product.badge = input.badge;
    if (input.active !== undefined) product.active = input.active;

    // Checked after merging, so changing only one of the two prices is
    // still compared against the other's saved value.
    assertCompareAtPriceAbovePrice(product);

    // Loaded and saved without the images relation, so saving can never
    // touch image rows; the response reloads them.
    await this.productsRepository.save(product);
    return this.findOneForAdmin(slug);
  }

  private async findAnyBySlug(slug: string): Promise<Product> {
    const product = await this.productsRepository.findOneBy({ slug });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  private toAdminView(product: Product): AdminProductView {
    const images = sortImages(product.images ?? []).map((image) =>
      toAdminImageView(image, this.storage),
    );
    return {
      slug: product.slug,
      name: product.name,
      price: product.price,
      compareAtPrice: product.compareAtPrice,
      description: product.description,
      badge: product.badge,
      active: product.active,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      mainImageUrl: images.find((image) => image.isMain)?.url ?? null,
      images,
    };
  }
}

// The id tiebreaker keeps page boundaries stable when sort values are equal.
function toFindOrder(sort: ProductSort): FindOptionsOrder<Product> {
  const direction = sort.startsWith('-') ? 'DESC' : 'ASC';
  const field = sort.replace('-', '') as 'name' | 'price' | 'createdAt';
  const order: FindOptionsOrder<Product> = {};
  order[field] = direction;
  order.id = 'ASC';
  return order;
}

// The admin types plain text; % and _ must not act as LIKE wildcards.
// Backslash is PostgreSQL's default LIKE escape character.
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// A "compare at" (was) price only makes sense above the selling price.
function assertCompareAtPriceAbovePrice(product: Product): void {
  if (
    product.compareAtPrice !== null &&
    product.compareAtPrice <= product.price
  ) {
    throw new BadRequestException('compareAtPrice must be greater than price');
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}
