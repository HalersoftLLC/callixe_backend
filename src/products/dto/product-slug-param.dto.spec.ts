import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ProductSlugParamDto } from './product-slug-param.dto';

function errorsFor(slug: unknown) {
  return validateSync(plainToInstance(ProductSlugParamDto, { slug }));
}

describe('ProductSlugParamDto', () => {
  it.each(['neck-pillow-2-0', 'heat-wrap', 'abc', 'a1'])(
    'accepts "%s"',
    (slug) => {
      expect(errorsFor(slug)).toHaveLength(0);
    },
  );

  it.each([
    'Neck-Pillow',
    'neck_pillow',
    'neck pillow',
    '-neck',
    'neck-',
    'neck--pillow',
    "x' OR '1'='1",
    '',
  ])('rejects "%s"', (slug) => {
    expect(errorsFor(slug).length).toBeGreaterThan(0);
  });

  it('rejects slugs longer than 100 characters', () => {
    expect(errorsFor('a'.repeat(101)).length).toBeGreaterThan(0);
  });
});
