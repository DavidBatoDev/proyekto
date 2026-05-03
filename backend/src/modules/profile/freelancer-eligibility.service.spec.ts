import { FreelancerEligibilityService } from './freelancer-eligibility.service';

/**
 * Helpers — same thenable pattern as ProjectAuthorizationService spec.
 * Each `from(table)` call dequeues the next response.
 */
function thenable(response: { data?: any; error?: any; count?: number }) {
  const stub: any = {};
  for (const m of ['select', 'eq', 'maybeSingle', 'single']) {
    stub[m] = jest.fn(() => stub);
  }
  stub.then = (onFulfilled: (v: any) => any) =>
    Promise.resolve(response).then(onFulfilled);
  return stub;
}

/**
 * Builds a service whose `from()` returns responses by table name. Each
 * table key may be a single response (used once) or an array (used in
 * order). Lets us script the four parallel lookups eligibility makes.
 */
function buildService(perTable: Record<string, any | any[]>) {
  const queues: Record<string, any[]> = {};
  for (const [table, value] of Object.entries(perTable)) {
    queues[table] = Array.isArray(value) ? [...value] : [value];
  }
  const supabase: any = {
    from: (table: string) => {
      const queue = queues[table];
      if (!queue || queue.length === 0) {
        throw new Error(`No queued response for table: ${table}`);
      }
      return queue.shift();
    },
  };
  return new FreelancerEligibilityService(supabase);
}

const passingResponses = {
  user_identity_documents: thenable({ count: 1, error: null }),
  user_rate_settings: thenable({
    data: { hourly_rate: 80, currency: 'USD', availability: 'available' },
    error: null,
  }),
  user_portfolios: thenable({ count: 2, error: null }),
  profiles: thenable({
    data: {
      headline: 'Senior Engineer',
      bio: 'I build things',
      country: 'PH',
    },
    error: null,
  }),
};

describe('FreelancerEligibilityService.check', () => {
  it('returns eligible=true with empty missing[] when all 4 criteria pass', async () => {
    const service = buildService(passingResponses);
    const result = await service.check('u1');
    expect(result.eligible).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('flags identity when no verified ID document AND no verifications row', async () => {
    const service = buildService({
      user_identity_documents: thenable({ count: 0, error: null }),
      user_verifications: thenable({ count: 0, error: null }),
      user_rate_settings: passingResponses.user_rate_settings,
      user_portfolios: passingResponses.user_portfolios,
      profiles: passingResponses.profiles,
    });
    const result = await service.check('u1');
    expect(result.eligible).toBe(false);
    expect(result.missing).toContain('identity');
  });

  it('passes identity when verifications row marks it verified (fallback path)', async () => {
    const service = buildService({
      user_identity_documents: thenable({ count: 0, error: null }),
      user_verifications: thenable({ count: 1, error: null }),
      user_rate_settings: passingResponses.user_rate_settings,
      user_portfolios: passingResponses.user_portfolios,
      profiles: passingResponses.profiles,
    });
    const result = await service.check('u1');
    expect(result.missing).not.toContain('identity');
  });

  it('flags rate_settings when row is missing', async () => {
    const service = buildService({
      ...passingResponses,
      user_rate_settings: thenable({ data: null, error: null }),
    });
    const result = await service.check('u1');
    expect(result.missing).toContain('rate_settings');
  });

  it('flags rate_settings when hourly_rate is null', async () => {
    const service = buildService({
      ...passingResponses,
      user_rate_settings: thenable({
        data: { hourly_rate: null, currency: 'USD', availability: 'available' },
        error: null,
      }),
    });
    const result = await service.check('u1');
    expect(result.missing).toContain('rate_settings');
  });

  it('flags portfolio when zero items', async () => {
    const service = buildService({
      ...passingResponses,
      user_portfolios: thenable({ count: 0, error: null }),
    });
    const result = await service.check('u1');
    expect(result.missing).toContain('portfolio');
  });

  it('flags profile_basics when bio is empty', async () => {
    const service = buildService({
      ...passingResponses,
      profiles: thenable({
        data: { headline: 'Engineer', bio: '   ', country: 'PH' },
        error: null,
      }),
    });
    const result = await service.check('u1');
    expect(result.missing).toContain('profile_basics');
  });

  it('flags profile_basics when country is missing', async () => {
    const service = buildService({
      ...passingResponses,
      profiles: thenable({
        data: { headline: 'Engineer', bio: 'I build', country: null },
        error: null,
      }),
    });
    const result = await service.check('u1');
    expect(result.missing).toContain('profile_basics');
  });

  it('reports all 4 missing when nothing is filled in', async () => {
    const service = buildService({
      user_identity_documents: thenable({ count: 0, error: null }),
      user_verifications: thenable({ count: 0, error: null }),
      user_rate_settings: thenable({ data: null, error: null }),
      user_portfolios: thenable({ count: 0, error: null }),
      profiles: thenable({ data: null, error: null }),
    });
    const result = await service.check('u1');
    expect(result.eligible).toBe(false);
    expect(result.missing.sort()).toEqual([
      'identity',
      'portfolio',
      'profile_basics',
      'rate_settings',
    ]);
  });
});
