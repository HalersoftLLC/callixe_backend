import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import { FeaturedCard } from './entities/featured-card.entity';
import { Product } from './entities/product.entity';
import { FeaturedCardsService } from './featured-cards.service';
import { ProductsService } from './products.service';

const UPDATED_AT = new Date('2026-11-19T10:00:00Z');

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    slug: 'neck-pillow-2-0',
    name: 'Neck Pillow 2.0',
    price: 36300,
    compareAtPrice: 55900,
    description: null,
    badge: 'Bestseller',
    secondUnitHalfOff: false,
    active: true,
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function makeCard(overrides: Partial<FeaturedCard> = {}): FeaturedCard {
  return {
    slot: 1,
    productId: 1,
    imagePosition: 'left',
    promo: 'BOGO 50% OFF',
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

const pillow = makeProduct();
const bundle = makeProduct({ id: 2, slug: 'neck-back-bundle', badge: null });

describe('FeaturedCardsService', () => {
  let service: FeaturedCardsService;
  // Rows as the locked query returns them (no product relation).
  let lockedCards: FeaturedCard[];

  const repository = { find: jest.fn(), findOne: jest.fn() };
  const manager = { find: jest.fn(), findOneBy: jest.fn(), update: jest.fn() };
  const dataSource = { transaction: jest.fn() };
  const productsService = { findOneForAdmin: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    lockedCards = [
      makeCard(),
      makeCard({ slot: 2, productId: 2, imagePosition: 'right', promo: null }),
    ];

    dataSource.transaction.mockImplementation(
      (work: (m: typeof manager) => Promise<unknown>) => work(manager),
    );
    manager.find.mockImplementation(() => Promise.resolve(lockedCards));
    manager.update.mockResolvedValue({ affected: 1 });
    repository.findOne.mockResolvedValue(makeCard({ product: pillow }));
    productsService.findOneForAdmin.mockImplementation((slug: string) =>
      Promise.resolve({ slug, name: 'Admin view' }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        FeaturedCardsService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(FeaturedCard), useValue: repository },
        { provide: ProductsService, useValue: productsService },
      ],
    }).compile();

    service = moduleRef.get(FeaturedCardsService);
  });

  describe('getPublic', () => {
    it('returns cards with active products, by slug, without ids', async () => {
      repository.find.mockResolvedValue([
        makeCard({ product: pillow }),
        makeCard({
          slot: 2,
          productId: 2,
          imagePosition: 'right',
          promo: null,
          product: bundle,
        }),
      ]);

      await expect(service.getPublic()).resolves.toEqual([
        {
          slot: 1,
          slug: 'neck-pillow-2-0',
          imagePosition: 'left',
          promo: 'BOGO 50% OFF',
        },
        {
          slot: 2,
          slug: 'neck-back-bundle',
          imagePosition: 'right',
          promo: null,
        },
      ]);
    });

    it('skips empty cards and cards whose product is inactive', async () => {
      repository.find.mockResolvedValue([
        makeCard({ productId: null, product: null }),
        makeCard({
          slot: 2,
          productId: 2,
          product: makeProduct({ id: 2, active: false }),
        }),
      ]);

      await expect(service.getPublic()).resolves.toEqual([]);
    });
  });

  describe('getForAdmin', () => {
    it('returns both slots with the full product view, or null when empty', async () => {
      repository.find.mockResolvedValue([
        makeCard({ product: pillow }),
        makeCard({ slot: 2, productId: null, product: null }),
      ]);

      const cards = await service.getForAdmin();

      expect(cards).toEqual([
        {
          slot: 1,
          imagePosition: 'left',
          promo: 'BOGO 50% OFF',
          product: { slug: 'neck-pillow-2-0', name: 'Admin view' },
          updatedAt: UPDATED_AT,
        },
        {
          slot: 2,
          imagePosition: 'left',
          promo: 'BOGO 50% OFF',
          product: null,
          updatedAt: UPDATED_AT,
        },
      ]);
      expect(productsService.findOneForAdmin).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateCard', () => {
    it('locks both cards before changing anything', async () => {
      await service.updateCard(1, { imagePosition: 'right' });

      expect(manager.find).toHaveBeenCalledWith(FeaturedCard, {
        order: { slot: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('writes only the settings that were sent', async () => {
      await service.updateCard(1, { imagePosition: 'right' });

      expect(manager.update).toHaveBeenCalledWith(
        FeaturedCard,
        { slot: 1 },
        { imagePosition: 'right' },
      );
    });

    it('removes the promo with null', async () => {
      await service.updateCard(1, { promo: null });

      expect(manager.update).toHaveBeenCalledWith(
        FeaturedCard,
        { slot: 1 },
        { promo: null },
      );
    });

    it('sets a new active product that is not in the other card', async () => {
      const other = makeProduct({ id: 3, slug: 'eye-mask' });
      manager.findOneBy.mockResolvedValue(other);

      await service.updateCard(1, { productSlug: 'eye-mask' });

      expect(manager.findOneBy).toHaveBeenCalledWith(Product, {
        slug: 'eye-mask',
      });
      expect(manager.update).toHaveBeenCalledWith(
        FeaturedCard,
        { slot: 1 },
        { productId: 3 },
      );
    });

    it('allows keeping the same product in the same card', async () => {
      manager.findOneBy.mockResolvedValue(pillow);

      await expect(
        service.updateCard(1, { productSlug: 'neck-pillow-2-0' }),
      ).resolves.toBeDefined();
    });

    it('rejects a product that is already in the other card (409)', async () => {
      manager.findOneBy.mockResolvedValue(bundle);

      await expect(
        service.updateCard(1, { productSlug: 'neck-back-bundle' }),
      ).rejects.toThrow('This product is already in card 2');
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('rejects an unknown product (404)', async () => {
      manager.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateCard(1, { productSlug: 'missing' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('rejects an inactive product (400)', async () => {
      manager.findOneBy.mockResolvedValue(
        makeProduct({ id: 3, active: false }),
      );

      await expect(
        service.updateCard(1, { productSlug: 'neck-pillow-2-0' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('returns 404 when the card row is missing (migration not run)', async () => {
      lockedCards = [];

      await expect(
        service.updateCard(1, { promo: 'New' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('turns a unique violation from the database into 409', async () => {
      const uniqueViolation = new QueryFailedError('UPDATE', [], {
        code: '23505',
      } as unknown as Error);
      manager.findOneBy.mockResolvedValue(makeProduct({ id: 3 }));
      manager.update.mockRejectedValue(uniqueViolation);

      await expect(
        service.updateCard(1, { productSlug: 'neck-pillow-2-0' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('skips the write for an empty change and returns the card', async () => {
      const view = await service.updateCard(1, {});

      expect(manager.update).not.toHaveBeenCalled();
      expect(view.slot).toBe(1);
      expect(view.product).toEqual({
        slug: 'neck-pillow-2-0',
        name: 'Admin view',
      });
    });
  });
});
