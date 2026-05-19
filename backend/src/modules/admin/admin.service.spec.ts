import { AdminService } from './admin.service';

describe('AdminService cache consistency', () => {
  const cacheInvalidation = {
    invalidateConsultantsCache: jest.fn().mockResolvedValue(undefined),
    invalidateMarketplaceFreelancersCache: jest
      .fn()
      .mockResolvedValue(undefined),
    invalidateAllDashboardCache: jest.fn().mockResolvedValue(undefined),
  };

  const adminRepo = {
    approveApplication: jest.fn(),
    assignConsultant: jest.fn(),
  };

  const service = new AdminService(adminRepo as any, cacheInvalidation as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invalidates consultant + marketplace caches after approval', async () => {
    adminRepo.approveApplication.mockResolvedValueOnce({ user_id: 'user-1' });

    await service.approveApplication('application-1');

    expect(cacheInvalidation.invalidateConsultantsCache).toHaveBeenCalledWith(
      'user-1',
    );
    expect(
      cacheInvalidation.invalidateMarketplaceFreelancersCache,
    ).toHaveBeenCalledTimes(1);
  });

  it('invalidates dashboard caches after consultant assignment', async () => {
    adminRepo.assignConsultant.mockResolvedValueOnce({ id: 'project-1' });

    await service.matchAssign({
      project_id: 'project-1',
      consultant_id: 'consultant-1',
    });

    expect(cacheInvalidation.invalidateAllDashboardCache).toHaveBeenCalledTimes(
      1,
    );
  });
});
