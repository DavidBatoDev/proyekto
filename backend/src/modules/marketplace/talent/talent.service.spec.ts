import { NotFoundException } from '@nestjs/common';
import { TalentService } from './talent.service';
import { REDIS_CACHE_KEYS } from '../../../common/cache/redis-cache.keys';

/**
 * A chainable Supabase stub in the consultants.service.spec.ts style: filters
 * are recorded per call so tests can assert that the eq filters and named
 * allowlists — the actual security boundary on this @Public() admin-client
 * endpoint — are present.
 */
function createDb(options: {
  profile?: Record<string, unknown> | null;
  specializations?: unknown[];
  skills?: unknown[];
  rates?: unknown | null;
  languages?: unknown[];
  experiences?: unknown[];
  portfolios?: unknown[];
}) {
  const calls: { table: string; filters: Record<string, unknown> }[] = [];

  const awaitedRowsFor = (table: string): unknown[] => {
    switch (table) {
      case 'user_specializations':
        return options.specializations ?? [];
      case 'user_skills':
        return options.skills ?? [];
      case 'user_languages':
        return options.languages ?? [];
      case 'user_experiences':
        return options.experiences ?? [];
      case 'user_portfolios':
        return options.portfolios ?? [];
      default:
        return [];
    }
  };

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
      order: jest.fn(() => builder),
      limit: jest.fn(() => builder),
      maybeSingle: jest.fn(() =>
        Promise.resolve({ data: options.rates ?? null, error: null }),
      ),
      single: jest.fn(() =>
        Promise.resolve({ data: options.profile ?? null, error: null }),
      ),
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: awaitedRowsFor(table), error: null }),
    };
    return builder;
  });

  return { db: { from }, calls };
}

function createService(db: unknown) {
  const cache = {
    rememberJson: jest.fn((_key: string, _ttl: number, loader: () => unknown) =>
      Promise.resolve(loader()),
    ),
    getPublicTtlSeconds: jest.fn().mockReturnValue(120),
  };
  const service = new TalentService(
    db as ConstructorParameters<typeof TalentService>[0],
    cache as unknown as ConstructorParameters<typeof TalentService>[1],
  );
  return { service, cache };
}

const activeProfile = () => ({
  id: 'user-1',
  display_name: 'Ada',
  avatar_url: null,
  banner_url: null,
  headline: 'Builds data pipelines',
  bio: null,
  country: 'PH',
  city: 'Rizal',
  created_at: '2026-08-01T00:00:00Z',
  talent_profile: { status: 'active' },
});

describe('TalentService.findOne', () => {
  it('gates on the ACTIVE talent enrollment, not any declared role', async () => {
    const { db, calls } = createDb({ profile: activeProfile() });
    const { service } = createService(db);

    await service.findOne('user-1');

    const profileCall = calls.find((call) => call.table === 'profiles');
    expect(profileCall?.filters['eq:talent_profile.status']).toBe('active');
    expect(profileCall?.filters.columns).toContain(
      'talent_profile:talent_profiles!inner(status)',
    );
  });

  /**
   * Paused talent read identically to non-existent ones here: the inner join
   * drops the row, `.single()` yields null, and the public web sees a 404
   * rather than a "paused" banner.
   */
  it('404s when the enrollment join drops the row (missing or paused)', async () => {
    const { db } = createDb({ profile: null });
    const { service } = createService(db);

    await expect(service.findOne('ghost')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('selects a named allowlist on every table — never *', async () => {
    const { db, calls } = createDb({ profile: activeProfile() });
    const { service } = createService(db);

    await service.findOne('user-1');

    for (const call of calls) {
      expect(call.filters.columns).toBeDefined();
      expect(call.filters.columns).not.toContain('*');
    }
    // The fields that must never leave the authed profile endpoint.
    const profileCall = calls.find((call) => call.table === 'profiles');
    for (const secret of ['email', 'phone', 'date_of_birth', 'zip']) {
      expect(profileCall?.filters.columns).not.toContain(secret);
    }
    const rateCall = calls.find((call) => call.table === 'user_rate_settings');
    expect(rateCall?.filters.columns).not.toContain('min_project_budget');
    expect(rateCall?.filters.columns).not.toContain('weekly_hours');
  });

  it('strips the enrollment embed and flags the listing as open to work', async () => {
    const { db } = createDb({ profile: activeProfile() });
    const { service } = createService(db);

    const result = (await service.findOne('user-1')) as Record<string, unknown>;

    expect(result.talent_profile).toBeUndefined();
    expect(result.is_open_to_work).toBe(true);
    expect(result.display_name).toBe('Ada');
  });

  it('coerces PostgREST numeric strings and unwraps embeds', async () => {
    const { db } = createDb({
      profile: activeProfile(),
      rates: { hourly_rate: '85.50', currency: 'USD', availability: null },
      specializations: [
        {
          id: 'spec-1',
          category: 'Data',
          sub_category: 'Pipelines',
          years_of_experience: '4',
          description: null,
        },
      ],
      // Embed arrives as an array here — cardinality varies by relationship.
      skills: [
        {
          proficiency_level: 'expert',
          years_experience: 6,
          skill: [{ name: 'Python', slug: 'python', category: 'lang' }],
        },
      ],
    });
    const { service } = createService(db);

    const result = (await service.findOne('user-1')) as {
      rates: { hourlyRate: number };
      specializations: { yearsOfExperience: number }[];
      skills: { name: string }[];
    };

    expect(result.rates.hourlyRate).toBe(85.5);
    expect(result.specializations[0].yearsOfExperience).toBe(4);
    expect(result.skills[0].name).toBe('Python');
  });

  it('returns rates as null when no hourly rate is set — never "rate on request"', async () => {
    const { db } = createDb({
      profile: activeProfile(),
      rates: { hourly_rate: null, currency: 'USD', availability: 'available' },
    });
    const { service } = createService(db);

    const result = (await service.findOne('user-1')) as { rates: unknown };

    expect(result.rates).toBeNull();
  });

  it('caches the whole fan-out under the talent profile key', async () => {
    const { db } = createDb({ profile: activeProfile() });
    const { service, cache } = createService(db);

    await service.findOne('user-1');

    expect(cache.rememberJson).toHaveBeenCalledWith(
      REDIS_CACHE_KEYS.talentProfile('user-1'),
      120,
      expect.any(Function),
      expect.anything(),
    );
  });
});
