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
import { ProductImage } from './entities/product-image.entity';
import { Product } from './entities/product.entity';
import { detectImageType, IMAGE_TYPES } from './image-type';
import { IMAGE_STORAGE, type ImageStorage } from './storage/image-storage';

// Types and limits the Admin module uses (it imports only service files).
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 10;

export interface ImageUpload {
  buffer: Buffer;
}

export interface AdminProductImageView {
  id: number;
  url: string;
  isMain: boolean;
  position: number;
}

export interface ProductImageChanges {
  isMain?: true;
  position?: number;
}

// Stored image key: environment prefix keeps dev and prod files apart even in
// one bucket; a random UUID means a key is never reused or guessable.
function buildStorageKey(env: string, slug: string, ext: string): string {
  return `${env}/products/${slug}/${randomUUID()}.${ext}`;
}

export function sortImages(images: ProductImage[]): ProductImage[] {
  return [...images].sort((a, b) => a.position - b.position || a.id - b.id);
}

export function toAdminImageView(
  image: ProductImage,
  storage: ImageStorage,
): AdminProductImageView {
  return {
    id: image.id,
    url: storage.publicUrl(image.storageKey),
    isMain: image.isMain,
    position: image.position,
  };
}

// Every change follows the same order so a failure never leaves a broken
// image link:
//   1. write the new file to storage,
//   2. change the database in a transaction that locks the product row
//      (concurrent uploads for one product run one after another, so the
//      10-image limit and the one-main-image rule can't be raced),
//   3. if the database step fails, delete the file written in step 1,
//   4. only after commit, delete the file that is no longer used.
// A failed delete in steps 3/4 is logged, never thrown: the worst case is an
// unused file in storage, never a product pointing at a missing file.
@Injectable()
export class ProductImagesService {
  private readonly logger = new Logger(ProductImagesService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(ProductImage)
    private readonly imagesRepository: Repository<ProductImage>,
    @Inject(IMAGE_STORAGE) private readonly storage: ImageStorage,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async upload(
    slug: string,
    file: ImageUpload,
    options: { isMain?: boolean } = {},
  ): Promise<AdminProductImageView> {
    const contentType = this.detectOrReject(file.buffer);
    // 404 before anything is written to storage.
    await this.findProduct(slug);

    const key = this.buildKey(slug, IMAGE_TYPES[contentType]);
    await this.storage.put(key, file.buffer, contentType);

    try {
      const image = await this.dataSource.transaction(async (manager) => {
        const product = await this.lockProduct(manager, slug);
        const images = await this.loadImages(manager, product.id);
        if (images.length >= MAX_IMAGES_PER_PRODUCT) {
          throw new BadRequestException(
            `A product can have at most ${MAX_IMAGES_PER_PRODUCT} images`,
          );
        }

        // The first image is always main, so a product with images always
        // has exactly one.
        const isMain = options.isMain === true || images.length === 0;
        if (isMain) {
          // Clear the old main first: the partial unique index allows only one.
          await manager.update(
            ProductImage,
            { productId: product.id, isMain: true },
            { isMain: false },
          );
        }

        return manager.save(
          manager.create(ProductImage, {
            productId: product.id,
            storageKey: key,
            contentType,
            isMain,
            position: images.length,
          }),
        );
      });
      return toAdminImageView(image, this.storage);
    } catch (error) {
      await this.deleteQuietly(key);
      throw error;
    }
  }

  // Sets the main image and/or moves an image. Returns all images of the
  // product in their new order, because a move changes other positions too.
  async update(
    slug: string,
    imageId: number,
    changes: ProductImageChanges,
  ): Promise<AdminProductImageView[]> {
    const images = await this.dataSource.transaction(async (manager) => {
      const product = await this.lockProduct(manager, slug);
      let images = await this.loadImages(manager, product.id);
      const target = findImageOrFail(images, imageId);

      if (changes.isMain && !target.isMain) {
        await manager.update(
          ProductImage,
          { productId: product.id, isMain: true },
          { isMain: false },
        );
        await manager.update(ProductImage, { id: target.id }, { isMain: true });
        images = images.map((image) => ({
          ...image,
          isMain: image.id === target.id,
        }));
      }

      if (changes.position !== undefined) {
        const others = images.filter((image) => image.id !== target.id);
        const index = Math.min(Math.max(changes.position, 0), others.length);
        others.splice(
          index,
          0,
          images.find((i) => i.id === target.id)!,
        );
        images = await this.savePositions(manager, others);
      }
      return images;
    });
    return images.map((image) => toAdminImageView(image, this.storage));
  }

  async replaceFile(
    slug: string,
    imageId: number,
    file: ImageUpload,
  ): Promise<AdminProductImageView> {
    const contentType = this.detectOrReject(file.buffer);
    // 404s before anything is written to storage.
    const product = await this.findProduct(slug);
    await this.findImage(product.id, imageId);

    const key = this.buildKey(slug, IMAGE_TYPES[contentType]);
    await this.storage.put(key, file.buffer, contentType);

    let result: { image: ProductImage; previousKey: string };
    try {
      result = await this.dataSource.transaction(async (manager) => {
        const locked = await this.lockProduct(manager, slug);
        const images = await this.loadImages(manager, locked.id);
        const image = findImageOrFail(images, imageId);
        const previousKey = image.storageKey;

        // Same row: id, main flag and position stay the same.
        await manager.update(
          ProductImage,
          { id: image.id },
          { storageKey: key, contentType },
        );
        return {
          image: { ...image, storageKey: key, contentType },
          previousKey,
        };
      });
    } catch (error) {
      await this.deleteQuietly(key);
      throw error;
    }

    // The old file is removed only after the new one is saved and committed.
    await this.deleteQuietly(result.previousKey);
    return toAdminImageView(result.image, this.storage);
  }

  async remove(slug: string, imageId: number): Promise<void> {
    const removedKey = await this.dataSource.transaction(async (manager) => {
      const product = await this.lockProduct(manager, slug);
      const images = await this.loadImages(manager, product.id);
      const target = findImageOrFail(images, imageId);

      await manager.delete(ProductImage, { id: target.id });
      const remaining = images.filter((image) => image.id !== target.id);

      // Keep exactly one main image while any image is left.
      if (target.isMain && remaining.length > 0) {
        await manager.update(
          ProductImage,
          { id: remaining[0].id },
          { isMain: true },
        );
      }
      await this.savePositions(manager, remaining);
      return target.storageKey;
    });

    // Row first, file second: a failure leaves an unused file, never a
    // product pointing at a missing one.
    await this.deleteQuietly(removedKey);
  }

  private detectOrReject(buffer: Buffer) {
    const contentType = detectImageType(buffer);
    if (!contentType) {
      throw new BadRequestException(
        'Only JPEG, PNG or WebP images are allowed',
      );
    }
    return contentType;
  }

  private buildKey(slug: string, ext: string): string {
    return buildStorageKey(
      this.config.get('NODE_ENV', { infer: true }),
      slug,
      ext,
    );
  }

  private async findProduct(slug: string): Promise<Product> {
    const product = await this.productsRepository.findOneBy({ slug });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private async findImage(
    productId: number,
    imageId: number,
  ): Promise<ProductImage> {
    const image = await this.imagesRepository.findOneBy({
      id: imageId,
      productId,
    });
    if (!image) throw new NotFoundException('Image not found');
    return image;
  }

  // SELECT … FOR UPDATE on the product row serializes all image changes for
  // that product until the transaction ends.
  private async lockProduct(
    manager: EntityManager,
    slug: string,
  ): Promise<Product> {
    const product = await manager.findOne(Product, {
      where: { slug },
      lock: { mode: 'pessimistic_write' },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private async loadImages(
    manager: EntityManager,
    productId: number,
  ): Promise<ProductImage[]> {
    const images = await manager.find(ProductImage, { where: { productId } });
    return sortImages(images);
  }

  // Renumbers to 0, 1, 2, … in the given order; writes only changed rows.
  private async savePositions(
    manager: EntityManager,
    ordered: ProductImage[],
  ): Promise<ProductImage[]> {
    const result: ProductImage[] = [];
    for (const [position, image] of ordered.entries()) {
      if (image.position !== position) {
        await manager.update(ProductImage, { id: image.id }, { position });
      }
      result.push({ ...image, position });
    }
    return result;
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

function findImageOrFail(
  images: ProductImage[],
  imageId: number,
): ProductImage {
  const image = images.find((candidate) => candidate.id === imageId);
  if (!image) throw new NotFoundException('Image not found');
  return image;
}
