import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ShopHeroController } from './shop-hero.controller';
import { ShopHeroService } from './shop-hero.service';

describe('ShopHeroController', () => {
  let controller: ShopHeroController;
  const shopHeroService = { getPublic: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [ShopHeroController],
      providers: [{ provide: ShopHeroService, useValue: shopHeroService }],
    }).compile();

    controller = moduleRef.get(ShopHeroController);
  });

  it('GET /shop-hero returns the public view', async () => {
    const view = {
      eyebrow: 'Science backed relief at its lowest price',
      title: 'Black Friday Sale Is On',
      image: null,
    };
    shopHeroService.getPublic.mockResolvedValue(view);

    await expect(controller.find()).resolves.toBe(view);
  });

  it('GET /shop-hero passes NotFoundException through', async () => {
    shopHeroService.getPublic.mockRejectedValue(new NotFoundException());

    await expect(controller.find()).rejects.toBeInstanceOf(NotFoundException);
  });
});
