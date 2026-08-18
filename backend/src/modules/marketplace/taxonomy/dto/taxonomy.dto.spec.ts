import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CategorySlugParamDto, SubcategorySlugParamDto } from './taxonomy.dto';

const errorsFor = <T extends object>(cls: new () => T, payload: object) =>
  validateSync(plainToInstance(cls, payload));

describe('CategorySlugParamDto', () => {
  it('accepts a well-formed slug', () => {
    expect(
      errorsFor(CategorySlugParamDto, { categorySlug: 'ai-and-data' }),
    ).toHaveLength(0);
  });

  it('accepts digits inside a segment', () => {
    expect(
      errorsFor(CategorySlugParamDto, { categorySlug: 'b2b-saas' }),
    ).toHaveLength(0);
  });

  // The pattern is a security control, not a style preference: these values
  // become part of a Redis cache key and a PostgREST filter.
  it.each([
    ['uppercase', 'AI-And-Data'],
    ['path traversal', '../etc'],
    ['encoded traversal', '%2e%2e'],
    ['doubled hyphen', 'ai--data'],
    ['leading hyphen', '-ai'],
    ['trailing hyphen', 'ai-'],
    ['underscore', 'ai_data'],
    ['space', 'ai data'],
    ['empty', ''],
  ])('rejects %s', (_label, slug) => {
    expect(
      errorsFor(CategorySlugParamDto, { categorySlug: slug }).length,
    ).toBeGreaterThan(0);
  });

  it('rejects a slug longer than 80 characters', () => {
    expect(
      errorsFor(CategorySlugParamDto, { categorySlug: 'a'.repeat(81) }).length,
    ).toBeGreaterThan(0);
  });
});

describe('SubcategorySlugParamDto', () => {
  it('accepts both segments', () => {
    expect(
      errorsFor(SubcategorySlugParamDto, {
        categorySlug: 'ai-and-data',
        subcategorySlug: 'llm-application-development',
      }),
    ).toHaveLength(0);
  });

  it('still validates the inherited category slug', () => {
    const errors = errorsFor(SubcategorySlugParamDto, {
      categorySlug: '../etc',
      subcategorySlug: 'data-governance',
    });
    expect(errors.map((error) => error.property)).toContain('categorySlug');
  });

  it('rejects a bad sub-category slug', () => {
    const errors = errorsFor(SubcategorySlugParamDto, {
      categorySlug: 'ai-and-data',
      subcategorySlug: 'Data Governance',
    });
    expect(errors.map((error) => error.property)).toContain('subcategorySlug');
  });
});
