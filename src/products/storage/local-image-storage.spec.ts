import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalImageStorage } from './local-image-storage';

// Uses a real temporary folder: the point is to check actual file behaviour.
describe('LocalImageStorage', () => {
  let root: string;
  let storage: LocalImageStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'image-storage-'));
    storage = new LocalImageStorage(root, 'http://localhost:3000/uploads');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes the file under its key, creating folders', async () => {
    await storage.put('test/products/a/1.png', Buffer.from('png'), 'image/png');

    await expect(
      readFile(join(root, 'test/products/a/1.png'), 'utf8'),
    ).resolves.toBe('png');
  });

  it('never overwrites an existing file', async () => {
    await storage.put('k/1.png', Buffer.from('first'), 'image/png');

    await expect(
      storage.put('k/1.png', Buffer.from('second'), 'image/png'),
    ).rejects.toThrow();
    await expect(readFile(join(root, 'k/1.png'), 'utf8')).resolves.toBe(
      'first',
    );
  });

  it('deletes a file', async () => {
    await storage.put('k/1.png', Buffer.from('x'), 'image/png');
    await storage.delete('k/1.png');

    await expect(stat(join(root, 'k/1.png'))).rejects.toThrow();
  });

  it('treats deleting a missing file as success', async () => {
    await expect(storage.delete('k/missing.png')).resolves.toBeUndefined();
  });

  it.each(['../outside.png', 'k/../../outside.png', '/etc/passwd'])(
    'refuses a key that escapes the uploads folder: %s',
    async (key) => {
      await expect(
        storage.put(key, Buffer.from('x'), 'image/png'),
      ).rejects.toThrow('outside the uploads folder');
      await expect(storage.delete(key)).rejects.toThrow(
        'outside the uploads folder',
      );
    },
  );

  it('builds the public URL from the base URL and key', () => {
    expect(storage.publicUrl('development/products/a/1.png')).toBe(
      'http://localhost:3000/uploads/development/products/a/1.png',
    );
  });
});
