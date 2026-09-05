import { TaskAssigneeNotifierService } from './task-assignee-notifier.service';

describe('TaskAssigneeNotifierService', () => {
  const ACTOR = 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb';
  const ANA = '0f7be23f-3b57-4cf4-a269-a98d2164a45a';
  const BEN = '8d1c2b3a-4e5f-4a6b-9c7d-0e1f2a3b4c5d';
  const PROJECT_ID = '0c3d0b8e-6f1e-4b0f-9b1e-2b7f0a3c9d11';
  const TASK_ID = '1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b1';
  const FEATURE_ID = '60bcab3f-3989-448d-9c84-3261cf38685b';

  const build = (projectIdFromDb: string | null = PROJECT_ID) => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { epic: { roadmap: { project_id: projectIdFromDb } } },
      error: null,
    });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    const notifications = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TaskAssigneeNotifierService(
      { from } as never,
      notifications as never,
    );
    return { service, from, eq, notifications };
  };

  it('notifies each newly assigned user once, never the actor, resolving the project from the feature', async () => {
    const { service, from, eq, notifications } = build();

    await service.notifyNewlyAssigned({
      task: { id: TASK_ID, title: '  Ship it  ', feature_id: FEATURE_ID },
      assigneeIds: [ANA, ACTOR, BEN, ANA],
      actorId: ACTOR,
    });

    expect(from).toHaveBeenCalledWith('roadmap_features');
    expect(eq).toHaveBeenCalledWith('id', FEATURE_ID);
    expect(notifications.createNotification).toHaveBeenCalledTimes(2);
    expect(notifications.createNotification).toHaveBeenNthCalledWith(1, {
      user_id: ANA,
      project_id: PROJECT_ID,
      type_name: 'task_assigned',
      actor_id: ACTOR,
      content: {
        task_id: TASK_ID,
        task_title: 'Ship it',
        message: 'You were assigned to "Ship it".',
      },
      link_url: `/project/${PROJECT_ID}/roadmap?taskId=${TASK_ID}`,
    });
    expect(notifications.createNotification.mock.calls[1][0]).toMatchObject({
      user_id: BEN,
    });
  });

  it('skips the project lookup when the caller already knows the project', async () => {
    const { service, from, notifications } = build();

    await service.notifyNewlyAssigned({
      task: { id: TASK_ID, title: 'Ship it', feature_id: FEATURE_ID },
      assigneeIds: [ANA],
      actorId: ACTOR,
      projectId: PROJECT_ID,
    });

    expect(from).not.toHaveBeenCalled();
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: ANA,
        project_id: PROJECT_ID,
        link_url: `/project/${PROJECT_ID}/roadmap?taskId=${TASK_ID}`,
      }),
    );
  });

  it('omits project_id and link_url for a personal (project-less) roadmap', async () => {
    const { service, from, notifications } = build();

    await service.notifyNewlyAssigned({
      task: { id: TASK_ID, title: '', feature_id: FEATURE_ID },
      assigneeIds: [ANA],
      actorId: ACTOR,
      projectId: null,
    });

    expect(from).not.toHaveBeenCalled();
    expect(notifications.createNotification).toHaveBeenCalledWith({
      user_id: ANA,
      project_id: undefined,
      type_name: 'task_assigned',
      actor_id: ACTOR,
      content: {
        task_id: TASK_ID,
        task_title: 'Untitled task',
        message: 'You were assigned to "Untitled task".',
      },
      link_url: undefined,
    });
  });

  it('dedupes recipients case-insensitively and excludes the actor whatever the casing', async () => {
    const { service, notifications } = build();

    await service.notifyNewlyAssigned({
      task: { id: TASK_ID, title: 'Ship it', feature_id: FEATURE_ID },
      assigneeIds: [ANA.toUpperCase(), ANA, ACTOR.toUpperCase(), BEN],
      actorId: ACTOR,
      projectId: PROJECT_ID,
    });

    expect(notifications.createNotification).toHaveBeenCalledTimes(2);
    expect(
      notifications.createNotification.mock.calls.map(
        (call) => (call[0] as { user_id: string }).user_id,
      ),
    ).toEqual([ANA, BEN]);
  });

  it('does nothing when the only newly assigned user is the actor', async () => {
    const { service, from, notifications } = build();

    await service.notifyNewlyAssigned({
      task: { id: TASK_ID, title: 'Ship it', feature_id: FEATURE_ID },
      assigneeIds: [ACTOR, ''],
      actorId: ACTOR,
    });

    expect(from).not.toHaveBeenCalled();
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('propagates a delivery failure to the caller', async () => {
    const { service, notifications } = build();
    notifications.createNotification.mockRejectedValueOnce(
      new Error('notifications down'),
    );

    await expect(
      service.notifyNewlyAssigned({
        task: { id: TASK_ID, title: 'Ship it', feature_id: FEATURE_ID },
        assigneeIds: [ANA],
        actorId: ACTOR,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow('notifications down');
  });
});
