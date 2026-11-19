import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ShopHero } from './entities/shop-hero.entity';
import { ShopHeroService } from './shop-hero.service';
import { IMAGE_STORAGE } from './storage/image-storage';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const KEY_PATTERN = /^test\/shop-hero\/[0-9a-f-]{36}\.png$/;
const OLD_KEY = 'test/shop-hero/old.jpg';
const UPDATED_AT = new Date('2026-11-19T10:00:00Z');

function makeHero(overrides: Partial<ShopHero> = {}): ShopHero {
  return {
    id: 1,
    eyebrow: 'Science backed relief at its lowest price',
    title: 'Black Friday Sale Is On',
    imageStorageKey: null,
    imageContentType: null,
    imageAlt: null,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

describe('ShopHeroService', () => {
  let service: ShopHeroService;
  let warn: jest.SpyInstance;

  const storage = {
    put: jest.fn(),
    delete: jest.fn(),
    publicUrl: (key: string) => `http://img.test/${key}`,
  };
  const manager = { findOne: jest.fn(), update: jest.fn() };
  const dataSource = { transaction: jest.fn() };
  const repository = { findOneBy: jest.fn(), update: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    storage.put.mockResolvedValue(undefined);
    storage.delete.mockResolvedValue(undefined);
    dataSource.transaction.mockImplementation(
      (work: (m: typeof manager) => Promise<unknown>) => work(manager),
    );
    repository.findOneBy.mockResolvedValue(makeHero());
    repository.update.mockResolvedValue({ affected: 1 });
    manager.findOne.mockResolvedValue(makeHero());
    manager.update.mockResolvedValue({ affected: 1 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ShopHeroService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(ShopHero), useValue: repository },
        { provide: IMAGE_STORAGE, useValue: storage },
        { provide: ConfigService, useValue: { get: () => 'test' } },
      ],
    }).compile();

    service = moduleRef.get(ShopHeroService);
  });

  describe('getPublic', () => {
    it('returns the text and no image when none is uploaded', async () => {
      await expect(service.getPublic()).resolves.toEqual({
        eyebrow: 'Science backed relief at its lowest price',
        title: 'Black Friday Sale Is On',
        image: null,
      });
    });

    it('builds the image URL from the storage key and never exposes the key', async () => {
      repository.findOneBy.mockResolvedValue(
        makeHero({
          imageStorageKey: OLD_KEY,
          imageContentType: 'image/jpeg',
          imageAlt: 'Woman resting on a back pillow',
        }),
      );

      const view = await service.getPublic();
      expect(view.image).toEqual({
        url: `http://img.test/${OLD_KEY}`,
        alt: 'Woman resting on a back pillow',
      });
      expect(JSON.stringify(view)).not.toContain('storageKey');
    });

    it('uses the title as alt text when no description is set', async () => {
      repository.findOneBy.mockResolvedValue(
        makeHero({ imageStorageKey: OLD_KEY, imageContentType: 'image/jpeg' }),
      );

      const view = await service.getPublic();
      expect(view.image?.alt).toBe('Black Friday Sale Is On');
    });

    it('returns 404 when the row is missing (migration not run)', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.getPublic()).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('writes only the text fields that were sent', async () => {
      await service.update({ title: 'Cyber Monday Is On' });

      expect(repository.update).toHaveBeenCalledWith(
        { id: 1 },
        { title: 'Cyber Monday Is On' },
      );
    });

    it('can clear the image description with null', async () => {
      await service.update({ imageAlt: null });

      expect(repository.update).toHaveBeenCalledWith(
        { id: 1 },
        { imageAlt: null },
      );
    });

    it('never touches the image columns', async () => {
      await service.update({ eyebrow: 'New line', title: 'New title' });

      const [, columns] = repository.update.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(Object.keys(columns).sort()).toEqual(['eyebrow', 'title']);
    });

    it('skips the write for an empty change and returns the current hero', async () => {
      const view = await service.update({});

      expect(repository.update).not.toHaveBeenCalled();
      expect(view.title).toBe('Black Friday Sale Is On');
    });

    it('returns 404 when the row is missing', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.update({ title: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('replaceImage', () => {
    it('rejects a file that is not a real image before storing anything', async () => {
      await expect(
        service.replaceImage({ buffer: Buffer.from('<svg/>') }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('returns 404 before storing anything when the row is missing', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.replaceImage({ buffer: PNG }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('stores the file under a fresh key, saves it, and keeps no old file to delete', async () => {
      await service.replaceImage({ buffer: PNG });

      const [key, body, contentType] = storage.put.mock.calls[0] as [
        string,
        Buffer,
        string,
      ];
      expect(key).toMatch(KEY_PATTERN);
      expect(body).toBe(PNG);
      expect(contentType).toBe('image/png');
      expect(manager.findOne).toHaveBeenCalledWith(ShopHero, {
        where: { id: 1 },
        lock: { mode: 'pessimistic_write' },
      });
      expect(manager.update).toHaveBeenCalledWith(
        ShopHero,
        { id: 1 },
        { imageStorageKey: key, imageContentType: 'image/png' },
      );
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('deletes the old file only after the new one is committed', async () => {
      manager.findOne.mockResolvedValue(
        makeHero({ imageStorageKey: OLD_KEY, imageContentType: 'image/jpeg' }),
      );
      const order: string[] = [];
      dataSource.transaction.mockImplementation(
        async (work: (m: typeof manager) => Promise<unknown>) => {
          const result = await work(manager);
          order.push('commit');
          return result;
        },
      );
      storage.delete.mockImplementation(() => {
        order.push('delete');
        return Promise.resolve();
      });

      await service.replaceImage({ buffer: PNG });

      expect(storage.delete).toHaveBeenCalledWith(OLD_KEY);
      expect(order).toEqual(['commit', 'delete']);
    });

    it('deletes the new file and keeps the old one when the database step fails', async () => {
      manager.findOne.mockResolvedValue(
        makeHero({ imageStorageKey: OLD_KEY, imageContentType: 'image/jpeg' }),
      );
      manager.update.mockRejectedValue(new Error('db down'));

      await expect(service.replaceImage({ buffer: PNG })).rejects.toThrow(
        'db down',
      );
      const [newKey] = storage.put.mock.calls[0] as [string];
      expect(storage.delete).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledWith(newKey);
    });

    it('logs, but does not fail, when the old file cannot be deleted', async () => {
      manager.findOne.mockResolvedValue(
        makeHero({ imageStorageKey: OLD_KEY, imageContentType: 'image/jpeg' }),
      );
      storage.delete.mockRejectedValue(new Error('storage down'));

      await expect(
        service.replaceImage({ buffer: PNG }),
      ).resolves.toBeDefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(OLD_KEY));
    });
  });

  describe('removeImage', () => {
    it('clears the image in the row, then deletes the file', async () => {
      manager.findOne.mockResolvedValue(
        makeHero({ imageStorageKey: OLD_KEY, imageContentType: 'image/jpeg' }),
      );

      await service.removeImage();

      expect(manager.update).toHaveBeenCalledWith(
        ShopHero,
        { id: 1 },
        { imageStorageKey: null, imageContentType: null },
      );
      expect(storage.delete).toHaveBeenCalledWith(OLD_KEY);
    });

    it('does nothing when there is no image', async () => {
      await service.removeImage();

      expect(manager.update).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('keeps the file when the database step fails', async () => {
      manager.findOne.mockResolvedValue(
        makeHero({ imageStorageKey: OLD_KEY, imageContentType: 'image/jpeg' }),
      );
      manager.update.mockRejectedValue(new Error('db down'));

      await expect(service.removeImage()).rejects.toThrow('db down');
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });
});
