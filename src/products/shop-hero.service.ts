import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { EnvironmentVariables } from '../config/env.validation';
import { ShopHero } from './entities/shop-hero.entity';
import { detectImageType, IMAGE_TYPES } from './image-type';
import { ImageUpload } from './product-images.service';
import { IMAGE_STORAGE, type ImageStorage } from './storage/image-storage';

// The table has exactly one row (CHK_shop_hero_single_row).
const SHOP_HERO_ID = 1;

// Limits the Admin DTO uses; they match the database columns.
export const SHOP_HERO_EYEBROW_MAX_LENGTH = 150;
export const SHOP_HERO_TITLE_MAX_LENGTH = 100;
export const SHOP_HERO_IMAGE_ALT_MAX_LENGTH = 200;

// GET /shop-hero. A null image means "use the storefront's own image".
export interface ShopHeroView {
  eyebrow: string;
  title: string;
  image: { url: string; alt: string } | null;
}

// Admin view: imageAlt is shown as saved (null = not set), so the form can
// tell an empty description from the title fallback.
export interface AdminShopHeroView {
  eyebrow: string;
  title: string;
  imageAlt: string | null;
  image: { url: string } | null;
  updatedAt: Date;
}

export interface ShopHeroChanges {
  eyebrow?: string;
  title?: string;
  imageAlt?: string | null;
}

// Image changes follow the same order as product images (ProductImagesService)
// so a failure never leaves the hero pointing at a missing file:
//   1. write the new file to storage,
//   2. update the row in a transaction that locks it (two uploads at once run
//      one after the other, so neither file is lost track of),
//   3. if the database step fails, delete the file written in step 1,
//   4. only after commit, delete the file that is no longer used.
// A failed delete is logged, never thrown: the worst case is an unused file.
@Injectable()
export class ShopHeroService {
  private readonly logger = new Logger(ShopHeroService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ShopHero)
    private readonly shopHeroRepository: Repository<ShopHero>,
    @Inject(IMAGE_STORAGE) private readonly storage: ImageStorage,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async getPublic(): Promise<ShopHeroView> {
    const hero = await this.findHero();
    return {
      eyebrow: hero.eyebrow,
      title: hero.title,
      image: hero.imageStorageKey
        ? {
            url: this.storage.publicUrl(hero.imageStorageKey),
            alt: hero.imageAlt ?? hero.title,
          }
        : null,
    };
  }

  async getForAdmin(): Promise<AdminShopHeroView> {
    return this.toAdminView(await this.findHero());
  }

  // Writes only the text columns that were sent, never the image columns, so
  // it can't undo an image change made at the same moment.
  async update(changes: ShopHeroChanges): Promise<AdminShopHeroView> {
    const columns: Partial<Pick<ShopHero, 'eyebrow' | 'title' | 'imageAlt'>> =
      {};
    if (changes.eyebrow !== undefined) columns.eyebrow = changes.eyebrow;
    if (changes.title !== undefined) columns.title = changes.title;
    if (changes.imageAlt !== undefined) columns.imageAlt = changes.imageAlt;

    // 404 if the row is missing, even for an empty change.
    await this.findHero();
    if (Object.keys(columns).length > 0) {
      await this.shopHeroRepository.update({ id: SHOP_HERO_ID }, columns);
    }
    return this.getForAdmin();
  }

  async replaceImage(file: ImageUpload): Promise<AdminShopHeroView> {
    const contentType = detectImageType(file.buffer);
    if (!contentType) {
      throw new BadRequestException(
        'Only JPEG, PNG or WebP images are allowed',
      );
    }
    // 404 before anything is written to storage.
    await this.findHero();

    const key = this.buildKey(IMAGE_TYPES[contentType]);
    await this.storage.put(key, file.buffer, contentType);

    let previousKey: string | null;
    try {
      previousKey = await this.dataSource.transaction(async (manager) => {
        const hero = await this.lockHero(manager);
        await manager.update(
          ShopHero,
          { id: SHOP_HERO_ID },
          { imageStorageKey: key, imageContentType: contentType },
        );
        return hero.imageStorageKey;
      });
    } catch (error) {
      await this.deleteQuietly(key);
      throw error;
    }

    // The old file is removed only after the new one is saved and committed.
    if (previousKey) await this.deleteQuietly(previousKey);
    return this.getForAdmin();
  }

  // Clears the image so the storefront shows its own one again. Calling it
  // when there is no image is not an error.
  async removeImage(): Promise<void> {
    const removedKey = await this.dataSource.transaction(async (manager) => {
      const hero = await this.lockHero(manager);
      if (hero.imageStorageKey) {
        await manager.update(
          ShopHero,
          { id: SHOP_HERO_ID },
          { imageStorageKey: null, imageContentType: null },
        );
      }
      return hero.imageStorageKey;
    });

    // Row first, file second: a failure leaves an unused file, never a hero
    // pointing at a missing one.
    if (removedKey) await this.deleteQuietly(removedKey);
  }

  // A missing row means the CreateShopHero migration has not been run.
  private async findHero(): Promise<ShopHero> {
    const hero = await this.shopHeroRepository.findOneBy({ id: SHOP_HERO_ID });
    if (!hero) throw new NotFoundException('Shop hero not found');
    return hero;
  }

  // SELECT … FOR UPDATE serializes image changes until the transaction ends.
  private async lockHero(manager: EntityManager): Promise<ShopHero> {
    const hero = await manager.findOne(ShopHero, {
      where: { id: SHOP_HERO_ID },
      lock: { mode: 'pessimistic_write' },
    });
    if (!hero) throw new NotFoundException('Shop hero not found');
    return hero;
  }

  // Environment prefix keeps dev and prod files apart even in one bucket; a
  // random UUID means a key is never reused, so it can be cached forever.
  private buildKey(ext: string): string {
    const env = this.config.get('NODE_ENV', { infer: true });
    return `${env}/shop-hero/${randomUUID()}.${ext}`;
  }

  private toAdminView(hero: ShopHero): AdminShopHeroView {
    return {
      eyebrow: hero.eyebrow,
      title: hero.title,
      imageAlt: hero.imageAlt,
      image: hero.imageStorageKey
        ? { url: this.storage.publicUrl(hero.imageStorageKey) }
        : null,
      updatedAt: hero.updatedAt,
    };
  }

  private async deleteQuietly(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not delete stored image "${key}": ${reason}`);
    }
  }
}
