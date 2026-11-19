import { ParseFilePipe } from '@nestjs/common';
import { MAX_IMAGE_BYTES } from '../products/product-images.service';

// Shared by every admin image upload (product images, Shop page hero).
// Multer stops reading at MAX_IMAGE_BYTES and answers 413, so an oversized
// upload is never fully held in memory. One file per request, few fields.
// Files stay in memory (no disk writes) until the service checks their real
// type and stores them.
export const IMAGE_UPLOAD_OPTIONS = {
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5 },
};

// "file" field is required; type and content are checked by the service
// from the file's bytes, never from the client's mimetype or file name.
export const requiredImageFile = new ParseFilePipe({ fileIsRequired: true });
