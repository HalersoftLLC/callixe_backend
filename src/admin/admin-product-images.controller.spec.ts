import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ProductImagesService } from '../products/product-images.service';
import { AdminProductImagesController } from './admin-product-images.controller';
import { AdminGuard } from './admin.guard';
import {
  ProductImageParamDto,
  UpdateProductImageDto,
  UploadProductImageDto,
} from './dto/product-image-dtos';

const view = { id: 7, url: 'http://img.test/a.png', isMain: true, position: 0 };
const file = { buffer: Buffer.from('png') } as Express.Multer.File;

describe('AdminProductImagesController', () => {
  let controller: AdminProductImagesController;
  const productImagesService = {
    upload: jest.fn(),
    update: jest.fn(),
    replaceFile: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminProductImagesController],
      providers: [
        { provide: ProductImagesService, useValue: productImagesService },
        AdminGuard,
        { provide: JwtService, useValue: {} },
      ],
    }).compile();

    controller = moduleRef.get(AdminProductImagesController);
  });

  it('protects every route with AdminGuard', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminProductImagesController),
    ).toEqual([AdminGuard]);
  });

  it('upload passes the file and isMain to the service', async () => {
    productImagesService.upload.mockResolvedValue(view);

    await expect(
      controller.upload({ slug: 'neck-pillow-2-0' }, file, { isMain: true }),
    ).resolves.toBe(view);
    expect(productImagesService.upload).toHaveBeenCalledWith(
      'neck-pillow-2-0',
      file,
      { isMain: true },
    );
  });

  it('update passes the changes and returns the reordered list', async () => {
    productImagesService.update.mockResolvedValue([view]);

    await expect(
      controller.update(
        { slug: 'neck-pillow-2-0', imageId: 7 },
        { position: 0 },
      ),
    ).resolves.toEqual([view]);
    expect(productImagesService.update).toHaveBeenCalledWith(
      'neck-pillow-2-0',
      7,
      { position: 0 },
    );
  });

  it('replaceFile passes the new file', async () => {
    productImagesService.replaceFile.mockResolvedValue(view);

    await controller.replaceFile({ slug: 'neck-pillow-2-0', imageId: 7 }, file);
    expect(productImagesService.replaceFile).toHaveBeenCalledWith(
      'neck-pillow-2-0',
      7,
      file,
    );
  });

  it('remove answers 204 No Content', async () => {
    productImagesService.remove.mockResolvedValue(undefined);

    await controller.remove({ slug: 'neck-pillow-2-0', imageId: 7 });
    expect(productImagesService.remove).toHaveBeenCalledWith(
      'neck-pillow-2-0',
      7,
    );
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        AdminProductImagesController.prototype.remove,
      ),
    ).toBe(204);
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

describe('product image DTOs', () => {
  it('converts the imageId route param to a number', () => {
    const { dto, errors } = errorsFor(ProductImageParamDto, {
      slug: 'neck-pillow-2-0',
      imageId: '7',
    });
    expect(errors).toHaveLength(0);
    expect(dto.imageId).toBe(7);
  });

  it.each([
    ['a non-numeric imageId', { slug: 'a', imageId: 'abc' }],
    ['imageId 0', { slug: 'a', imageId: '0' }],
    ['a bad slug', { slug: 'A B', imageId: '1' }],
  ])('rejects %s', (_case, plain) => {
    expect(
      errorsFor(ProductImageParamDto, plain).errors.length,
    ).toBeGreaterThan(0);
  });

  it('reads isMain from a multipart text field', () => {
    expect(
      errorsFor(UploadProductImageDto, { isMain: 'true' }).dto.isMain,
    ).toBe(true);
    expect(errorsFor(UploadProductImageDto, {}).errors).toHaveLength(0);
    expect(
      errorsFor(UploadProductImageDto, { isMain: 'yes' }).errors.length,
    ).toBeGreaterThan(0);
  });

  it.each([
    ['isMain false (choose another main instead)', { isMain: false }],
    ['a negative position', { position: -1 }],
    ['a position past the image limit', { position: 10 }],
    ['a decimal position', { position: 1.5 }],
    ['an unknown field', { storageKey: 'x' }],
  ])('update rejects %s', (_case, body) => {
    expect(
      errorsFor(UpdateProductImageDto, body).errors.length,
    ).toBeGreaterThan(0);
  });

  it('update accepts isMain true and a position', () => {
    expect(
      errorsFor(UpdateProductImageDto, { isMain: true, position: 2 }).errors,
    ).toHaveLength(0);
  });
});
