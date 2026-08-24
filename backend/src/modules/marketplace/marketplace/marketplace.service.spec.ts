import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';

function dependencies(
  supabase: unknown,
  eligibilityResult: { eligible: boolean; missing: string[] } = {
    eligible: true,
    missing: [],
  },
) {
  const notifications = { createNotification: jest.fn().mockResolvedValue({}) };
  const authorization = { assertRole: jest.fn().mockResolvedValue(undefined) };
  const cache = {
    getAuthTtlSeconds: jest.fn().mockReturnValue(45),
    getMarketplaceIndexTtlSeconds: jest.fn().mockReturnValue(90),
    rememberJson: jest.fn(
      (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
    ),
  };
  const cacheInvalidation = {
    invalidateDiscoveryCaches: jest.fn().mockResolvedValue(undefined),
    invalidateAllDashboardCache: jest.fn().mockResolvedValue(undefined),
  };
  const eligibility = {
    check: jest.fn().mockResolvedValue(eligibilityResult),
  };
  return {
    service: new MarketplaceService(
      supabase as never,
      notifications as never,
      authorization as never,
      cache as never,
      cacheInvalidation as never,
      eligibility as never,
    ),
    notifications,
    authorization,
    cacheInvalidation,
    eligibility,
  };
}

describe('MarketplaceService talent enrollment', () => {
  it('rejects go-live with a structured missing-requirements response', async () => {
    const supabase = { from: jest.fn() };
    const { service } = dependencies(supabase, {
      eligible: false,
      missing: ['profile_basics', 'portfolio'],
    });

    await expect(service.goLive('user-1')).rejects.toMatchObject({
      response: {
        message: 'Complete your talent profile before going live.',
        missing: ['profile_basics', 'portfolio'],
      },
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('upserts an active enrollment and preserves the OTA response fields', async () => {
    const builder = {
      upsert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { status: 'active' },
        error: null,
      }),
    };
    const { service, cacheInvalidation } = dependencies({
      from: () => builder,
    });

    await expect(service.goLive('user-1')).resolves.toEqual({
      is_public: true,
      status: 'active',
    });
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        status: 'active',
        paused_at: null,
      }),
      { onConflict: 'user_id' },
    );
    expect(cacheInvalidation.invalidateDiscoveryCaches).toHaveBeenCalledWith(
      'user-1',
    );
  });

  it('returns 404 when pausing a profile that is not active', async () => {
    const builder = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    const { service } = dependencies({ from: () => builder });

    await expect(service.pause('user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('transitions active to paused without deleting the enrollment row', async () => {
    const builder = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { status: 'paused' },
        error: null,
      }),
    };
    const { service } = dependencies({ from: () => builder });

    await expect(service.pause('user-1')).resolves.toEqual({
      is_public: false,
      status: 'paused',
    });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'paused' }),
    );
  });

  it('blocks invites to paused talent', async () => {
    const consultantBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ count: 1, error: null }).then(resolve),
    };
    const projectBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest
        .fn()
        .mockResolvedValue({ data: { id: 'project-1' }, error: null }),
    };
    const talentBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    const { service, authorization } = dependencies({
      from: (table: string) => {
        if (table === 'consultant_profiles') return consultantBuilder;
        if (table === 'projects') return projectBuilder;
        if (table === 'talent_profiles') return talentBuilder;
        throw new Error(`Unexpected table: ${table}`);
      },
    });

    await expect(
      service.inviteTalent('consultant-1', {
        projectId: 'project-1',
        inviteeId: 'talent-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(authorization.assertRole).toHaveBeenCalledWith(
      'consultant-1',
      'project-1',
      'admin',
    );
    expect(talentBuilder.eq).toHaveBeenCalledWith('status', 'active');
  });

  it('uses an inner active-enrollment join for the browse pool', async () => {
    const consultantBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ count: 1, error: null }).then(resolve),
    };
    const profilesBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    const { service } = dependencies({
      from: (table: string) =>
        table === 'consultant_profiles' ? consultantBuilder : profilesBuilder,
    });

    await expect(service.getTalent('consultant-1', {})).resolves.toEqual([]);
    expect(profilesBuilder.select).toHaveBeenCalledWith(
      expect.stringContaining('talent_profiles!inner'),
    );
    expect(profilesBuilder.eq).toHaveBeenCalledWith(
      'talent_profile.status',
      'active',
    );
  });

  it('maps the many-to-one skill join object onto the talent cards', async () => {
    const consultantBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ count: 1, error: null }).then(resolve),
    };
    const profilesBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: [
            {
              id: 'talent-1',
              display_name: 'David',
              avatar_url: null,
              headline: null,
              is_email_verified: true,
            },
          ],
          error: null,
        }).then(resolve),
    };
    const emptyInBuilder = () => ({
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({ data: [], error: null }),
    });
    const skillsBuilder = {
      select: jest.fn().mockReturnThis(),
      // PostgREST returns the FK join as an object, not an array.
      in: jest.fn().mockResolvedValue({
        data: [
          {
            user_id: 'talent-1',
            skill: {
              id: 'skill-1',
              name: 'Cloud Development',
              slug: 'cloud-development',
            },
          },
        ],
        error: null,
      }),
    };
    const { service } = dependencies({
      from: (table: string) => {
        if (table === 'consultant_profiles') return consultantBuilder;
        if (table === 'profiles') return profilesBuilder;
        if (table === 'user_skills') return skillsBuilder;
        return emptyInBuilder();
      },
    });

    const cards = await service.getTalent('consultant-1', {});
    expect(cards).toHaveLength(1);
    expect(cards[0].skills).toEqual([
      { id: 'skill-1', name: 'Cloud Development', slug: 'cloud-development' },
    ]);
  });
});
