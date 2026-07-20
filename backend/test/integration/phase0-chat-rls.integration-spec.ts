/**
 * Real-DB tests for G9 (channel-send requires the chat.send_messages
 * capability — viewers blocked, commenter/consultant allowed) and G7 (the
 * assignee join-table SELECT RLS is scoped to users who can view the roadmap,
 * probed directly through PostgREST with a user JWT).
 */
import request from 'supertest';
import { Harness } from './harness';

jest.setTimeout(120000);

describe('phase0 chat send + assignee RLS (G9, G7)', () => {
  const h = new Harness();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  // Shared
  let projectOwner: Awaited<ReturnType<Harness['createUser']>>;
  let viewer: Awaited<ReturnType<Harness['createUser']>>;
  let commenter: Awaited<ReturnType<Harness['createUser']>>;
  let outsider: Awaited<ReturnType<Harness['createUser']>>;
  let projectId: string;
  let taskId: string;

  beforeAll(async () => {
    await h.boot();
    projectOwner = await h.createUser('projowner');
    viewer = await h.createUser('viewer');
    commenter = await h.createUser('commenter');
    outsider = await h.createUser('outsider');

    projectId = await h.createProject(projectOwner.id);
    await h.grantAccess(projectId, projectOwner.id, 'owner');
    await h.grantAccess(projectId, viewer.id, 'viewer');
    await h.grantAccess(projectId, commenter.id, 'commenter');

    const roadmapId = await h.createRoadmap(projectOwner.id, projectId);
    const epicId = await h.createEpic(roadmapId);
    const featureId = await h.createFeature(epicId, roadmapId);
    taskId = await h.createTask(featureId);
    await h.addTaskAssignee(taskId, projectOwner.id);
  });

  afterAll(async () => {
    await h.cleanup();
    await h.close();
  });

  // ── G9: channel-send capability ──────────────────────────────────────────
  describe('G9 chat.send_messages enforcement', () => {
    it('a viewer cannot post to a channel (403)', async () => {
      await request(h.server())
        .post(`/api/projects/${projectId}/chat/messages`)
        .set(auth(viewer.token))
        .send({ content: 'viewer trying to post' })
        .expect(403);
    });

    it('a commenter can post to a channel', async () => {
      const res = await request(h.server())
        .post(`/api/projects/${projectId}/chat/messages`)
        .set(auth(commenter.token))
        .send({ content: 'commenter says hi' });
      expect([200, 201]).toContain(res.status);
    });
  });

  // ── G7: assignee-table SELECT RLS scoping ────────────────────────────────
  describe('G7 assignee RLS scoping', () => {
    it('a roadmap viewer can read the task’s assignee rows', async () => {
      const { data, error } = await h
        .userClient(projectOwner.token)
        .from('roadmap_task_assignees')
        .select('task_id, assignee_id')
        .eq('task_id', taskId);
      expect(error).toBeFalsy();
      expect((data ?? []).length).toBeGreaterThan(0);
    });

    it('an outsider gets zero rows (not every authenticated user)', async () => {
      const { data, error } = await h
        .userClient(outsider.token)
        .from('roadmap_task_assignees')
        .select('task_id, assignee_id')
        .eq('task_id', taskId);
      expect(error).toBeFalsy();
      expect((data ?? []).length).toBe(0);
    });
  });
});
