import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ShopHeroService } from '../products/shop-hero.service';
import { AdminShopHeroController } from './admin-shop-hero.controller';
import { AdminGuard } from './admin.guard';
import { UpdateShopHeroDto } from './dto/update-shop-hero.dto';

const view = {
  eyebrow: 'Science backed relief at its lowest price',
  title: 'Black Friday Sale Is On',
  imageAlt: null,
  image: { url: 'http://img.test/test/shop-hero/a.png' },
  updatedAt: new Date('2026-11-19'),
};
const file = { buffer: Buffer.from('png') } as Express.Multer.File;

describe('AdminShopHeroController', () => {
  let controller: AdminShopHeroController;
  const shopHeroService = {
    getForAdmin: jest.fn(),
    update: jest.fn(),
    replaceImage: jest.fn(),
    removeImage: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminShopHeroController],
      providers: [
        { provide: ShopHeroService, useValue: shopHeroService },
        AdminGuard,
        { provide: JwtService, useValue: {} },
      ],
    }).compile();

    controller = moduleRef.get(AdminShopHeroController);
  });

  it('protects every route with AdminGuard', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminShopHeroController),
    ).toEqual([AdminGuard]);
  });

  it('find returns the admin view', async () => {
    shopHeroService.getForAdmin.mockResolvedValue(view);

    await expect(controller.find()).resolves.toBe(view);
  });

  it('update passes the changes to the service', async () => {
    shopHeroService.update.mockResolvedValue(view);

    await controller.update({ title: 'Cyber Monday Is On' });
    expect(shopHeroService.update).toHaveBeenCalledWith({
      title: 'Cyber Monday Is On',
    });
  });

  it('replaceImage passes the uploaded file', async () => {
    shopHeroService.replaceImage.mockResolvedValue(view);

    await expect(controller.replaceImage(file)).resolves.toBe(view);
    expect(shopHeroService.replaceImage).toHaveBeenCalledWith(file);
  });

  it('removeImage answers 204 No Content', async () => {
    shopHeroService.removeImage.mockResolvedValue(undefined);

    await controller.removeImage();
    expect(shopHeroService.removeImage).toHaveBeenCalled();
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        AdminShopHeroController.prototype.removeImage,
      ),
    ).toBe(204);
  });
});

// Same options as the global ValidationPipe.
function validate(plain: object) {
  const dto = plainToInstance(UpdateShopHeroDto, plain);
  return {
    dto,
    errors: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }),
  };
}

describe('UpdateShopHeroDto', () => {
  it('accepts every field and trims the text', () => {
    const { dto, errors } = validate({
      eyebrow: '  Science backed relief  ',
      title: ' Black Friday Sale Is On ',
      imageAlt: ' Woman resting on a back pillow ',
    });
    expect(errors).toHaveLength(0);
    expect(dto).toEqual({
      eyebrow: 'Science backed relief',
      title: 'Black Friday Sale Is On',
      imageAlt: 'Woman resting on a back pillow',
    });
  });

  it('accepts an empty body', () => {
    expect(validate({}).errors).toHaveLength(0);
  });

  it('turns a blank image description into null', () => {
    const { dto, errors } = validate({ imageAlt: '   ' });
    expect(errors).toHaveLength(0);
    expect(dto.imageAlt).toBeNull();
  });

  it.each([
    ['a blank title', { title: '   ' }],
    ['a null title', { title: null }],
    ['a blank eyebrow', { eyebrow: '' }],
    ['a null eyebrow', { eyebrow: null }],
    ['a title over 100 characters', { title: 'a'.repeat(101) }],
    ['an eyebrow over 150 characters', { eyebrow: 'a'.repeat(151) }],
    ['an image alt over 200 characters', { imageAlt: 'a'.repeat(201) }],
    ['a non-string title', { title: 5 }],
    ['an image key (images use the upload route)', { imageStorageKey: 'x' }],
    ['an unknown field', { paragraph: 'x' }],
  ])('rejects %s', (_case, plain) => {
    expect(validate(plain).errors.length).toBeGreaterThan(0);
  });
});
