import { ForbiddenException } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { ProjectTimeService } from './project-time.service';
import {
  ProjectTimeRepository,
  TaskTimeLogRecord,
} from './repositories/project-time.repository.interface';

const createLog = (
  overrides: Partial<TaskTimeLogRecord> = {},
): TaskTimeLogRecord => ({
  id: 'log-1',
  project_id: 'project-1',
  task_id: 'task-1',
  member_user_id: 'member-1',
  started_at: new Date('2026-04-01T08:00:00.000Z').toISOString(),
  ended_at: new Date('2026-04-01T09:00:00.000Z').toISOString(),
  duration_seconds: 3600,
  status: 'pending',
  reviewed_by: null,
  reviewed_at: null,
  review_note: null,
  source: 'manual',
  created_at: new Date('2026-04-01T09:01:00.000Z').toISOString(),
  updated_at: new Date('2026-04-01T09:01:00.000Z').toISOString(),
  ...overrides,
});

const createRepoMock = (): jest.Mocked<ProjectTimeRepository> =>
  ({
    hasProjectMemberRate: jest.fn(),
    findProjectMemberRateById: jest.fn(),
    findProjectMemberRateByUser: jest.fn(),
    listProjectTasks: jest.fn(),
    listProjectMemberRates: jest.fn(),
    createProjectMemberRate: jest.fn(),
    updateProjectMemberRateById: jest.fn(),
    deleteProjectMemberRateById: jest.fn(),
    getProjectMemberForUser: jest.fn(),
    getProjectMemberById: jest.fn(),
    getTaskProjectId: jest.fn(),
    findById: jest.fn(),
    findByIds: jest.fn(),
    stopActiveForMember: jest.fn(),
    createStartedLog: jest.fn(),
    stopLogById: jest.fn(),
    deleteLogById: jest.fn(),
    updateLogById: jest.fn(),
    updateLogReviewByIds: jest.fn(),
    listProjectLogs: jest.fn(),
    listTaskLogsForMember: jest.fn(),
  }) as jest.Mocked<ProjectTimeRepository>;

describe('ProjectTimeService own-log lock', () => {
  let service: ProjectTimeService;
  let repo: jest.Mocked<ProjectTimeRepository>;
  let projectsService: jest.Mocked<ProjectsService>;

  beforeEach(() => {
    repo = createRepoMock();
    projectsService = {
      assertProjectPermission: jest.fn(),
      assertProjectAnyPermission: jest.fn(),
      getMyPermissions: jest.fn(),
    } as unknown as jest.Mocked<ProjectsService>;

    service = new ProjectTimeService(repo, projectsService);
  });

  it('blocks member update on approved own log', async () => {
    repo.findById.mockResolvedValue(
      createLog({ member_user_id: 'member-1', status: 'approved' }),
    );
    projectsService.assertProjectPermission.mockResolvedValue(undefined);

    await expect(
      service.update('member-1', 'log-1', { review_note: 'try update' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(repo.updateLogById).not.toHaveBeenCalled();
    expect(repo.hasProjectMemberRate).not.toHaveBeenCalled();
  });

  it('blocks member delete on rejected own log', async () => {
    repo.findById.mockResolvedValue(
      createLog({ member_user_id: 'member-1', status: 'rejected' }),
    );
    projectsService.assertProjectPermission.mockResolvedValue(undefined);

    await expect(service.delete('member-1', 'log-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(repo.deleteLogById).not.toHaveBeenCalled();
    expect(repo.hasProjectMemberRate).not.toHaveBeenCalled();
  });

  it('still allows manager team-edit on approved log', async () => {
    const existing = createLog({
      member_user_id: 'member-1',
      status: 'approved',
      ended_at: new Date('2026-04-01T10:00:00.000Z').toISOString(),
      duration_seconds: 7200,
    });
    repo.findById.mockResolvedValue(existing);
    projectsService.assertProjectPermission.mockResolvedValue(undefined);
    repo.hasProjectMemberRate.mockResolvedValue(true);
    repo.updateLogById.mockResolvedValue({
      ...existing,
      review_note: 'manager edit',
    });

    await service.update('manager-1', 'log-1', { review_note: 'manager edit' });

    expect(repo.updateLogById).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({
        review_note: 'manager edit',
      }),
    );
  });
});
