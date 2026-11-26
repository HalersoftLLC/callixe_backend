import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { ListProductsQueryDto } from './list-products-query.dto';
import { UpdateProductDto } from './update-product.dto';

type DtoClass<T> = new () => T;

// Same options as the global ValidationPipe (whitelist + forbidNonWhitelisted).
function validate<T extends object>(cls: DtoClass<T>, body: object) {
  const dto = plainToInstance(cls, body);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, errors };
}

const validCreate = {
  slug: 'heat-wrap',
  name: 'Heat Wrap',
  price: 2500,
};

describe('CreateProductDto', () => {
  it('accepts the minimal valid body', () => {
    expect(validate(CreateProductDto, validCreate).errors).toHaveLength(0);
  });

  it('accepts all optional fields', () => {
    const { errors } = validate(CreateProductDto, {
      ...validCreate,
      compareAtPrice: 3000,
      description: 'Warm and soft',
      badge: 'New',
      secondUnitHalfOff: true,
      active: false,
    });
    expect(errors).toHaveLength(0);
  });

  it('trims text and turns blank description/badge into null', () => {
    const { dto } = validate(CreateProductDto, {
      ...validCreate,
      name: '  Heat Wrap  ',
      description: '   ',
      badge: '',
    });
    expect(dto.name).toBe('Heat Wrap');
    expect(dto.description).toBeNull();
    expect(dto.badge).toBeNull();
  });

  it.each([
    ['a missing slug', { name: 'X', price: 1 }],
    ['an uppercase slug', { ...validCreate, slug: 'Heat-Wrap' }],
    ['a slug with spaces', { ...validCreate, slug: 'heat wrap' }],
    ['a missing name', { slug: 'x', price: 1 }],
    ['a blank name', { ...validCreate, name: '   ' }],
    ['a 201-character name', { ...validCreate, name: 'a'.repeat(201) }],
    ['a missing price', { slug: 'x', name: 'X' }],
    ['a decimal price', { ...validCreate, price: 25.5 }],
    ['a price sent as text', { ...validCreate, price: '2500' }],
    ['a negative price', { ...validCreate, price: -1 }],
    ['a price above the cap', { ...validCreate, price: 10_000_001 }],
    ['a decimal compareAtPrice', { ...validCreate, compareAtPrice: 30.5 }],
    [
      'a 2001-character description',
      { ...validCreate, description: 'a'.repeat(2001) },
    ],
    ['a 51-character badge', { ...validCreate, badge: 'a'.repeat(51) }],
    ['active sent as text', { ...validCreate, active: 'yes' }],
    [
      'secondUnitHalfOff sent as text',
      { ...validCreate, secondUnitHalfOff: 'true' },
    ],
    ['an unknown field', { ...validCreate, id: 5 }],
  ])('rejects %s', (_case, body) => {
    expect(validate(CreateProductDto, body).errors.length).toBeGreaterThan(0);
  });
});

describe('UpdateProductDto', () => {
  it('accepts an empty body (nothing to change)', () => {
    expect(validate(UpdateProductDto, {}).errors).toHaveLength(0);
  });

  it('accepts a single field', () => {
    expect(validate(UpdateProductDto, { price: 100 }).errors).toHaveLength(0);
  });

  it('accepts null to clear nullable fields', () => {
    const { errors } = validate(UpdateProductDto, {
      compareAtPrice: null,
      description: null,
      badge: null,
    });
    expect(errors).toHaveLength(0);
  });

  it.each([
    ['slug (it can never change)', { slug: 'new-slug' }],
    ['null name', { name: null }],
    ['null price', { price: null }],
    ['null active', { active: null }],
    ['null secondUnitHalfOff', { secondUnitHalfOff: null }],
    ['a blank name', { name: '  ' }],
    ['a decimal price', { price: 1.5 }],
    ['an unknown field', { stock: 5 }],
  ])('rejects %s', (_case, body) => {
    expect(validate(UpdateProductDto, body).errors.length).toBeGreaterThan(0);
  });
});

describe('ListProductsQueryDto', () => {
  // Query strings always arrive as text.
  it('applies defaults when nothing is sent', () => {
    const { dto, errors } = validate(ListProductsQueryDto, {});
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 1, limit: 20, sort: '-createdAt' });
    expect(dto.active).toBeUndefined();
    expect(dto.search).toBeUndefined();
  });

  it('converts text values', () => {
    const { dto, errors } = validate(ListProductsQueryDto, {
      page: '2',
      limit: '50',
      active: 'false',
      search: '  pillow ',
      sort: 'price',
    });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({
      page: 2,
      limit: 50,
      active: false,
      search: 'pillow',
      sort: 'price',
    });
  });

  it('treats a blank search as no search', () => {
    expect(validate(ListProductsQueryDto, { search: '  ' }).dto.search).toBe(
      undefined,
    );
  });

  it.each([
    ['page 0', { page: '0' }],
    ['a non-numeric page', { page: 'abc' }],
    ['limit above 100', { limit: '101' }],
    ['limit 0', { limit: '0' }],
    ['active other than true/false', { active: 'yes' }],
    ['an unknown sort', { sort: 'id' }],
    ['a sort with SQL in it', { sort: 'name; DROP TABLE products' }],
    ['a 101-character search', { search: 'a'.repeat(101) }],
    ['an unknown parameter', { stock: '1' }],
  ])('rejects %s', (_case, query) => {
    expect(validate(ListProductsQueryDto, query).errors.length).toBeGreaterThan(
      0,
    );
  });
});
