// Where product image files live. ProductImagesService talks only to this
// interface, so switching from local disk to DigitalOcean Spaces is an env
// change (STORAGE_DRIVER), not a code change.
export interface ImageStorage {
  // Stores a new object. Keys are always new (random UUID), never overwritten.
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  // Removes an object. Deleting a key that doesn't exist is not an error.
  delete(key: string): Promise<void>;
  // Public URL for a stored key.
  publicUrl(key: string): string;
}

// Injection token for the ImageStorage chosen in ProductsModule.
export const IMAGE_STORAGE = Symbol('IMAGE_STORAGE');

// Keys never change once written, so browsers and the CDN may cache forever.
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function joinPublicUrl(baseUrl: string, key: string): string {
  return `${baseUrl}/${key}`;
}
