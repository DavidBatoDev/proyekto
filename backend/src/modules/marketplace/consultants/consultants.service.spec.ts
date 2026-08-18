import { NotFoundException } from '@nestjs/common';
import { ConsultantsService } from './consultants.service';
import { REDIS_CACHE_KEYS } from '../../../common/cache/redis-cache.keys';
import { ConsultantDirectoryQueryDto } from './dto/consultants.dto';

/**
 * A chainable Supabase query stub. `resolve` decides what the terminal call
 * (`range`) settles with; `membershipRows` feeds the consultant_subcategories
 * lookup so the dedupe path can be exercised.
 */
function createDb(options: {
  profiles?: { data: unknown[]; count: number };
  membershipRows?: { user_id: string }[];
}) {
  const calls: { table: string; filters: Record<string, unknown> }[] = [];

  const from = jest.fn((table: string) => {
    const filters: Record<string, unknown> = {};
    calls.push({ table, filters });

    const builder: Record<string, unknown> = {
      select: jest.fn((columns: string) => {
        filters.columns = columns;
        return builder;
      }),
      eq: jest.fn((column: string, value: unknown) => {
        filters[`eq:${column}`] = value;
        return builder;
      }),
      in: jest.fn((column: string, values: unknown[]) => {
        filters[`in:${column}`] = values;
        return builder;
      }),
      order: jest.fn(() => builder),
      range: jest.fn(() =>
        Promise.resolve({
          data: options.profiles?.data ?? [],
          count: options.profiles?.count ?? 0,
          error: null,
        }),
      ),
    };

    if (table === 'consultant_subcategories') {
      // This table's read has no terminal call - the builder itself is awaited.
      const result = {
        data: options.membershipRows ?? [],
        error: null,
      };
      builder.in = jest.fn((column: string, values: unknown[]) => {
        filters[`in:${column}`] = values;
        return Promise.resolve(result);
      });
    }

    return builder;
  });

  return { db: { from }, calls };
}

function createService(
  db: unknown,
  taxonomy: { resolveSubcategoryIds: jest.Mock },
) {
  const cache = {
    rememberJson: jest.fn((_key: string, _ttl: number, loader: () => unknown) =>
      Promise.resolve(loader()),
    ),
    getPublicTtlSeconds: jest.fn().mockReturnValue(120),
  };
  const service = new ConsultantsService(
    db as ConstructorParameters<typeof ConsultantsService>[0],
    cache as unknown as ConstructorParameters<typeof ConsultantsService>[1],
    taxonomy as unknown as ConstructorParameters<typeof ConsultantsService>[2],
  );
  return { service, cache };
}

const query = (
  overrides: Partial<ConsultantDirectoryQueryDto> = {},
): ConsultantDirectoryQueryDto =>
  Object.assign(new ConsultantDirectoryQueryDto(), {
    limit: 24,
    offset: 0,
    ...overrides,
  });

describe('ConsultantsService.directory', () => {
  it('gates on verified enrolment rather than any declared role', async () => {
    const { db, calls } = createDb({ profiles: { data: [], count: 0 } });
    const { service } = createService(db, {
      resolveSubcategoryIds: jest.fn(),
    });

    await service.directory(query());

    const profileCall = calls.find((call) => call.table === 'profiles');
    expect(profileCall?.filters['eq:consultant_profile.status']).toBe(
      'verified',
    );
  });

  it('skips the membership lookup entirely when unfiltered', async () => {
    const { db, calls } = createDb({ profiles: { data: [], count: 0 } });
    const resolveSubcategoryIds = jest.fn();
    const { service } = createService(db, { resolveSubcategoryIds });

    await service.directory(query());

    expect(resolveSubcategoryIds).not.toHaveBeenCalled();
    expect(calls.some((c) => c.table === 'consultant_subcategories')).toBe(
      false,
    );
  });

  // The reason the filter is two steps instead of one inner join: PostgREST has
  // no DISTINCT, so a consultant listed under two sub-categories of the same
  // category would otherwise appear twice on that category's page.
  it('dedupes a consultant who sits in two sub-categories', async () => {
    const { db, calls } = createDb({
      profiles: { data: [{ id: 'user-1' }], count: 1 },
      membershipRows: [{ user_id: 'user-1' }, { user_id: 'user-1' }],
    });
    const { service } = createService(db, {
      resolveSubcategoryIds: jest.fn().mockResolvedValue(['sub-1', 'sub-2']),
    });

    const result = await service.directory(query({ category: 'ai-and-data' }));

    const profileCall = calls.find((call) => call.table === 'profiles');
    expect(profileCall?.filters['in:id']).toEqual(['user-1']);
    expect(result.total).toBe(1);
  });

  it('returns an empty page without querying profiles when nobody matches', async () => {
    const { db, calls } = createDb({
      profiles: { data: [{ id: 'user-1' }], count: 1 },
      membershipRows: [],
    });
    const { service } = createService(db, {
      resolveSubcategoryIds: jest.fn().mockResolvedValue(['sub-1']),
    });

    const result = await service.directory(
      query({ category: 'ai-and-data', limit: 24, offset: 0 }),
    );

    expect(result).toEqual({ items: [], total: 0, limit: 24, offset: 0 });
    expect(calls.some((call) => call.table === 'profiles')).toBe(false);
  });

  it('throws NotFound when the category slug does not resolve', async () => {
    const { db } = createDb({});
    const { service } = createService(db, {
      resolveSubcategoryIds: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.directory(query({ category: 'no-such-category' })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the pagination envelope the category pages page through', async () => {
    const { db } = createDb({
      profiles: { data: [{ id: 'user-1' }], count: 7 },
    });
    const { service } = createService(db, {
      resolveSubcategoryIds: jest.fn(),
    });

    const result = await service.directory(query({ limit: 5, offset: 5 }));

    expect(result).toMatchObject({ total: 7, limit: 5, offset: 5 });
    expect(result.items).toHaveLength(1);
  });

  // Without the index key these entries could never be flushed, so approving a
  // consultant would leave every category page stale for a full TTL.
  it('caches under the consultants index so invalidation can reach it', async () => {
    const { db } = createDb({ profiles: { data: [], count: 0 } });
    const { service, cache } = createService(db, {
      resolveSubcategoryIds: jest.fn(),
    });

    await service.directory(query());

    expect(cache.rememberJson).toHaveBeenCalledWith(
      expect.stringContaining('cache:v1:consultants:directory:'),
      120,
      expect.any(Function),
      expect.objectContaining({
        indexKey: REDIS_CACHE_KEYS.consultantsIndex,
      }),
    );
  });

  it('keys different filters separately and identical filters together', async () => {
    const { db } = createDb({ profiles: { data: [], count: 0 } });
    const { service, cache } = createService(db, {
      resolveSubcategoryIds: jest.fn().mockResolvedValue(['sub-1']),
    });

    await service.directory(query());
    await service.directory(query({ category: 'ai-and-data' }));
    await service.directory(query());

    const keys = cache.rememberJson.mock.calls.map((call) => call[0]);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toBe(keys[2]);
  });
});
