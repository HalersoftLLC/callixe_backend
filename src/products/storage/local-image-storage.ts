import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { ImageStorage, joinPublicUrl } from './image-storage';

// Folder for STORAGE_DRIVER=local, served by main.ts at UPLOADS_ROUTE.
// Development only: validateEnv refuses this driver in production.
export const LOCAL_UPLOADS_DIR = join(process.cwd(), 'uploads');
export const UPLOADS_ROUTE = '/uploads';

export class LocalImageStorage implements ImageStorage {
  constructor(
    private readonly rootDir: string,
    private readonly publicBaseUrl: string,
  ) {}

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    // 'wx' fails if the file exists: a key must never overwrite another file.
    await writeFile(path, body, { flag: 'wx' });
  }

  async delete(key: string): Promise<void> {
    // force: a missing file is not an error (same as S3 DeleteObject).
    await rm(this.resolveKey(key), { force: true });
  }

  publicUrl(key: string): string {
    return joinPublicUrl(this.publicBaseUrl, key);
  }

  // Keys are built by the server, but never let one escape the uploads folder.
  private resolveKey(key: string): string {
    const root = resolve(this.rootDir);
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) {
      throw new Error(`Storage key is outside the uploads folder: ${key}`);
    }
    return path;
  }
}
