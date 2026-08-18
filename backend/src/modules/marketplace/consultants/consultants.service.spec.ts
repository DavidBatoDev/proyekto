import { NotFoundException } from '@nestjs/common';
import { ConsultantsService } from './consultants.service';
import { REDIS_CACHE_KEYS } from '../../../common/cache/redis-cache.keys';
import { ConsultantDirectoryQueryDto } from './dto/consultants.dto';

/**
 * A chainable Supabase query stub. `resolve` decides what the terminal call
 * (`range`) settles with; `membershipRows` feeds the consultant_subcategories
 * lookup so the dedupe path can be exercised.
 */
/**
 * What a bare `await builder` yields per table, for the reads that have no
 * terminal call.
 */
function awaitedRowsFor(
  table: string,
  options: {
    membershipRows?: { user_id: string }[];
    services?: unknown[];
    skills?: unknown[];
    templates?: unknown[];
  },
): unknown[] {
  switch (table) {
    case 'consultant_subcategories':
      return options.membershipRows ?? [];
    case 'consultant_services':
      return options.services ?? [];
    case 'user_skills':
      return options.skills ?? [];
    case 'roadmap_public_templates':
      return options.templates ?? [];
    default:
      return [];
  }
}

function createDb(options: {
  profiles?: { data: unknown[]; count: number };
  membershipRows?: { user_id: string }[];
  /**
   * Rows for the tables the detail endpoint fans out to. Each defaults to
   * empty, so a test that does not care about them reads as "this consultant
   * has published nothing", which is the common case.
   */
  services?: unknown[];
  skills?: unknown[];
  rates?: unknown | null;
  templates?: unknown[];
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
      not: jest.fn(() => builder),
      limit: jest.fn(() => builder),
      maybeSingle: jest.fn(() =>
        Promise.resolve({ data: options.rates ?? null, error: null }),
      ),
      single: jest.fn(() =>
        Promise.resolve({
          data: (options.profiles?.data ?? [])[0] ?? null,
          error: null,
        }),
      ),
      range: jest.fn(() =>
        Promise.resolve({
          data: options.profiles?.data ?? [],
          count: options.profiles?.count ?? 0,
          error: null,
        }),
      ),
      // Awaiting the builder itself is how PostgREST reads without a terminal
      // call. The fan-out tables all read this way.
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: awaitedRowsFor(table, options), error: null }),
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

/**
 * `findOne` walks a different shape to `directory`: a `.single()` on profiles
 * plus an awaited builder on consultant_subcategories with no terminal call, so
 * it gets its own stub rather than bending the one above.
 */
function createProfileDb(options: {
  profile?: unknown;
  expertiseRows?: unknown[];
  // The rest of the detail fan-out. Default empty, so a test that only cares
  // about expertise reads as "this consultant has published nothing else".
  serviceRows?: unknown[];
  skillRows?: unknown[];
  rateRow?: unknown | null;
  templateRows?: unknown[];
}) {
  const selects: Record<string, string> = {};
  const filters: Record<string, string[]> = {};

  const from = jest.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: jest.fn((columns: string) => {
        selects[table] = columns;
        return builder;
      }),
      eq: jest.fn((column: string, value: unknown) => {
        (filters[table] ??= []).push(`${column}=${String(value)}`);
        return builder;
      }),
      order: jest.fn(() => builder),
      not: jest.fn(() => builder),
      limit: jest.fn(() =>
        Promise.resolve({ data: options.templateRows ?? [], error: null }),
      ),
      maybeSingle: jest.fn(() =>
        Promise.resolve({ data: options.rateRow ?? null, error: null }),
      ),
      single: jest.fn(() =>
        Promise.resolve({ data: options.profile ?? null, error: null }),
      ),
    };

    // `consultant_services` and `user_skills` have no terminal call — the
    // builder itself is awaited — so they resolve through `then`.
    if (table === 'consultant_services') {
      builder.order = jest.fn(() =>
        Promise.resolve({ data: options.serviceRows ?? [], error: null }),
      );
    }
    if (table === 'user_skills') {
      builder.eq = jest.fn(() =>
        Promise.resolve({ data: options.skillRows ?? [], error: null }),
      );
    }

    if (table === 'consultant_subcategories') {
      const result = { data: options.expertiseRows ?? [], error: null };
      // The second `order` is the last call, so that is what gets awaited.
      let orderCalls = 0;
      builder.order = jest.fn(() => {
        orderCalls += 1;
        return orderCalls >= 2 ? Promise.resolve(result) : builder;
      });
    }

    return builder;
  });

  return { db: { from }, selects, filters };
}

const VERIFIED_PROFILE = {
  id: 'c1',
  display_name: 'August Teleg',
  consultant_profile: { status: 'verified', verified_at: '2026-08-17T22:51:31Z' },
};

describe('ConsultantsService.findOne', () => {
  it('surfaces the verification date the enrolment embed carries', async () => {
    // attachMarketplaceEnrollmentFields deletes the whole embed once it has the
    // capability flags, so verified_at has to be lifted before it goes.
    const { db } = createProfileDb({ profile: VERIFIED_PROFILE });
    const { service } = createService(db, {
      resolveSubcategoryIds: jest.fn(),
    });

    const result = (await service.findOne('c1')) as Record<string, unknown>;

    expect(result.consultant_verified_at).toBe('2026-08-17T22:51:31Z');
    expect(result.is_consultant_verified).toBe(true);
    expect(result.consultant_profile).toBeUndefined();
  });

  it('flattens the expertise embed into category and sub-category pairs', async () => {
    const { db } = createProfileDb({
      profile: VERIFIED_PROFILE,
      expertiseRows: [
        {
          is_primary: true,
          subcategory: {
            slug: 'llm-application-development',
            name: 'LLM Application Development',
            category: { slug: 'ai-and-data', name: 'AI & Data' },
          },
        },
      ],
    });
    const { service } = createService(db, {
      resolveSubcategoryIds: jest.fn(),
    });

    const result = (await service.findOne('c1')) as Record<string, unknown>;

    expect(result.expertise).toEqual([
      {
        categorySlug: 'ai-and-data',
        categoryName: 'AI & Data',
        subcategorySlug: 'llm-application-development',
        subcategoryName: 'LLM Application Development',
        isPrimary: true,
      },
    ]);
  });

  it('drops a row whose category embed came back empty', async () => {
    // The is_active filters narrow the embed rather than dropping the parent
    // row, so a de-activated branch arrives as null and must not become a chip
    // pointing at a category page that no longer exists.
    const { db } = createProfileDb({
      profile: VERIFIED_PROFILE,
      expertiseRows: [
        { is_primary: false, subcategory: { slug: 's', name: 'S', category: null } },
        { is_primary: false, subcategory: null },
      ],
    });
    const { service } = createService(db, {
      resolveSubcategoryIds: jest.fn(),
    });

    const result = (await service.findOne('c1')) as Record<string, unknown>;

    expect(result.expertise).toEqual([]);
  });

  it('refuses a profile that is not a verified consultant', async () => {
    const { db } = createProfileDb({ profile: null });
    const { service } = createService(db, {
      resolveSubcategoryIds: jest.fn(),
    });

    await expect(service.findOne('nobody')).rejects.toThrow(NotFoundException);
  });
});

describe('ConsultantsService.findOne fan-out', () => {
  const verifiedProfile = {
    id: 'c1',
    display_name: 'Ada',
    consultant_profile: { status: 'verified', verified_at: '2026-08-01T00:00:00Z' },
  };

  /**
   * This client runs as SUPABASE_ADMIN and bypasses RLS, so the filters in the
   * service ARE the boundary. A draft is the consultant's private working
   * state — an unpublished price leaking would be the whole point of the
   * status column defeated.
   */
  it('asks for published services only, in author order', async () => {
    const { db, selects, filters } = createProfileDb({
      profile: verifiedProfile,
      serviceRows: [
        {
          id: 's1',
          title: 'Audit',
          description: null,
          cover_url: null,
          starting_price: '50.00',
          currency: 'USD',
          price_unit: 'project',
          delivery_days: 7,
        },
      ],
    });
    const { service } = createService(db, {
      resolveSubcategoryIds: jest.fn(),
    });

    const result = (await service.findOne('c1')) as {
      services: Array<{ starting_price: number | null }>;
    };

    expect(filters['consultant_services']).toContain('status=published');
    expect(selects['consultant_services']).not.toContain('*');
    // numeric(12,2) arrives as a string; the API must not hand that to the browser.
    expect(result.services[0].starting_price).toBe(50);
  });

  it('returns no rate rather than a placeholder when none is set', async () => {
    const { db } = createProfileDb({ profile: verifiedProfile, rateRow: null });
    const { service } = createService(db, {
      resolveSubcategoryIds: jest.fn(),
    });

    const result = (await service.findOne('c1')) as { rates: unknown };

    expect(result.rates).toBeNull();
  });

  /**
   * A row can exist with every other field set and no hourly rate. Rendering
   * that as a rate of nothing would be a claim the consultant did not make.
   */
  it('returns no rate when the row exists but the hourly rate is blank', async () => {
    const { db } = createProfileDb({
      profile: verifiedProfile,
      rateRow: { hourly_rate: null, currency: 'USD', availability: 'available' },
    });
    const { service } = createService(db, {
      resolveSubcategoryIds: jest.fn(),
    });

    const result = (await service.findOne('c1')) as { rates: unknown };

    expect(result.rates).toBeNull();
  });

  it('drops a skill whose master row came back empty', async () => {
    const { db } = createProfileDb({
      profile: verifiedProfile,
      skillRows: [
        { proficiency_level: 'expert', years_experience: 5, skill: null },
        {
          proficiency_level: 'expert',
          years_experience: 5,
          skill: { name: 'SEO', slug: 'seo', category: 'Marketing' },
        },
      ],
    });
    const { service } = createService(db, {
      resolveSubcategoryIds: jest.fn(),
    });

    const result = (await service.findOne('c1')) as {
      skills: Array<{ slug: string }>;
    };

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].slug).toBe('seo');
  });
});

