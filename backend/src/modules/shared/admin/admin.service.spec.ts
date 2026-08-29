import { AdminService } from './admin.service';

describe('AdminService cache consistency', () => {
  const cacheInvalidation = {
    invalidateConsultantsCache: jest.fn().mockResolvedValue(undefined),
    invalidateMarketplaceTalentCache: jest.fn().mockResolvedValue(undefined),
    invalidateAllDashboardCache: jest.fn().mockResolvedValue(undefined),
  };

  const adminRepo = {
    getApplicationUserId: jest.fn(),
    approveApplication: jest.fn(),
    rejectApplication: jest.fn(),
    suspendConsultant: jest.fn(),
    reinstateConsultant: jest.fn(),
    revokeConsultant: jest.fn(),
    assignConsultant: jest.fn(),
  };

  const teamsService = {
    provisionPersonalTeam: jest.fn().mockResolvedValue({ id: 'team-1' }),
  };

  const authorization = {
    grant: jest.fn().mockResolvedValue({ id: 'access-1' }),
  };

  const notifications = {
    createNotification: jest.fn().mockResolvedValue({ id: 'notification-1' }),
  };

  const uploads = {
    getPrivateSignedUrl: jest.fn().mockResolvedValue('https://signed.example'),
  };

  const service = new AdminService(
    adminRepo as any,
    cacheInvalidation as any,
    teamsService as any,
    authorization as any,
    notifications as any,
    uploads as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invalidates consultant + marketplace caches after approval', async () => {
    adminRepo.getApplicationUserId.mockResolvedValueOnce('user-1');
    adminRepo.approveApplication.mockResolvedValueOnce({ user_id: 'user-1' });

    await service.approveApplication('application-1', 'admin-1');

    expect(teamsService.provisionPersonalTeam).toHaveBeenCalledWith('user-1');
    expect(adminRepo.approveApplication).toHaveBeenCalledWith(
      'application-1',
      'admin-1',
    );

    expect(cacheInvalidation.invalidateConsultantsCache).toHaveBeenCalledWith(
      'user-1',
    );
    expect(
      cacheInvalidation.invalidateMarketplaceTalentCache,
    ).toHaveBeenCalledTimes(1);
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        actor_id: 'admin-1',
        type_name: 'consultant_application_approved',
      }),
    );
  });

  it('records the rejecting admin and notifies the applicant with the reason', async () => {
    adminRepo.rejectApplication.mockResolvedValueOnce({ user_id: 'user-2' });

    await service.rejectApplication('application-2', 'admin-2', {
      reason: 'More delivery evidence is required.',
    });

    expect(adminRepo.rejectApplication).toHaveBeenCalledWith(
      'application-2',
      'admin-2',
      'More delivery evidence is required.',
    );
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-2',
        actor_id: 'admin-2',
        type_name: 'consultant_application_rejected',
        content: expect.objectContaining({
          reason: 'More delivery evidence is required.',
        }),
      }),
    );
  });

  it.each([
    {
      action: 'suspendConsultant' as const,
      repoMethod: 'suspendConsultant' as const,
      dto: { reason: 'Quality review' },
      notificationType: 'consultant_suspended',
    },
    {
      action: 'reinstateConsultant' as const,
      repoMethod: 'reinstateConsultant' as const,
      dto: { reason: 'Review complete' },
      notificationType: 'consultant_reinstated',
    },
    {
      action: 'revokeConsultant' as const,
      repoMethod: 'revokeConsultant' as const,
      dto: { reason: 'Permanent policy violation' },
      notificationType: 'consultant_revoked',
    },
  ])(
    'invalidates discovery and notifies after $action',
    async ({ action, repoMethod, dto, notificationType }) => {
      adminRepo[repoMethod].mockResolvedValueOnce({
        user_id: 'consultant-1',
      });

      await service[action]('consultant-1', 'admin-1', dto);

      expect(adminRepo[repoMethod]).toHaveBeenCalledWith(
        'consultant-1',
        'admin-1',
        dto.reason,
      );
      expect(cacheInvalidation.invalidateConsultantsCache).toHaveBeenCalledWith(
        'consultant-1',
      );
      expect(
        cacheInvalidation.invalidateMarketplaceTalentCache,
      ).toHaveBeenCalledTimes(1);
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type_name: notificationType }),
      );
    },
  );

  it('invalidates dashboard caches after consultant assignment', async () => {
    adminRepo.assignConsultant.mockResolvedValueOnce({ id: 'project-1' });

    await service.matchAssign({
      project_id: 'project-1',
      consultant_id: 'consultant-1',
    });

    expect(authorization.grant).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'consultant-1',
      role: 'owner',
      origin: 'direct',
      grantedBy: 'consultant-1',
    });
    expect(adminRepo.assignConsultant).toHaveBeenCalledWith('project-1');
    expect(authorization.grant.mock.invocationCallOrder[0]).toBeLessThan(
      adminRepo.assignConsultant.mock.invocationCallOrder[0],
    );
    expect(cacheInvalidation.invalidateAllDashboardCache).toHaveBeenCalledTimes(
      1,
    );
  });
});
