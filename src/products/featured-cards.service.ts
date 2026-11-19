import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { FeaturedCard } from './entities/featured-card.entity';
import { Product } from './entities/product.entity';
import {
  type AdminProductView,
  isUniqueViolation,
  ProductsService,
} from './products.service';

// Types and limits the Admin module uses (it imports only service files).
export const FEATURED_CARD_SLOTS = [1, 2] as const;
export type FeaturedCardSlot = (typeof FEATURED_CARD_SLOTS)[number];

export const FEATURED_IMAGE_POSITIONS = ['left', 'right'] as const;
export type FeaturedImagePosition = (typeof FEATURED_IMAGE_POSITIONS)[number];

export const FEATURED_PROMO_MAX_LENGTH = 30;

// GET /featured-cards. Only cards with an active product; the storefront
// matches `slug` to the products it already has from GET /products.
export interface PublicFeaturedCard {
  slot: number;
  slug: string;
  imagePosition: FeaturedImagePosition;
  promo: string | null;
}

// Admin view: both slots, with the full product (same shape as
// GET /admin/products/:slug) so the screen loads in one request.
export interface AdminFeaturedCardView {
  slot: number;
  imagePosition: FeaturedImagePosition;
  promo: string | null;
  product: AdminProductView | null;
  updatedAt: Date;
}

// undefined = keep; promo null = no promo. A card can't be emptied: the Shop
// page always shows both cards (product_id is only null if a product was
// removed from the database, until the admin picks another one).
export interface FeaturedCardChanges {
  productSlug?: string;
  imagePosition?: FeaturedImagePosition;
  promo?: string | null;
}

// Card settings only. The product's own details (name, prices, description,
// badge, image) are changed through ProductsService / ProductImagesService,
// so price rules and image rules exist in one place.
@Injectable()
export class FeaturedCardsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(FeaturedCard)
    private readonly cardsRepository: Repository<FeaturedCard>,
    private readonly productsService: ProductsService,
  ) {}

  async getPublic(): Promise<PublicFeaturedCard[]> {
    const cards = await this.cardsRepository.find({
      relations: { product: true },
      order: { slot: 'ASC' },
    });
    // An inactive product is hidden from the store, so its card is too.
    return cards
      .filter((card) => card.product?.active)
      .map((card) => ({
        slot: card.slot,
        slug: card.product!.slug,
        imagePosition: card.imagePosition,
        promo: card.promo,
      }));
  }

  async getForAdmin(): Promise<AdminFeaturedCardView[]> {
    const cards = await this.cardsRepository.find({
      relations: { product: true },
      order: { slot: 'ASC' },
    });
    return Promise.all(cards.map((card) => this.toAdminView(card)));
  }

  async updateCard(
    slot: FeaturedCardSlot,
    changes: FeaturedCardChanges,
  ): Promise<AdminFeaturedCardView> {
    try {
      await this.dataSource.transaction(async (manager) => {
        // Lock both rows: two saves at once run one after the other, so the
        // "already in the other card" check below can't be raced.
        // (No join here: PostgreSQL can't lock the nullable side of a join.)
        const cards = await manager.find(FeaturedCard, {
          order: { slot: 'ASC' },
          lock: { mode: 'pessimistic_write' },
        });
        const card = cards.find((candidate) => candidate.slot === slot);
        // A missing row means the CreateFeaturedCards migration has not run.
        if (!card) throw new NotFoundException('Featured card not found');

        const columns: Partial<
          Pick<FeaturedCard, 'productId' | 'imagePosition' | 'promo'>
        > = {};

        if (changes.productSlug !== undefined) {
          const product = await manager.findOneBy(Product, {
            slug: changes.productSlug,
          });
          if (!product) throw new NotFoundException('Product not found');
          if (!product.active) {
            throw new BadRequestException(
              'This product is inactive. Activate it first: the store would not show it.',
            );
          }
          const other = cards.find(
            (candidate) =>
              candidate.slot !== slot && candidate.productId === product.id,
          );
          if (other) {
            throw new ConflictException(
              `This product is already in card ${other.slot}`,
            );
          }
          columns.productId = product.id;
        }
        if (changes.imagePosition !== undefined) {
          columns.imagePosition = changes.imagePosition;
        }
        if (changes.promo !== undefined) columns.promo = changes.promo;

        if (Object.keys(columns).length > 0) {
          await manager.update(FeaturedCard, { slot }, columns);
        }
      });
    } catch (error) {
      // Last line of defence: UQ_featured_cards_product_id.
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'This product is already in the other card',
        );
      }
      throw error;
    }

    const card = await this.cardsRepository.findOne({
      where: { slot },
      relations: { product: true },
    });
    if (!card) throw new NotFoundException('Featured card not found');
    return this.toAdminView(card);
  }

  private async toAdminView(
    card: FeaturedCard,
  ): Promise<AdminFeaturedCardView> {
    return {
      slot: card.slot,
      imagePosition: card.imagePosition,
      promo: card.promo,
      product: card.product
        ? await this.productsService.findOneForAdmin(card.product.slug)
        : null,
      updatedAt: card.updatedAt,
    };
  }
}
