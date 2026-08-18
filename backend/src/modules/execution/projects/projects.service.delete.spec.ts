import { BadRequestException } from '@nestjs/common';
import type { ProjectCommercePort } from './ports/project-commerce.port';
import { ProjectsService } from './projects.service';

/**
 * Deletion is the ordering-sensitive half of the commerce inversion: refuse
 * first, stop running timers while the project still exists, then clear drafts.
 *
 * The harness deliberately builds ProjectsService with NO Supabase table stubs
 * for contracts or invoices and no marketplace module anywhere. If execution
 * ever reaches back into those tables directly, these tests stop passing —
 * which is the point of them.
 */
function buildHarness(input: { vetoWith?: Error } = {}) {
  const sequence: string[] = [];

  const commerce: jest.Mocked<ProjectCommercePort> = {
    assertProjectDeletable: jest.fn().mockImplementation(() => {
      sequence.push('veto:checked');
      return input.vetoWith
        ? Promise.reject(input.vetoWith)
        : Promise.resolve();
    }),
    purgeDraftCommerce: jest.fn().mockImplementation(() => {
      sequence.push('purge:drafts');
      return Promise.resolve();
    }),
    getInvoiceSummary: jest.fn(),
  };

  const projectsRepo = {
    findById: jest.fn().mockResolvedValue({
      id: 'project-1',
      title: 'Durable project',
      owner_id: 'owner-1',
    }),
    deleteProject: jest.fn().mockImplementation(() => {
      sequence.push('delete:project');
      return Promise.resolve();
    }),
  };
  const teamTime = {
    stopRunningLogsForProject: jest.fn().mockImplementation(() => {
      sequence.push('stop:timers');
      return Promise.resolve(2);
    }),
  };
  const cacheInvalidation = {
    invalidateAllDashboardCache: jest.fn().mockResolvedValue(undefined),
  };
  // Throws on any property access, so a stray direct table read fails loudly
  // instead of silently returning undefined.
  const supabase = new Proxy(
    {},
    {
      get() {
        throw new Error(
          'deleteProject must not touch Supabase directly — use the commerce port',
        );
      },
    },
  );

  const service = new ProjectsService(
    projectsRepo as never,
    { createNotification: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    supabase as never,
    {} as never,
    cacheInvalidation as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    teamTime as never,
    commerce,
  );
  return { service, projectsRepo, teamTime, cacheInvalidation, commerce, sequence };
}

describe('ProjectsService.deleteProject', () => {
  it('refuses when the commerce port vetoes, before touching anything else', async () => {
    const harness = buildHarness({
      vetoWith: new BadRequestException(
        'Cannot delete this project while it has sent or signed contracts or issued or sent invoices.',
      ),
    });

    await expect(
      harness.service.deleteProject('project-1', 'owner-1'),
    ).rejects.toThrow(BadRequestException);

    expect(harness.teamTime.stopRunningLogsForProject).not.toHaveBeenCalled();
    expect(harness.commerce.purgeDraftCommerce).not.toHaveBeenCalled();
    expect(harness.projectsRepo.deleteProject).not.toHaveBeenCalled();
  });

  it('checks ownership before asking the commerce port anything', async () => {
    const harness = buildHarness();

    await expect(
      harness.service.deleteProject('project-1', 'not-the-owner'),
    ).rejects.toThrow();

    expect(harness.commerce.assertProjectDeletable).not.toHaveBeenCalled();
  });

  it('vetoes, stops timers, purges drafts, then deletes — in that order', async () => {
    const harness = buildHarness();

    await expect(
      harness.service.deleteProject('project-1', 'owner-1'),
    ).resolves.toBeUndefined();

    expect(harness.commerce.assertProjectDeletable).toHaveBeenCalledWith(
      'project-1',
    );
    expect(harness.commerce.purgeDraftCommerce).toHaveBeenCalledWith(
      'project-1',
    );
    // Timers must stop while the project still exists, and drafts must go
    // before the row does.
    expect(harness.sequence).toEqual([
      'veto:checked',
      'stop:timers',
      'purge:drafts',
      'delete:project',
    ]);
    expect(
      harness.cacheInvalidation.invalidateAllDashboardCache,
    ).toHaveBeenCalledTimes(1);
  });

  it('runs with no commerce implementation at all', async () => {
    // Execution standalone: the port defaults to a no-op, so nothing forbids
    // deletion and there is nothing to purge.
    const projectsRepo = {
      findById: jest.fn().mockResolvedValue({
        id: 'project-1',
        title: 'Standalone project',
        owner_id: 'owner-1',
      }),
      deleteProject: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ProjectsService(
      projectsRepo as never,
      { createNotification: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { invalidateAllDashboardCache: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { stopRunningLogsForProject: jest.fn().mockResolvedValue(0) } as never,
    );

    await expect(
      service.deleteProject('project-1', 'owner-1'),
    ).resolves.toBeUndefined();
    expect(projectsRepo.deleteProject).toHaveBeenCalledWith('project-1');
  });
});
