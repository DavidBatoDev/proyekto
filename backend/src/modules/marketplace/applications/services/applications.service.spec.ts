import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApplicationsService } from './applications.service';

function buildService(overrides?: {
  existing?: any;
  eligibility?: { eligible: boolean; missing: string[] };
  adminIds?: string[];
}) {
  const appRepo = {
    findByUser: jest.fn().mockResolvedValue(overrides?.existing ?? null),
    upsert: jest.fn((_userId: string, input: any) =>
      Promise.resolve({ id: 'app-1', status: 'draft', ...input }),
    ),
    submit: jest.fn().mockResolvedValue({ id: 'app-1', status: 'submitted' }),
    listActiveAdminUserIds: jest
      .fn()
      .mockResolvedValue(overrides?.adminIds ?? []),
  };
  const eligibility = {
    check: jest
      .fn()
      .mockResolvedValue(
        overrides?.eligibility ?? { eligible: true, missing: [] },
      ),
  };
  const notifications = {
    createNotification: jest.fn().mockResolvedValue({}),
  };
  return {
    service: new ApplicationsService(
      appRepo as never,
      eligibility as never,
      notifications as never,
    ),
    appRepo,
    eligibility,
    notifications,
  };
}

describe('ApplicationsService.upsert', () => {
  it('maps placements to ordered rows with years and the primary flagged', async () => {
    const { service, appRepo } = buildService();
    await service.upsert('u1', {
      linkedin_url: 'https://linkedin.com/in/x',
      placements: [
        { subcategory_id: 'sub-a', years_experience: 5 },
        { subcategory_id: 'sub-b', years_experience: 1 },
        { subcategory_id: 'sub-c' },
      ],
      primary_subcategory_id: 'sub-b',
    });
    expect(appRepo.upsert).toHaveBeenCalledWith('u1', {
      linkedin_url: 'https://linkedin.com/in/x',
      placements: [
        {
          subcategory_id: 'sub-a',
          years_experience: 5,
          is_primary: false,
          position: 0,
        },
        {
          subcategory_id: 'sub-b',
          years_experience: 1,
          is_primary: true,
          position: 1,
        },
        {
          subcategory_id: 'sub-c',
          years_experience: null,
          is_primary: false,
          position: 2,
        },
      ],
    });
  });

  it('defaults the primary to the first pick when none is named', async () => {
    const { service, appRepo } = buildService();
    await service.upsert('u1', {
      placements: [
        { subcategory_id: 'sub-a', years_experience: 3 },
        { subcategory_id: 'sub-b', years_experience: 10 },
      ],
    });
    const input = appRepo.upsert.mock.calls[0][1];
    expect(input.placements[0]).toMatchObject({
      subcategory_id: 'sub-a',
      is_primary: true,
    });
  });

  it('dedupes placements keeping the first occurrence and its years', async () => {
    const { service, appRepo } = buildService();
    await service.upsert('u1', {
      placements: [
        { subcategory_id: 'sub-a', years_experience: 5 },
        { subcategory_id: 'sub-a', years_experience: 0 },
      ],
    });
    const input = appRepo.upsert.mock.calls[0][1];
    expect(input.placements).toHaveLength(1);
    expect(input.placements[0]).toMatchObject({
      subcategory_id: 'sub-a',
      years_experience: 5,
    });
  });

  it('rejects a primary_subcategory_id outside the placements', async () => {
    const { service } = buildService();
    await expect(
      service.upsert('u1', {
        placements: [{ subcategory_id: 'sub-a', years_experience: 3 }],
        primary_subcategory_id: 'sub-z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('leaves placements untouched when the field is absent', async () => {
    const { service, appRepo } = buildService();
    await service.upsert('u1', { linkedin_url: 'https://linkedin.com/in/x' });
    expect(appRepo.upsert.mock.calls[0][1].placements).toBeUndefined();
  });

  it('refuses edits once the application is submitted', async () => {
    const { service } = buildService({
      existing: { id: 'app-1', status: 'submitted' },
    });
    await expect(
      service.upsert('u1', { linkedin_url: 'https://linkedin.com/in/x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows edits on a rejected application (revise-and-resubmit)', async () => {
    const { service, appRepo } = buildService({
      existing: { id: 'app-1', status: 'rejected' },
    });
    await service.upsert('u1', { linkedin_url: 'https://linkedin.com/in/x' });
    expect(appRepo.upsert).toHaveBeenCalled();
  });
});

describe('ApplicationsService.submit', () => {
  it('404s when no application exists', async () => {
    const { service } = buildService();
    await expect(service.submit('u1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('submits a draft application when eligible', async () => {
    const { service, appRepo } = buildService({
      existing: { id: 'app-1', status: 'draft' },
    });
    await expect(service.submit('u1')).resolves.toMatchObject({
      status: 'submitted',
    });
    expect(appRepo.submit).toHaveBeenCalledWith('u1');
  });

  it('allows resubmission from rejected', async () => {
    const { service, appRepo } = buildService({
      existing: { id: 'app-1', status: 'rejected' },
    });
    await service.submit('u1');
    expect(appRepo.submit).toHaveBeenCalledWith('u1');
  });

  it('blocks re-submission from submitted and approved', async () => {
    for (const status of ['submitted', 'approved'] as const) {
      const { service, appRepo } = buildService({
        existing: { id: 'app-1', status },
      });
      await expect(service.submit('u1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(appRepo.submit).not.toHaveBeenCalled();
    }
  });

  it('fans out consultant_application_submitted to active admins, not the applicant', async () => {
    const { service, notifications } = buildService({
      existing: { id: 'app-1', status: 'draft' },
      adminIds: ['admin-1', 'admin-2', 'u1'],
    });
    await service.submit('u1');
    expect(notifications.createNotification).toHaveBeenCalledTimes(2);
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'admin-1',
        type_name: 'consultant_application_submitted',
        actor_id: 'u1',
        link_url: '/admin/applications',
      }),
    );
  });

  it('still submits when the admin fan-out fails', async () => {
    const { service, notifications } = buildService({
      existing: { id: 'app-1', status: 'draft' },
      adminIds: ['admin-1'],
    });
    notifications.createNotification.mockRejectedValue(new Error('down'));
    await expect(service.submit('u1')).resolves.toMatchObject({
      status: 'submitted',
    });
  });

  it('rejects an ineligible submit with the {message, missing} shape', async () => {
    const { service, appRepo } = buildService({
      existing: { id: 'app-1', status: 'draft' },
      eligibility: {
        eligible: false,
        missing: ['identity_document', 'work_links'],
      },
    });
    await expect(service.submit('u1')).rejects.toMatchObject({
      response: {
        message: 'Complete your application before submitting.',
        missing: ['identity_document', 'work_links'],
      },
    });
    expect(appRepo.submit).not.toHaveBeenCalled();
  });
});
