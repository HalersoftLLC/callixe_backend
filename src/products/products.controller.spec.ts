import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Product } from './entities/product.entity';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

const product: Product = {
  id: 1,
  slug: 'neck-pillow-2-0',
  name: 'Neck Pillow 2.0',
  price: 36300,
  compareAtPrice: 55900,
  description: 'Memory foam support for travel.',
  badge: 'Bestseller',
  active: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const publicImages = [
  {
    url: 'http://img.test/development/products/neck-pillow-2-0/a.png',
    isMain: true,
  },
];

// No id, active, timestamps, image ids or storage keys (CLAUDE.md section 7).
const publicShape = {
  slug: 'neck-pillow-2-0',
  name: 'Neck Pillow 2.0',
  price: 36300,
  compareAtPrice: 55900,
  description: 'Memory foam support for travel.',
  badge: 'Bestseller',
  images: publicImages,
};

describe('ProductsController', () => {
  let controller: ProductsController;
  const productsService = {
    findAll: jest.fn(),
    findBySlug: jest.fn(),
    toPublicImages: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    productsService.toPublicImages.mockReturnValue(publicImages);
    const moduleRef = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: productsService }],
    }).compile();

    controller = moduleRef.get(ProductsController);
  });

  it('GET /products returns products without internal fields', async () => {
    productsService.findAll.mockResolvedValue([product]);

    await expect(controller.findAll()).resolves.toEqual([publicShape]);
  });

  it('GET /products/:slug returns one product without internal fields', async () => {
    productsService.findBySlug.mockResolvedValue(product);

    await expect(
      controller.findOne({ slug: 'neck-pillow-2-0' }),
    ).resolves.toEqual(publicShape);
    expect(productsService.findBySlug).toHaveBeenCalledWith('neck-pillow-2-0');
  });

  it('GET /products/:slug passes NotFoundException through', async () => {
    productsService.findBySlug.mockRejectedValue(
      new NotFoundException('Product not found'),
    );

    await expect(
      controller.findOne({ slug: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
