import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import {
  EnvironmentVariables,
  StorageDriver,
} from '../../config/env.validation';
import { IMAGE_STORAGE, ImageStorage } from './image-storage';
import { LOCAL_UPLOADS_DIR, LocalImageStorage } from './local-image-storage';
import { SpacesImageStorage } from './spaces-image-storage';

// The only place an ImageStorage (and the S3 client) is created
// (CLAUDE.md 8.2). validateEnv has already checked the Spaces variables when
// STORAGE_DRIVER=spaces, so the non-null assertions below are safe.
export const imageStorageProvider: Provider = {
  provide: IMAGE_STORAGE,
  inject: [ConfigService],
  useFactory: (
    config: ConfigService<EnvironmentVariables, true>,
  ): ImageStorage => {
    const publicBaseUrl = config.get('STORAGE_PUBLIC_URL', { infer: true });

    if (config.get('STORAGE_DRIVER', { infer: true }) === StorageDriver.Local) {
      return new LocalImageStorage(LOCAL_UPLOADS_DIR, publicBaseUrl);
    }

    const client = new S3Client({
      endpoint: config.get('SPACES_ENDPOINT', { infer: true })!,
      region: config.get('SPACES_REGION', { infer: true })!,
      credentials: {
        accessKeyId: config.get('SPACES_KEY', { infer: true }),
        secretAccessKey: config.get('SPACES_SECRET', { infer: true }),
      },
      // Recent SDK versions add CRC checksums to every upload by default;
      // only send them when an operation requires it, for S3-compatible
      // services such as Spaces.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    return new SpacesImageStorage(
      client,
      config.get('SPACES_BUCKET', { infer: true }),
      publicBaseUrl,
    );
  },
};
