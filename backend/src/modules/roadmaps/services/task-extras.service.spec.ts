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
      filterUsersWhoCanViewRoadmap?: jest.Mock;
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
        jest.fn().mockResolvedValue({
          roadmapId,
          projectId: null,
          ownerId: userId,
          permissions: null,
          featureId: 'f-1',
        }),
      resolveProjectId: jest.fn().mockResolvedValue(null),
      // Permissive by default so the batch-comment tests below are unaffected;
      // the mention-scoping tests override it.
      filterUsersWhoCanViewRoadmap:
        overrides.filterUsersWhoCanViewRoadmap ??
        jest.fn((_roadmapId: string, ids: string[]) => Promise.resolve(ids)),
    };
    const notifications = {
      createNotification: jest.fn(),
      resolveActorName: jest.fn().mockResolvedValue('Ada Lovelace'),
    };
    const knowledgeOutbox = { enqueue: jest.fn() };
    const effects = { emit: jest.fn(), record: jest.fn(), touch: jest.fn() };
    const activity = {
      commentMetadata: jest.fn().mockReturnValue({}),
      reorderMetadata: jest.fn().mockReturnValue({}),
    };
    const service = new TaskExtrasService(
      repo as never,
      roadmapAuthz as never,
      notifications as never,
      knowledgeOutbox as never,
      effects as never,
      activity as never,
    );
    return { service, repo, roadmapAuthz, knowledgeOutbox, notifications };
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

describe('TaskExtrasService mention scoping', () => {
  const userId = 'author-1';
  const roadmapId = 'rm-1';

  /** A comment body carrying mention spans, exactly as the editor emits them. */
  function mentionHtml(...ids: string[]): string {
    return ids
      .map(
        (id) =>
          `<span class="mention" data-user-id="${id}" contenteditable="false">@Someone</span>`,
      )
      .join(' ');
  }

  function build(filterUsersWhoCanViewRoadmap?: jest.Mock) {
    const repo = {
      addComment: jest.fn(() => Promise.resolve({ id: 'c-1' })),
    };
    const roadmapAuthz = {
      assertTaskCommentPermission: jest.fn().mockResolvedValue({
        roadmapId,
        projectId: 'p-1',
        ownerId: userId,
        permissions: null,
        featureId: 'f-1',
      }),
      filterUsersWhoCanViewRoadmap:
        filterUsersWhoCanViewRoadmap ??
        jest.fn((_rid: string, ids: string[]) => Promise.resolve(ids)),
    };
    const notifications = {
      createNotification: jest.fn(),
      resolveActorName: jest.fn().mockResolvedValue('Ada Lovelace'),
    };
    const service = new TaskExtrasService(
      repo as never,
      roadmapAuthz as never,
      notifications as never,
      { enqueue: jest.fn() } as never,
      { emit: jest.fn(), record: jest.fn(), touch: jest.fn() } as never,
      {
        commentMetadata: jest.fn().mockReturnValue({}),
        reorderMetadata: jest.fn().mockReturnValue({}),
      } as never,
    );
    return { service, notifications, roadmapAuthz };
  }

  /** Mentions fire detached (`void ...`), so let the microtask queue drain. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('does not notify a mentioned user who cannot view the roadmap', async () => {
    // The regression this guards: `data-user-id` is attacker-controlled, so an
    // unfiltered fan-out notifies (and, once email lands, emails) any user id
    // the author types.
    const filter = jest.fn().mockResolvedValue([]);
    const { service, notifications } = build(filter);

    await service.addComment(
      't-1',
      { content: mentionHtml('outsider-1') } as never,
      userId,
    );
    await flush();

    expect(filter).toHaveBeenCalledWith(roadmapId, ['outsider-1']);
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('notifies only the mentioned users who can view the roadmap', async () => {
    const filter = jest.fn().mockResolvedValue(['member-1']);
    const { service, notifications } = build(filter);

    await service.addComment(
      't-1',
      { content: mentionHtml('member-1', 'outsider-1') } as never,
      userId,
    );
    await flush();

    expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'member-1',
        type_name: 'task_comment_mention',
      }),
    );
  });

  it('snapshots the actor name and a tag-free excerpt into content', async () => {
    const filter = jest.fn().mockResolvedValue(['member-1']);
    const { service, notifications } = build(filter);

    await service.addComment(
      't-1',
      {
        content: `${mentionHtml('member-1')}<p>Ship it <b>today</b></p><script>alert(1)</script>`,
      } as never,
      userId,
    );
    await flush();

    const content = notifications.createNotification.mock.calls[0][0]
      .content as Record<string, string>;
    expect(content.actor_name).toBe('Ada Lovelace');
    // The excerpt is what an email body renders, so it must carry no markup —
    // `sanitizeCommentHtml` is a regex strip, not a whitelist, and cannot be
    // relied on here.
    expect(content.excerpt).toContain('Ship it today');
    expect(content.excerpt).not.toContain('<');
    expect(content.excerpt).not.toContain('alert(1)');
  });

  it('never notifies the author, even self-mentioning', async () => {
    const { service, notifications, roadmapAuthz } = build();

    await service.addComment(
      't-1',
      { content: mentionHtml(userId) } as never,
      userId,
    );
    await flush();

    expect(roadmapAuthz.filterUsersWhoCanViewRoadmap).not.toHaveBeenCalled();
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('fails closed when the roadmap scope is unknown', async () => {
    const { service, notifications, roadmapAuthz } = build();
    roadmapAuthz.assertTaskCommentPermission.mockResolvedValue({
      roadmapId: null,
      projectId: null,
      ownerId: userId,
      permissions: null,
      featureId: 'f-1',
    });

    await service.addComment(
      't-1',
      { content: mentionHtml('member-1') } as never,
      userId,
    );
    await flush();

    expect(notifications.createNotification).not.toHaveBeenCalled();
  });
});
