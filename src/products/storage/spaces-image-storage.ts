import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  IMMUTABLE_CACHE_CONTROL,
  ImageStorage,
  joinPublicUrl,
} from './image-storage';

// DigitalOcean Spaces (S3-compatible). Objects are public-read one by one;
// the bucket itself stays private (no file listing).
// Docs: https://docs.digitalocean.com/products/spaces/how-to/use-aws-sdks/
export class SpacesImageStorage implements ImageStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly publicBaseUrl: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: IMMUTABLE_CACHE_CONTROL,
        ACL: 'public-read',
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  publicUrl(key: string): string {
    return joinPublicUrl(this.publicBaseUrl, key);
  }
}
