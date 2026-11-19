import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { FeaturedCardsService } from '../products/featured-cards.service';
import { AdminFeaturedCardsController } from './admin-featured-cards.controller';
import { AdminGuard } from './admin.guard';
import {
  FeaturedCardSlotParamDto,
  UpdateFeaturedCardDto,
} from './dto/featured-card-dtos';

const view = {
  slot: 1,
  imagePosition: 'left',
  promo: 'BOGO 50% OFF',
  product: null,
  updatedAt: new Date('2026-11-19'),
};

describe('AdminFeaturedCardsController', () => {
  let controller: AdminFeaturedCardsController;
  const featuredCardsService = {
    getForAdmin: jest.fn(),
    updateCard: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminFeaturedCardsController],
      providers: [
        { provide: FeaturedCardsService, useValue: featuredCardsService },
        AdminGuard,
        { provide: JwtService, useValue: {} },
      ],
    }).compile();

    controller = moduleRef.get(AdminFeaturedCardsController);
  });

  it('protects every route with AdminGuard', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminFeaturedCardsController),
    ).toEqual([AdminGuard]);
  });

  it('findAll returns both cards', async () => {
    featuredCardsService.getForAdmin.mockResolvedValue([view]);

    await expect(controller.findAll()).resolves.toEqual([view]);
  });

  it('update passes the slot and changes to the service', async () => {
    featuredCardsService.updateCard.mockResolvedValue(view);

    await expect(
      controller.update({ slot: 1 }, { promo: 'BOGO 50% OFF' }),
    ).resolves.toBe(view);
    expect(featuredCardsService.updateCard).toHaveBeenCalledWith(1, {
      promo: 'BOGO 50% OFF',
    });
  });
});

// Same options as the global ValidationPipe.
function errorsFor<T extends object>(cls: new () => T, plain: object) {
  const dto = plainToInstance(cls, plain);
  return {
    dto,
    errors: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }),
  };
}

describe('featured card DTOs', () => {
  it('converts the slot route param to a number', () => {
    const { dto, errors } = errorsFor(FeaturedCardSlotParamDto, { slot: '2' });
    expect(errors).toHaveLength(0);
    expect(dto.slot).toBe(2);
  });

  it.each([['0'], ['3'], ['1.5'], ['abc']])('rejects slot %s', (slot) => {
    expect(
      errorsFor(FeaturedCardSlotParamDto, { slot }).errors.length,
    ).toBeGreaterThan(0);
  });

  it('accepts every field and trims the promo', () => {
    const { dto, errors } = errorsFor(UpdateFeaturedCardDto, {
      productSlug: 'neck-pillow-2-0',
      imagePosition: 'right',
      promo: '  BOGO 50% OFF  ',
    });
    expect(errors).toHaveLength(0);
    expect(dto.promo).toBe('BOGO 50% OFF');
  });

  it('accepts an empty body', () => {
    expect(errorsFor(UpdateFeaturedCardDto, {}).errors).toHaveLength(0);
  });

  it('accepts productSlug null (hide the card)', () => {
    expect(
      errorsFor(UpdateFeaturedCardDto, { productSlug: null }).errors,
    ).toHaveLength(0);
  });

  it('turns a blank promo into null', () => {
    const { dto, errors } = errorsFor(UpdateFeaturedCardDto, { promo: '   ' });
    expect(errors).toHaveLength(0);
    expect(dto.promo).toBeNull();
  });

  it.each([
    ['a bad slug', { productSlug: 'Neck Pillow' }],
    ['a non-string slug', { productSlug: 5 }],
    ['an unknown image side', { imagePosition: 'top' }],
    ['imagePosition null', { imagePosition: null }],
    ['a promo over 30 characters', { promo: 'a'.repeat(31) }],
    ['a price (use the product route)', { price: 100 }],
    ['an unknown field', { featured: true }],
  ])('rejects %s', (_case, plain) => {
    expect(
      errorsFor(UpdateFeaturedCardDto, plain).errors.length,
    ).toBeGreaterThan(0);
  });
});
