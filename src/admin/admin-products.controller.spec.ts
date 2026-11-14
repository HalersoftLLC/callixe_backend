import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ProductsService } from '../products/products.service';
import { AdminProductsController } from './admin-products.controller';
import { AdminGuard } from './admin.guard';

const view = {
  slug: 'neck-pillow-2-0',
  name: 'Neck Pillow 2.0',
  price: 36300,
  compareAtPrice: 55900,
  description: null,
  badge: null,
  active: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('AdminProductsController', () => {
  let controller: AdminProductsController;
  const productsService = {
    findAllForAdmin: jest.fn(),
    findOneForAdmin: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminProductsController],
      providers: [
        { provide: ProductsService, useValue: productsService },
        AdminGuard,
        { provide: JwtService, useValue: {} },
      ],
    }).compile();

    controller = moduleRef.get(AdminProductsController);
  });

  it('protects every route with AdminGuard', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminProductsController),
    ).toEqual([AdminGuard]);
  });

  it('has no delete route', () => {
    expect(
      Object.getOwnPropertyNames(AdminProductsController.prototype),
    ).not.toContain('remove');
  });

  it('GET /admin/products passes the query to the service', async () => {
    const page = { items: [view], page: 1, limit: 20, total: 1 };
    productsService.findAllForAdmin.mockResolvedValue(page);
    const query = { sort: '-createdAt' as const, page: 1, limit: 20 };

    await expect(controller.list(query)).resolves.toBe(page);
    expect(productsService.findAllForAdmin).toHaveBeenCalledWith(query);
  });

  it('GET /admin/products/:slug returns one product', async () => {
    productsService.findOneForAdmin.mockResolvedValue(view);

    await expect(controller.findOne({ slug: 'neck-pillow-2-0' })).resolves.toBe(
      view,
    );
    expect(productsService.findOneForAdmin).toHaveBeenCalledWith(
      'neck-pillow-2-0',
    );
  });

  it('GET /admin/products/:slug passes NotFoundException through', async () => {
    productsService.findOneForAdmin.mockRejectedValue(new NotFoundException());

    await expect(
      controller.findOne({ slug: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('POST /admin/products creates a product', async () => {
    productsService.create.mockResolvedValue(view);
    const dto = {
      slug: 'neck-pillow-2-0',
      name: 'Neck Pillow 2.0',
      price: 36300,
    };

    await expect(controller.create(dto)).resolves.toBe(view);
    expect(productsService.create).toHaveBeenCalledWith(dto);
  });

  it('PATCH /admin/products/:slug updates by slug', async () => {
    productsService.update.mockResolvedValue(view);
    const dto = { active: false };

    await expect(
      controller.update({ slug: 'neck-pillow-2-0' }, dto),
    ).resolves.toBe(view);
    expect(productsService.update).toHaveBeenCalledWith('neck-pillow-2-0', dto);
  });
});
