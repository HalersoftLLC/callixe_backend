// Detects the real image type from the file's first bytes ("magic numbers").
// The browser's mimetype and the file name are client input and can lie
// (e.g. an HTML file renamed to .jpg), so they are never used.
// SVG is deliberately not supported: it can contain scripts.

export const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type ImageContentType = keyof typeof IMAGE_TYPES;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buffer: Buffer, bytes: number[], offset = 0): boolean {
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

export function detectImageType(buffer: Buffer): ImageContentType | null {
  if (buffer.length >= 3 && startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (buffer.length >= 8 && startsWith(buffer, PNG_SIGNATURE)) {
    return 'image/png';
  }
  // "RIFF" <4-byte size> "WEBP"
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
