import { ForbiddenException } from '@nestjs/common';
import { TaskExtrasService } from './task-extras.service';

describe('TaskExtrasService.addCommentToTasks', () => {
  const userId = 'user-1';
  const roadmapId = 'rm-1';

  function build(
    overrides: {
      resolveRoadmapId?: jest.Mock;
      assertTaskCommentPermission?: jest.Mock;
      addComment?: jest.Mock;
    } = {},
  ) {
    const repo = {
      addComment:
        overrides.addComment ??
        jest.fn((taskId: string) => Promise.resolve({ id: `c-${taskId}` })),
    };
    const roadmapAuthz = {
      resolveRoadmapId:
        overrides.resolveRoadmapId ?? jest.fn().mockResolvedValue(roadmapId),
      assertTaskCommentPermission:
        overrides.assertTaskCommentPermission ??
        jest.fn().mockResolvedValue(undefined),
      resolveProjectId: jest.fn().mockResolvedValue(null),
    };
    const notifications = { createNotification: jest.fn() };
    const knowledgeOutbox = { enqueue: jest.fn() };
    const service = new TaskExtrasService(
      repo as never,
      roadmapAuthz as never,
      notifications as never,
      knowledgeOutbox as never,
    );
    return { service, repo, roadmapAuthz, knowledgeOutbox };
  }

  it('posts to every task and reports per-task comment ids', async () => {
    const { service, repo, knowledgeOutbox } = build();

    const out = await service.addCommentToTasks(
      roadmapId,
      ['t1', 't2'],
      'Carried over to August.',
      userId,
    );

    expect(out.posted).toBe(2);
    expect(out.failed).toBe(0);
    expect(out.results).toEqual([
      { task_id: 't1', ok: true, comment_id: 'c-t1' },
      { task_id: 't2', ok: true, comment_id: 'c-t2' },
    ]);
    expect(repo.addComment).toHaveBeenCalledTimes(2);
    // Reusing addComment keeps the knowledge-outbox side effect.
    expect(knowledgeOutbox.enqueue).toHaveBeenCalledTimes(2);
  });

  it('marks a task on a different roadmap NOT_FOUND while others post', async () => {
    const resolveRoadmapId = jest.fn((ref: { taskId: string }) =>
      Promise.resolve(ref.taskId === 't-alien' ? 'other-roadmap' : roadmapId),
    );
    const { service, repo } = build({ resolveRoadmapId });

    const out = await service.addCommentToTasks(
      roadmapId,
      ['t1', 't-alien'],
      'note',
      userId,
    );

    expect(out.posted).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.results[1]).toEqual({
      task_id: 't-alien',
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Task not found on this roadmap.' },
    });
    expect(repo.addComment).toHaveBeenCalledTimes(1);
  });

  it('maps a per-task 403 to FORBIDDEN and keeps going', async () => {
    const assertTaskCommentPermission = jest.fn((taskId: string) =>
      taskId === 't-denied'
        ? Promise.reject(new ForbiddenException('No comment permission'))
        : Promise.resolve(undefined),
    );
    const { service } = build({ assertTaskCommentPermission });

    const out = await service.addCommentToTasks(
      roadmapId,
      ['t-denied', 't2'],
      'note',
      userId,
    );

    expect(out.posted).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.results[0].error?.code).toBe('FORBIDDEN');
    expect(out.results[1].ok).toBe(true);
  });

  it('maps a non-HTTP repo failure to COMMENT_FAILED', async () => {
    const addComment = jest.fn().mockRejectedValue(new Error('db down'));
    const { service } = build({ addComment });

    const out = await service.addCommentToTasks(
      roadmapId,
      ['t1'],
      'note',
      userId,
    );

    expect(out.failed).toBe(1);
    expect(out.results[0].error?.code).toBe('COMMENT_FAILED');
  });

  it('dedupes repeated task ids', async () => {
    const { service, repo } = build();

    const out = await service.addCommentToTasks(
      roadmapId,
      ['t1', 't1', 't1'],
      'note',
      userId,
    );

    expect(out.results).toHaveLength(1);
    expect(repo.addComment).toHaveBeenCalledTimes(1);
  });
});
