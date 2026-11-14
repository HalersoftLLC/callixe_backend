import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ProductImage } from './entities/product-image.entity';
import { Product } from './entities/product.entity';
import {
  MAX_IMAGES_PER_PRODUCT,
  ProductImagesService,
} from './product-images.service';
import { IMAGE_STORAGE } from './storage/image-storage';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const SLUG = 'neck-pillow-2-0';
const KEY_PATTERN = /^test\/products\/neck-pillow-2-0\/[0-9a-f-]{36}\.png$/;

const product = { id: 1, slug: SLUG } as Product;

function makeImage(overrides: Partial<ProductImage> = {}): ProductImage {
  return {
    id: 10,
    productId: 1,
    storageKey: 'test/products/neck-pillow-2-0/old.png',
    contentType: 'image/png',
    isMain: false,
    position: 0,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('ProductImagesService', () => {
  let service: ProductImagesService;
  let storedImages: ProductImage[];

  const storage = {
    put: jest.fn(),
    delete: jest.fn(),
    publicUrl: (key: string) => `http://img.test/${key}`,
  };
  const manager = {
    findOne: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn(),
  };
  const productsRepository = { findOneBy: jest.fn() };
  const imagesRepository = { findOneBy: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    storedImages = [];

    storage.put.mockResolvedValue(undefined);
    storage.delete.mockResolvedValue(undefined);
    dataSource.transaction.mockImplementation(
      (work: (m: typeof manager) => Promise<unknown>) => work(manager),
    );
    productsRepository.findOneBy.mockResolvedValue(product);
    manager.findOne.mockResolvedValue(product);
    manager.find.mockImplementation(() => Promise.resolve(storedImages));
    manager.update.mockResolvedValue({ affected: 1 });
    manager.delete.mockResolvedValue({ affected: 1 });
    manager.create.mockImplementation(
      (_entity: unknown, data: Partial<ProductImage>) => data,
    );
    manager.save.mockImplementation((data: Partial<ProductImage>) =>
      Promise.resolve(makeImage({ id: 99, ...data })),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductImagesService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(Product), useValue: productsRepository },
        {
          provide: getRepositoryToken(ProductImage),
          useValue: imagesRepository,
        },
        { provide: IMAGE_STORAGE, useValue: storage },
        { provide: ConfigService, useValue: { get: () => 'test' } },
      ],
    }).compile();

    service = moduleRef.get(ProductImagesService);
  });

  describe('upload', () => {
    it('rejects a file that is not a real image before storing anything', async () => {
      await expect(
        service.upload(SLUG, { buffer: Buffer.from('<svg/>') }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown product before storing anything', async () => {
      productsRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.upload('missing', { buffer: PNG }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('stores the file under a fresh key and makes the first image main', async () => {
      const view = await service.upload(SLUG, { buffer: PNG });

      const [key, body, contentType] = storage.put.mock.calls[0] as [
        string,
        Buffer,
        string,
      ];
      expect(key).toMatch(KEY_PATTERN);
      expect(body).toBe(PNG);
      expect(contentType).toBe('image/png');
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 1,
          storageKey: key,
          contentType: 'image/png',
          isMain: true,
          position: 0,
        }),
      );
      expect(view).toEqual({
        id: 99,
        url: `http://img.test/${key}`,
        isMain: true,
        position: 0,
      });
    });

    it('uses the detected type for the extension, not the client file name', async () => {
      await service.upload(SLUG, { buffer: JPEG });

      expect(storage.put.mock.calls[0][0]).toMatch(/\.jpg$/);
      expect(storage.put.mock.calls[0][2]).toBe('image/jpeg');
    });

    it('locks the product row for the whole change', async () => {
      await service.upload(SLUG, { buffer: PNG });

      expect(manager.findOne).toHaveBeenCalledWith(Product, {
        where: { slug: SLUG },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('appends later images at the end without changing the main image', async () => {
      storedImages = [
        makeImage({ id: 1, isMain: true, position: 0 }),
        makeImage({ id: 2, position: 1 }),
      ];

      await service.upload(SLUG, { buffer: PNG });

      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ isMain: false, position: 2 }),
      );
    });

    it('clears the old main image first when isMain is requested', async () => {
      storedImages = [makeImage({ id: 1, isMain: true })];

      await service.upload(SLUG, { buffer: PNG }, { isMain: true });

      expect(manager.update).toHaveBeenCalledWith(
        ProductImage,
        { productId: 1, isMain: true },
        { isMain: false },
      );
      expect(manager.update.mock.invocationCallOrder[0]).toBeLessThan(
        manager.save.mock.invocationCallOrder[0],
      );
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ isMain: true }),
      );
    });

    it(`rejects image ${MAX_IMAGES_PER_PRODUCT + 1} and deletes the file it just stored`, async () => {
      storedImages = Array.from({ length: MAX_IMAGES_PER_PRODUCT }, (_, i) =>
        makeImage({ id: i + 1, position: i, isMain: i === 0 }),
      );

      await expect(
        service.upload(SLUG, { buffer: PNG }),
      ).rejects.toBeInstanceOf(BadRequestException);
      const storedKey = storage.put.mock.calls[0][0] as string;
      expect(storage.delete).toHaveBeenCalledWith(storedKey);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('deletes the stored file when the database step fails', async () => {
      const failure = new Error('db down');
      manager.save.mockRejectedValue(failure);

      await expect(service.upload(SLUG, { buffer: PNG })).rejects.toBe(failure);
      expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0][0]);
    });

    it('still reports the original error when the cleanup delete also fails', async () => {
      const failure = new Error('db down');
      manager.save.mockRejectedValue(failure);
      storage.delete.mockRejectedValue(new Error('storage down'));

      await expect(service.upload(SLUG, { buffer: PNG })).rejects.toBe(failure);
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });

    it('does not touch the database when storing the file fails', async () => {
      storage.put.mockRejectedValue(new Error('storage down'));

      await expect(service.upload(SLUG, { buffer: PNG })).rejects.toThrow(
        'storage down',
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    beforeEach(() => {
      storedImages = [
        makeImage({ id: 1, isMain: true, position: 0, storageKey: 'a.png' }),
        makeImage({ id: 2, position: 1, storageKey: 'b.png' }),
        makeImage({ id: 3, position: 2, storageKey: 'c.png' }),
      ];
    });

    it('makes another image main (old main cleared first)', async () => {
      const views = await service.update(SLUG, 3, { isMain: true });

      expect(manager.update).toHaveBeenNthCalledWith(
        1,
        ProductImage,
        { productId: 1, isMain: true },
        { isMain: false },
      );
      expect(manager.update).toHaveBeenNthCalledWith(
        2,
        ProductImage,
        { id: 3 },
        { isMain: true },
      );
      expect(views.map((v) => [v.id, v.isMain])).toEqual([
        [1, false],
        [2, false],
        [3, true],
      ]);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('does nothing when the image is already main', async () => {
      await service.update(SLUG, 1, { isMain: true });

      expect(manager.update).not.toHaveBeenCalled();
    });

    it('moves an image and renumbers the others densely', async () => {
      const views = await service.update(SLUG, 3, { position: 0 });

      expect(views.map((v) => [v.id, v.position])).toEqual([
        [3, 0],
        [1, 1],
        [2, 2],
      ]);
      expect(manager.update).toHaveBeenCalledWith(
        ProductImage,
        { id: 3 },
        { position: 0 },
      );
    });

    it('clamps a position past the end to the last place', async () => {
      const views = await service.update(SLUG, 1, { position: 9 });

      expect(views.map((v) => v.id)).toEqual([2, 3, 1]);
    });

    it('returns 404 for an image that belongs to another product', async () => {
      await expect(
        service.update(SLUG, 42, { isMain: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('replaceFile', () => {
    const existing = makeImage({
      id: 5,
      isMain: true,
      position: 0,
      storageKey: 'test/products/neck-pillow-2-0/old.png',
    });

    beforeEach(() => {
      imagesRepository.findOneBy.mockResolvedValue(existing);
      storedImages = [existing];
    });

    it('stores the new file, updates the same row, then deletes the old file', async () => {
      const view = await service.replaceFile(SLUG, 5, { buffer: PNG });

      const newKey = storage.put.mock.calls[0][0] as string;
      expect(newKey).toMatch(KEY_PATTERN);
      expect(manager.update).toHaveBeenCalledWith(
        ProductImage,
        { id: 5 },
        { storageKey: newKey, contentType: 'image/png' },
      );
      expect(storage.delete).toHaveBeenCalledWith(existing.storageKey);
      // The old file is deleted only after the transaction finished.
      expect(storage.delete.mock.invocationCallOrder[0]).toBeGreaterThan(
        manager.update.mock.invocationCallOrder[0],
      );
      expect(view).toEqual({
        id: 5,
        url: `http://img.test/${newKey}`,
        isMain: true,
        position: 0,
      });
    });

    it('keeps the old file and deletes the new one when the database step fails', async () => {
      const failure = new Error('db down');
      manager.update.mockRejectedValue(failure);

      await expect(service.replaceFile(SLUG, 5, { buffer: PNG })).rejects.toBe(
        failure,
      );
      const newKey = storage.put.mock.calls[0][0] as string;
      expect(storage.delete).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledWith(newKey);
    });

    it('succeeds even if deleting the old file fails (logged only)', async () => {
      storage.delete.mockRejectedValue(new Error('storage down'));

      await expect(
        service.replaceFile(SLUG, 5, { buffer: PNG }),
      ).resolves.toMatchObject({ id: 5 });
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });

    it('returns 404 for an unknown image before storing anything', async () => {
      imagesRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.replaceFile(SLUG, 42, { buffer: PNG }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('rejects a non-image before storing anything', async () => {
      await expect(
        service.replaceFile(SLUG, 5, { buffer: Buffer.from('GIF89a') }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      storedImages = [
        makeImage({ id: 1, isMain: true, position: 0, storageKey: 'a.png' }),
        makeImage({ id: 2, position: 1, storageKey: 'b.png' }),
        makeImage({ id: 3, position: 2, storageKey: 'c.png' }),
      ];
    });

    it('deletes the row, then the file', async () => {
      await service.remove(SLUG, 2);

      expect(manager.delete).toHaveBeenCalledWith(ProductImage, { id: 2 });
      expect(storage.delete).toHaveBeenCalledWith('b.png');
      expect(storage.delete.mock.invocationCallOrder[0]).toBeGreaterThan(
        manager.delete.mock.invocationCallOrder[0],
      );
    });

    it('closes the gap in positions', async () => {
      await service.remove(SLUG, 2);

      expect(manager.update).toHaveBeenCalledWith(
        ProductImage,
        { id: 3 },
        { position: 1 },
      );
    });

    it('promotes the next image when the main image is removed', async () => {
      await service.remove(SLUG, 1);

      expect(manager.update).toHaveBeenCalledWith(
        ProductImage,
        { id: 2 },
        { isMain: true },
      );
    });

    it('does not fail when deleting the file fails (logged only)', async () => {
      storage.delete.mockRejectedValue(new Error('storage down'));

      await expect(service.remove(SLUG, 2)).resolves.toBeUndefined();
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });

    it('keeps the file when the database step fails', async () => {
      manager.delete.mockRejectedValue(new Error('db down'));

      await expect(service.remove(SLUG, 2)).rejects.toThrow('db down');
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown image', async () => {
      await expect(service.remove(SLUG, 42)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });
});
