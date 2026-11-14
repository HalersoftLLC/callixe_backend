import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { SpacesImageStorage } from './spaces-image-storage';

// The S3 client is mocked: tests never call DigitalOcean.
describe('SpacesImageStorage', () => {
  const send = jest.fn();
  const storage = new SpacesImageStorage(
    { send } as unknown as S3Client,
    'my-bucket',
    'https://my-bucket.fra1.cdn.digitaloceanspaces.com',
  );

  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({});
  });

  it('uploads a public, long-cached object with the detected content type', async () => {
    const body = Buffer.from('png');
    await storage.put('production/products/a/1.png', body, 'image/png');

    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'my-bucket',
      Key: 'production/products/a/1.png',
      Body: body,
      ContentType: 'image/png',
      CacheControl: 'public, max-age=31536000, immutable',
      ACL: 'public-read',
    });
  });

  it('deletes an object by key', async () => {
    await storage.delete('production/products/a/1.png');

    const command = send.mock.calls[0][0] as DeleteObjectCommand;
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'my-bucket',
      Key: 'production/products/a/1.png',
    });
  });

  it('passes storage errors to the caller', async () => {
    send.mockRejectedValue(new Error('AccessDenied'));

    await expect(
      storage.put('k/1.png', Buffer.from('x'), 'image/png'),
    ).rejects.toThrow('AccessDenied');
  });

  it('builds the CDN URL', () => {
    expect(storage.publicUrl('production/products/a/1.png')).toBe(
      'https://my-bucket.fra1.cdn.digitaloceanspaces.com/production/products/a/1.png',
    );
  });
});
