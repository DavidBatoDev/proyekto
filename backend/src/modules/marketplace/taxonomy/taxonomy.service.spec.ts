import { NotFoundException } from '@nestjs/common';
import { TaxonomyService } from './taxonomy.service';
import { REDIS_CACHE_KEYS } from '../../../common/cache/redis-cache.keys';
import type { TaxonomyRepository } from './repositories/taxonomy.repository.interface';

describe('TaxonomyService', () => {
  const rememberJson = jest.fn();
  const cache = {
    rememberJson,
    getPublicTtlSeconds: jest.fn().mockReturnValue(120),
  };

  const repo: jest.Mocked<TaxonomyRepository> = {
    findNavigation: jest.fn(),
    findCategoryBySlug: jest.fn(),
    findSubcategoryBySlugs: jest.fn(),
    findSubcategoryIds: jest.fn(),
  };

  const service = new TaxonomyService(
    repo,
    cache as unknown as ConstructorParameters<typeof TaxonomyService>[1],
  );

  beforeEach(() => {
    jest.clearAllMocks();
    // Cache passthrough: every test here is about what the service asks for and
    // what it does with the answer, not about Redis.
    rememberJson.mockImplementation(
      (_key: string, _ttl: number, loader: () => unknown) =>
        Promise.resolve(loader()),
    );
  });

  describe('navigation', () => {
    it('wraps the repository result in an items envelope', async () => {
      const categories = [
        { id: 'c1', slug: 'ai-and-data', name: 'AI & Data', subcategories: [] },
      ];
      repo.findNavigation.mockResolvedValue(categories as never);

      await expect(service.navigation()).resolves.toEqual({
        items: categories,
      });
    });

    // The index key is what lets the future admin editor drop every taxonomy
    // entry at once; without it the navigation would go stale for a full TTL
    // after an edit with no way to flush it.
    it('caches under the navigation key with the taxonomy index', async () => {
      repo.findNavigation.mockResolvedValue([]);

      await service.navigation();

      expect(rememberJson).toHaveBeenCalledWith(
        REDIS_CACHE_KEYS.marketplaceTaxonomyNavigation,
        120,
        expect.any(Function),
        expect.objectContaining({
          indexKey: REDIS_CACHE_KEYS.marketplaceTaxonomyIndex,
        }),
      );
    });
  });

  describe('category', () => {
    it('returns the category when it resolves', async () => {
      const category = { id: 'c1', slug: 'ai-and-data', subcategories: [] };
      repo.findCategoryBySlug.mockResolvedValue(category as never);

      await expect(service.category('ai-and-data')).resolves.toBe(category);
    });

    it('throws NotFound for an unknown slug', async () => {
      repo.findCategoryBySlug.mockResolvedValue(null);

      await expect(service.category('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('subcategory', () => {
    it('keys the cache on both slugs', async () => {
      repo.findSubcategoryBySlugs.mockResolvedValue({ id: 's1' } as never);

      await service.subcategory('ai-and-data', 'data-governance');

      expect(rememberJson).toHaveBeenCalledWith(
        REDIS_CACHE_KEYS.marketplaceTaxonomySubcategory(
          'ai-and-data',
          'data-governance',
        ),
        120,
        expect.any(Function),
        expect.objectContaining({
          indexKey: REDIS_CACHE_KEYS.marketplaceTaxonomyIndex,
        }),
      );
    });

    it('throws NotFound when the pair does not resolve', async () => {
      repo.findSubcategoryBySlugs.mockResolvedValue(null);

      await expect(
        service.subcategory('ai-and-data', 'not-a-leaf'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveSubcategoryIds', () => {
    // Deliberately uncached: it feeds the consultant directory, which caches
    // the finished page under its own query hash.
    it('delegates straight to the repository', async () => {
      repo.findSubcategoryIds.mockResolvedValue(['s1', 's2']);

      await expect(
        service.resolveSubcategoryIds('ai-and-data', undefined),
      ).resolves.toEqual(['s1', 's2']);
      expect(rememberJson).not.toHaveBeenCalled();
    });
  });
});
