import { ConsultantEligibilityService } from './consultant-eligibility.service';

/** Same thenable-queue pattern as talent-eligibility.service.spec.ts. */
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
 * `from(table)` dequeues scripted responses per table. Note that
 * consultant_applications is queried twice per check (placements embed, then
 * linkedin_url), so its queue holds two entries in that order.
 */
function buildService(perTable: Record<string, any>) {
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
  return new ConsultantEligibilityService(supabase);
}

const passingResponses = () => ({
  profiles: thenable({
    data: { headline: 'Delivery lead', bio: 'I ship things', country: 'PH' },
    error: null,
  }),
  consultant_applications: [
    thenable({
      data: {
        id: 'app-1',
        placements: [{ subcategory_id: 'sub-1', years_experience: 5 }],
      },
      error: null,
    }),
    thenable({
      data: { linkedin_url: 'https://linkedin.com/in/lead' },
      error: null,
    }),
  ],
  user_portfolios: thenable({ count: 1, error: null }),
  user_rate_settings: thenable({
    data: { hourly_rate: 120, currency: 'USD', availability: 'available' },
    error: null,
  }),
  user_identity_documents: thenable({ count: 1, error: null }),
});

describe('ConsultantEligibilityService.check', () => {
  it('returns eligible with empty missing[] when all 5 requirements pass', async () => {
    const service = buildService(passingResponses());
    const result = await service.check('u1');
    expect(result.eligible).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('flags profile_basics when bio is blank', async () => {
    const service = buildService({
      ...passingResponses(),
      profiles: thenable({
        data: { headline: 'Lead', bio: '   ', country: 'PH' },
        error: null,
      }),
    });
    const result = await service.check('u1');
    expect(result.missing).toContain('profile_basics');
  });

  it('flags expertise_placement when the application has no placements', async () => {
    const responses = passingResponses();
    responses.consultant_applications[0] = thenable({
      data: { id: 'app-1', placements: [] },
      error: null,
    });
    const service = buildService(responses);
    const result = await service.check('u1');
    expect(result.missing).toContain('expertise_placement');
  });

  it('flags expertise_placement when any pick lacks years_experience', async () => {
    const responses = passingResponses();
    responses.consultant_applications[0] = thenable({
      data: {
        id: 'app-1',
        placements: [
          { subcategory_id: 'sub-1', years_experience: 5 },
          { subcategory_id: 'sub-2', years_experience: null },
        ],
      },
      error: null,
    });
    const service = buildService(responses);
    const result = await service.check('u1');
    expect(result.missing).toContain('expertise_placement');
  });

  it('accepts years_experience of 0 (the <1yr bucket) as answered', async () => {
    const responses = passingResponses();
    responses.consultant_applications[0] = thenable({
      data: {
        id: 'app-1',
        placements: [{ subcategory_id: 'sub-1', years_experience: 0 }],
      },
      error: null,
    });
    const service = buildService(responses);
    const result = await service.check('u1');
    expect(result.missing).not.toContain('expertise_placement');
  });

  it('flags expertise_placement when no application row exists yet', async () => {
    const responses = passingResponses();
    responses.consultant_applications[0] = thenable({
      data: null,
      error: null,
    });
    const service = buildService(responses);
    const result = await service.check('u1');
    expect(result.missing).toContain('expertise_placement');
  });

  it('flags work_links when linkedin_url is missing even with portfolios', async () => {
    const responses = passingResponses();
    responses.consultant_applications[1] = thenable({
      data: { linkedin_url: null },
      error: null,
    });
    const service = buildService(responses);
    const result = await service.check('u1');
    expect(result.missing).toContain('work_links');
  });

  it('flags work_links when there are no portfolio items', async () => {
    const service = buildService({
      ...passingResponses(),
      user_portfolios: thenable({ count: 0, error: null }),
    });
    const result = await service.check('u1');
    expect(result.missing).toContain('work_links');
  });

  it('flags rate_settings when hourly_rate is null', async () => {
    const service = buildService({
      ...passingResponses(),
      user_rate_settings: thenable({
        data: { hourly_rate: null, currency: 'USD', availability: 'available' },
        error: null,
      }),
    });
    const result = await service.check('u1');
    expect(result.missing).toContain('rate_settings');
  });

  it('flags identity_document when none is uploaded', async () => {
    const service = buildService({
      ...passingResponses(),
      user_identity_documents: thenable({ count: 0, error: null }),
    });
    const result = await service.check('u1');
    expect(result.missing).toContain('identity_document');
  });

  it('fails closed: a query error marks that requirement missing', async () => {
    const service = buildService({
      ...passingResponses(),
      user_identity_documents: thenable({
        count: null as any,
        error: { message: 'boom' },
      }),
    });
    const result = await service.check('u1');
    expect(result.eligible).toBe(false);
    expect(result.missing).toContain('identity_document');
  });

  it('reports all 5 missing when nothing is filled in', async () => {
    const service = buildService({
      profiles: thenable({ data: null, error: null }),
      consultant_applications: [
        thenable({ data: null, error: null }),
        thenable({ data: null, error: null }),
      ],
      user_portfolios: thenable({ count: 0, error: null }),
      user_rate_settings: thenable({ data: null, error: null }),
      user_identity_documents: thenable({ count: 0, error: null }),
    });
    const result = await service.check('u1');
    expect(result.eligible).toBe(false);
    expect(result.missing.sort()).toEqual([
      'expertise_placement',
      'identity_document',
      'profile_basics',
      'rate_settings',
      'work_links',
    ]);
  });
});
