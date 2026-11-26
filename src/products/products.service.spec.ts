import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ILike, In, QueryFailedError } from 'typeorm';
import { ProductImage } from './entities/product-image.entity';
import { Product } from './entities/product.entity';
import { escapeLikePattern, ProductsService } from './products.service';
import { IMAGE_STORAGE } from './storage/image-storage';

function makeImage(overrides: Partial<ProductImage>): ProductImage {
  return {
    id: 1,
    productId: 1,
    storageKey: 'test/products/neck-pillow-2-0/a.png',
    contentType: 'image/png',
    isMain: false,
    position: 0,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    slug: 'neck-pillow-2-0',
    name: 'Neck Pillow 2.0',
    price: 36300,
    compareAtPrice: 55900,
    description: null,
    badge: null,
    secondUnitHalfOff: false,
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// The admin view of a product without images: no internal numeric id.
function adminView(product: Product) {
  const { id: _id, images: _images, ...view } = product;
  return { ...view, mainImageUrl: null, images: [] };
}

function uniqueViolation(): QueryFailedError {
  return new QueryFailedError('INSERT ...', [], {
    name: 'error',
    message:
      'duplicate key value violates unique constraint "UQ_products_slug"',
    code: '23505',
  } as Error);
}

describe('ProductsService', () => {
  let service: ProductsService;
  const repository = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    findBy: jest.fn(),
    findAndCount: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const storage = { publicUrl: (key: string) => `http://img.test/${key}` };

  beforeEach(async () => {
    jest.resetAllMocks();
    // Behave like TypeORM: create() builds the entity, save() returns it,
    // and a later findOne() reads back what was saved.
    let saved: Product | null = null;
    repository.create.mockImplementation((data: Partial<Product>) =>
      makeProduct({ id: undefined, ...data }),
    );
    repository.save.mockImplementation((product: Product) => {
      saved = { ...product, id: product.id ?? 7 };
      return Promise.resolve(saved);
    });
    repository.findOne.mockImplementation(() => Promise.resolve(saved));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getRepositoryToken(Product), useValue: repository },
        { provide: IMAGE_STORAGE, useValue: storage },
      ],
    }).compile();

    service = moduleRef.get(ProductsService);
  });

  describe('findAll', () => {
    it('returns only active products with their images, in a stable order', async () => {
      const products = [makeProduct()];
      repository.find.mockResolvedValue(products);

      await expect(service.findAll()).resolves.toBe(products);
      expect(repository.find).toHaveBeenCalledWith({
        where: { active: true },
        relations: { images: true },
        order: { id: 'ASC' },
      });
    });
  });

  describe('findBySlug', () => {
    it('returns the active product with that slug and its images', async () => {
      const product = makeProduct();
      repository.findOne.mockResolvedValue(product);

      await expect(service.findBySlug('neck-pillow-2-0')).resolves.toBe(
        product,
      );
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { slug: 'neck-pillow-2-0', active: true },
        relations: { images: true },
      });
    });

    it('throws NotFoundException when no active product matches', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findBySlug('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findActiveBySlugs', () => {
    it('queries active products for the given slugs', async () => {
      const products = [
        makeProduct(),
        makeProduct({ id: 2, slug: 'heat-wrap' }),
      ];
      repository.findBy.mockResolvedValue(products);

      await expect(
        service.findActiveBySlugs(['neck-pillow-2-0', 'heat-wrap']),
      ).resolves.toBe(products);
      expect(repository.findBy).toHaveBeenCalledWith({
        slug: In(['neck-pillow-2-0', 'heat-wrap']),
        active: true,
      });
    });

    it('returns an empty list without querying when no slugs are given', async () => {
      await expect(service.findActiveBySlugs([])).resolves.toEqual([]);
      expect(repository.findBy).not.toHaveBeenCalled();
    });
  });

  describe('findAllForAdmin', () => {
    it('lists all products (active and inactive) with default sort and paging', async () => {
      const products = [makeProduct(), makeProduct({ id: 2, active: false })];
      repository.findAndCount.mockResolvedValue([products, 2]);

      await expect(
        service.findAllForAdmin({ sort: '-createdAt', page: 1, limit: 20 }),
      ).resolves.toEqual({
        items: products.map(adminView),
        page: 1,
        limit: 20,
        total: 2,
      });
      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: {},
        relations: { images: true },
        order: { createdAt: 'DESC', id: 'ASC' },
        skip: 0,
        take: 20,
      });
    });

    it('never returns the internal id', async () => {
      repository.findAndCount.mockResolvedValue([[makeProduct()], 1]);

      const result = await service.findAllForAdmin({
        sort: 'name',
        page: 1,
        limit: 20,
      });
      expect(result.items[0]).not.toHaveProperty('id');
    });

    it('searches name OR slug, keeping the active filter on both', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAllForAdmin({
        search: 'pillow',
        active: false,
        sort: 'price',
        page: 3,
        limit: 10,
      });
      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: [
          { active: false, name: ILike('%pillow%') },
          { active: false, slug: ILike('%pillow%') },
        ],
        relations: { images: true },
        order: { price: 'ASC', id: 'ASC' },
        skip: 20,
        take: 10,
      });
    });

    it.each([
      ['name', { name: 'ASC', id: 'ASC' }],
      ['-name', { name: 'DESC', id: 'ASC' }],
      ['-price', { price: 'DESC', id: 'ASC' }],
      ['createdAt', { createdAt: 'ASC', id: 'ASC' }],
    ] as const)('maps sort "%s" to a column order', async (sort, order) => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAllForAdmin({ sort, page: 1, limit: 20 });
      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order }),
      );
    });
  });

  describe('countByActive', () => {
    it('counts active and inactive products', async () => {
      repository.count.mockImplementation(
        ({ where }: { where: { active: boolean } }) =>
          Promise.resolve(where.active ? 6 : 1),
      );

      await expect(service.countByActive()).resolves.toEqual({
        total: 7,
        active: 6,
        inactive: 1,
      });
    });
  });

  describe('toPublicImages', () => {
    it('returns url and isMain in position order, nothing else', () => {
      const product = makeProduct({
        images: [
          makeImage({ id: 2, position: 1, storageKey: 'k/b.png' }),
          makeImage({
            id: 1,
            position: 0,
            storageKey: 'k/a.png',
            isMain: true,
          }),
        ],
      });

      expect(service.toPublicImages(product)).toEqual([
        { url: 'http://img.test/k/a.png', isMain: true },
        { url: 'http://img.test/k/b.png', isMain: false },
      ]);
    });

    it('returns an empty list for a product without images', () => {
      expect(service.toPublicImages(makeProduct())).toEqual([]);
    });
  });

  describe('escapeLikePattern', () => {
    it('escapes LIKE wildcards and the escape character', () => {
      expect(escapeLikePattern('50%_off\\x')).toBe('50\\%\\_off\\\\x');
    });

    it('leaves normal text unchanged', () => {
      expect(escapeLikePattern('Neck Pillow 2.0')).toBe('Neck Pillow 2.0');
    });
  });

  describe('findOneForAdmin', () => {
    it('finds the product even when inactive', async () => {
      const product = makeProduct({ active: false });
      repository.findOne.mockResolvedValue(product);

      await expect(service.findOneForAdmin('neck-pillow-2-0')).resolves.toEqual(
        adminView(product),
      );
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { slug: 'neck-pillow-2-0' },
        relations: { images: true },
      });
    });

    it('lists images in position order with URLs, never storage keys', async () => {
      repository.findOne.mockResolvedValue(
        makeProduct({
          images: [
            makeImage({ id: 2, position: 1, storageKey: 'k/b.png' }),
            makeImage({
              id: 1,
              position: 0,
              storageKey: 'k/a.png',
              isMain: true,
            }),
          ],
        }),
      );

      const view = await service.findOneForAdmin('neck-pillow-2-0');
      expect(view.images).toEqual([
        { id: 1, url: 'http://img.test/k/a.png', isMain: true, position: 0 },
        { id: 2, url: 'http://img.test/k/b.png', isMain: false, position: 1 },
      ]);
      expect(view.mainImageUrl).toBe('http://img.test/k/a.png');
      expect(JSON.stringify(view)).not.toContain('storageKey');
    });

    it('throws NotFoundException when missing', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOneForAdmin('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('saves a new product with defaults for optional fields', async () => {
      const result = await service.create({
        slug: 'heat-wrap',
        name: 'Heat Wrap',
        price: 2500,
      });

      expect(repository.create).toHaveBeenCalledWith({
        slug: 'heat-wrap',
        name: 'Heat Wrap',
        price: 2500,
        compareAtPrice: null,
        description: null,
        badge: null,
        secondUnitHalfOff: false,
        active: true,
      });
      expect(result).toMatchObject({ slug: 'heat-wrap', active: true });
      expect(result).not.toHaveProperty('id');
    });

    it('keeps the given optional fields', async () => {
      await service.create({
        slug: 'heat-wrap',
        name: 'Heat Wrap',
        price: 2500,
        compareAtPrice: 3000,
        description: 'Warm',
        badge: 'New',
        secondUnitHalfOff: true,
        active: false,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          compareAtPrice: 3000,
          description: 'Warm',
          badge: 'New',
          secondUnitHalfOff: true,
          active: false,
        }),
      );
    });

    it.each([2500, 2000])(
      'rejects compareAtPrice %i when it is not above price 2500',
      async (compareAtPrice) => {
        await expect(
          service.create({
            slug: 'heat-wrap',
            name: 'Heat Wrap',
            price: 2500,
            compareAtPrice,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(repository.save).not.toHaveBeenCalled();
      },
    );

    it('turns a duplicate slug into 409 Conflict', async () => {
      repository.save.mockRejectedValue(uniqueViolation());

      await expect(
        service.create({ slug: 'neck-pillow-2-0', name: 'Copy', price: 100 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows other database errors unchanged', async () => {
      const failure = new Error('connection lost');
      repository.save.mockRejectedValue(failure);

      await expect(
        service.create({ slug: 'heat-wrap', name: 'Heat Wrap', price: 100 }),
      ).rejects.toBe(failure);
    });
  });

  describe('update', () => {
    it('changes only the fields that were sent', async () => {
      repository.findOneBy.mockResolvedValue(
        makeProduct({ description: 'Old', badge: 'Sale' }),
      );

      const result = await service.update('neck-pillow-2-0', {
        name: 'Neck Pillow 3.0',
      });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Neck Pillow 3.0',
          price: 36300,
          description: 'Old',
          badge: 'Sale',
        }),
      );
      expect(result.name).toBe('Neck Pillow 3.0');
    });

    it('clears nullable fields when null is sent', async () => {
      repository.findOneBy.mockResolvedValue(
        makeProduct({ description: 'Old', badge: 'Sale' }),
      );

      await service.update('neck-pillow-2-0', {
        compareAtPrice: null,
        description: null,
        badge: null,
      });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          compareAtPrice: null,
          description: null,
          badge: null,
        }),
      );
    });

    it('deactivates a product', async () => {
      repository.findOneBy.mockResolvedValue(makeProduct());

      const result = await service.update('neck-pillow-2-0', {
        active: false,
      });
      expect(result.active).toBe(false);
    });

    it('turns "buy one, get one 50% off" on', async () => {
      repository.findOneBy.mockResolvedValue(makeProduct());

      await service.update('neck-pillow-2-0', { secondUnitHalfOff: true });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ secondUnitHalfOff: true, price: 36300 }),
      );
    });

    it('checks the price rule against the saved compareAtPrice', async () => {
      // Saved compareAtPrice is 55900; raising only the price above it fails.
      repository.findOneBy.mockResolvedValue(makeProduct());

      await expect(
        service.update('neck-pillow-2-0', { price: 60000 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('allows a higher price when compareAtPrice is cleared together', async () => {
      repository.findOneBy.mockResolvedValue(makeProduct());

      await expect(
        service.update('neck-pillow-2-0', {
          price: 60000,
          compareAtPrice: null,
        }),
      ).resolves.toMatchObject({ price: 60000, compareAtPrice: null });
    });

    it('throws NotFoundException for an unknown slug', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.update('missing', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.save).not.toHaveBeenCalled();
    });
  });
});
