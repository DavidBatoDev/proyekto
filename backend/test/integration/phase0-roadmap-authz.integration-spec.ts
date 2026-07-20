/**
 * Real-DB authorization tests for Phase 0 gaps G1, G2, G3, G6 — roadmap child
 * reads, the user-roadmap enumeration guard, AI context view-level access, the
 * dependency-delete binding+authz check, and the roadmap.assign capability.
 */
import request from 'supertest';
import { Harness } from './harness';

jest.setTimeout(120000);

describe('phase0 roadmap authorization (G1, G2, G3, G6)', () => {
  const h = new Harness();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let owner: Awaited<ReturnType<Harness['createUser']>>;
  let outsider: Awaited<ReturnType<Harness['createUser']>>;
  let viewer: Awaited<ReturnType<Harness['createUser']>>;
  let editorNoAssign: Awaited<ReturnType<Harness['createUser']>>;
  let guest: Awaited<ReturnType<Harness['createUser']>>;

  let projectId: string;
  let roadmapId: string;
  let taskId: string;
  let dependencyId: string;
  let otherDependencyId: string;

  beforeAll(async () => {
    await h.boot();
    owner = await h.createUser('owner');
    outsider = await h.createUser('outsider');
    viewer = await h.createUser('viewer');
    editorNoAssign = await h.createUser('editnoassign');
    guest = await h.createUser('guest');
    await h.markGuest(guest.id);

    projectId = await h.createProject(owner.id);
    await h.grantAccess(projectId, owner.id, 'owner');
    await h.grantAccess(projectId, viewer.id, 'viewer');
    // Editor whose roadmap.assign has been explicitly revoked via a per-user
    // capability override — can edit tasks but must not (un)assign.
    await h.grantAccess(projectId, editorNoAssign.id, 'editor', {
      'roadmap.assign': false,
    });

    roadmapId = await h.createRoadmap(owner.id, projectId);
    const epicId = await h.createEpic(roadmapId);
    const featureId = await h.createFeature(epicId, roadmapId);
    taskId = await h.createTask(featureId, 0);
    const taskId2 = await h.createTask(featureId, 1);
    const taskId3 = await h.createTask(featureId, 2);
    const taskId4 = await h.createTask(featureId, 3);
    dependencyId = await h.createDependency(taskId, taskId2);
    // A dependency that belongs to a DIFFERENT task (for the binding check).
    otherDependencyId = await h.createDependency(taskId3, taskId4);
  });

  afterAll(async () => {
    await h.cleanup();
    await h.close();
  });

  // ── G1: roadmap child reads require view access ──────────────────────────
  describe('G1 read IDOR', () => {
    it('a project member (viewer) can read roadmap children', async () => {
      await request(h.server())
        .get(`/api/roadmaps/${roadmapId}/milestones`)
        .set(auth(viewer.token))
        .expect(200);
    });

    it('an outsider gets 404 reading roadmap children (no existence leak)', async () => {
      await request(h.server())
        .get(`/api/roadmaps/${roadmapId}/milestones`)
        .set(auth(outsider.token))
        .expect(404);
    });

    it('a user cannot enumerate another registered user’s roadmaps (403)', async () => {
      await request(h.server())
        .get(`/api/roadmaps/user/${owner.id}`)
        .set(auth(outsider.token))
        .expect(403);
    });

    it('listing your own roadmaps is allowed', async () => {
      await request(h.server())
        .get(`/api/roadmaps/user/${owner.id}`)
        .set(auth(owner.token))
        .expect(200);
    });

    it('listing a guest profile’s roadmaps is allowed (migration preview)', async () => {
      await request(h.server())
        .get(`/api/roadmaps/user/${guest.id}`)
        .set(auth(outsider.token))
        .expect(200);
    });
  });

  // ── G2: AI context reads are view-level ──────────────────────────────────
  describe('G2 AI context view-level', () => {
    it('a viewer can read the AI context summary', async () => {
      await request(h.server())
        .get(`/api/roadmaps/${roadmapId}/ai/context/summary`)
        .set(auth(viewer.token))
        .expect(200);
    });

    it('an outsider is denied the AI context summary (403)', async () => {
      await request(h.server())
        .get(`/api/roadmaps/${roadmapId}/ai/context/summary`)
        .set(auth(outsider.token))
        .expect(403);
    });
  });

  // ── G6: task assignment requires roadmap.assign ──────────────────────────
  describe('G6 roadmap.assign enforcement', () => {
    it('an editor without roadmap.assign cannot change assignees (403)', async () => {
      await request(h.server())
        .patch(`/api/tasks/${taskId}`)
        .set(auth(editorNoAssign.token))
        .send({ assignee_ids: [viewer.id] })
        .expect(403);
    });

    it('the same editor can still make a non-assignment edit (200)', async () => {
      await request(h.server())
        .patch(`/api/tasks/${taskId}`)
        .set(auth(editorNoAssign.token))
        .send({ title: 'renamed by editor' })
        .expect(200);
    });

    it('the owner (has roadmap.assign) can change assignees (200)', async () => {
      await request(h.server())
        .patch(`/api/tasks/${taskId}`)
        .set(auth(owner.token))
        .send({ assignee_ids: [viewer.id] })
        .expect(200);
    });
  });

  // ── G3: dependency delete — binding + authz ──────────────────────────────
  describe('G3 dependency delete authorization', () => {
    it('an outsider cannot delete a dependency (403)', async () => {
      await request(h.server())
        .delete(`/api/tasks/${taskId}/dependencies/${dependencyId}`)
        .set(auth(outsider.token))
        .expect(403);
    });

    it('a viewer (no edit) cannot delete a dependency (403)', async () => {
      await request(h.server())
        .delete(`/api/tasks/${taskId}/dependencies/${dependencyId}`)
        .set(auth(viewer.token))
        .expect(403);
    });

    it('a dependency not belonging to the task is 404 even for the owner', async () => {
      await request(h.server())
        .delete(`/api/tasks/${taskId}/dependencies/${otherDependencyId}`)
        .set(auth(owner.token))
        .expect(404);
    });

    it('the owner can delete a dependency that belongs to the task (204)', async () => {
      await request(h.server())
        .delete(`/api/tasks/${taskId}/dependencies/${dependencyId}`)
        .set(auth(owner.token))
        .expect(204);
    });
  });
});
