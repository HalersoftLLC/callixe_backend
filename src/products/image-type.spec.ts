import { detectImageType } from './image-type';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'ascii'),
]);

describe('detectImageType', () => {
  it.each([
    ['JPEG', JPEG, 'image/jpeg'],
    ['PNG', PNG, 'image/png'],
    ['WebP', WEBP, 'image/webp'],
  ])('detects %s from its bytes', (_name, buffer, expected) => {
    expect(detectImageType(buffer)).toBe(expected);
  });

  it.each([
    ['GIF', Buffer.from('GIF89a......', 'ascii')],
    [
      'SVG (can contain scripts)',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
    ],
    [
      'HTML renamed to .jpg',
      Buffer.from('<!doctype html><script>alert(1)</script>'),
    ],
    ['PDF', Buffer.from('%PDF-1.7 ...', 'ascii')],
    ['an empty file', Buffer.alloc(0)],
    ['a truncated PNG header', PNG.subarray(0, 4)],
    [
      'RIFF that is not WebP (WAV)',
      Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1'),
    ],
  ])('rejects %s', (_name, buffer) => {
    expect(detectImageType(buffer)).toBeNull();
  });
});
