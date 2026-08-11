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

describe('MarketplaceService freelancer enrollment', () => {
  it('rejects go-live with a structured missing-requirements response', async () => {
    const supabase = { from: jest.fn() };
    const { service } = dependencies(supabase, {
      eligible: false,
      missing: ['identity', 'portfolio'],
    });

    await expect(service.goLive('user-1')).rejects.toMatchObject({
      response: {
        message: 'Complete your freelancer profile before going live.',
        missing: ['identity', 'portfolio'],
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

  it('blocks invites to paused freelancers', async () => {
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
    const freelancerBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    const { service, authorization } = dependencies({
      from: (table: string) => {
        if (table === 'consultant_profiles') return consultantBuilder;
        if (table === 'projects') return projectBuilder;
        if (table === 'freelancer_profiles') return freelancerBuilder;
        throw new Error(`Unexpected table: ${table}`);
      },
    });

    await expect(
      service.inviteFreelancer('consultant-1', {
        projectId: 'project-1',
        inviteeId: 'freelancer-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(authorization.assertRole).toHaveBeenCalledWith(
      'consultant-1',
      'project-1',
      'admin',
    );
    expect(freelancerBuilder.eq).toHaveBeenCalledWith('status', 'active');
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

    await expect(service.getFreelancers('consultant-1', {})).resolves.toEqual(
      [],
    );
    expect(profilesBuilder.select).toHaveBeenCalledWith(
      expect.stringContaining('freelancer_profiles!inner'),
    );
    expect(profilesBuilder.eq).toHaveBeenCalledWith(
      'freelancer_profile.status',
      'active',
    );
  });
});
