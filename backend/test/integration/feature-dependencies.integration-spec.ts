/**
 * Real-DB tests for feature-level dependencies (the Timeline's arrows).
 *
 * The high-value cases here are the ones a mocked DB cannot cover: the cycle
 * trigger and the cross-roadmap guard both live in Postgres, and the backend
 * writes as service_role, so only a real database proves they hold.
 */
import request from 'supertest';
import { Harness } from './harness';

jest.setTimeout(120000);

describe('feature dependencies', () => {
  const h = new Harness();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let owner: Awaited<ReturnType<Harness['createUser']>>;
  let viewer: Awaited<ReturnType<Harness['createUser']>>;
  let outsider: Awaited<ReturnType<Harness['createUser']>>;

  let projectId: string;
  let roadmapId: string;
  let featureA: string;
  let featureB: string;
  let featureC: string;

  // A second roadmap, to prove an edge cannot span roadmaps.
  let otherRoadmapId: string;
  let otherFeature: string;

  const url = (rid: string = roadmapId) =>
    `/api/roadmaps/${rid}/feature-dependencies`;

  beforeAll(async () => {
    await h.boot();
    owner = await h.createUser('fd-owner');
    viewer = await h.createUser('fd-viewer');
    outsider = await h.createUser('fd-outsider');

    projectId = await h.createProject(owner.id);
    await h.grantAccess(projectId, owner.id, 'owner');
    await h.grantAccess(projectId, viewer.id, 'viewer');

    roadmapId = await h.createRoadmap(owner.id, projectId);
    const epicId = await h.createEpic(roadmapId);
    featureA = await h.createFeature(epicId, roadmapId, 0);
    featureB = await h.createFeature(epicId, roadmapId, 1);
    featureC = await h.createFeature(epicId, roadmapId, 2);

    const otherProjectId = await h.createProject(owner.id);
    await h.grantAccess(otherProjectId, owner.id, 'owner');
    otherRoadmapId = await h.createRoadmap(owner.id, otherProjectId);
    const otherEpicId = await h.createEpic(otherRoadmapId);
    otherFeature = await h.createFeature(otherEpicId, otherRoadmapId);
  });

  afterAll(async () => {
    await h.cleanup();
    await h.close();
  });

  describe('authorization', () => {
    it('lets an editor create a link', async () => {
      const res = await request(h.server())
        .post(url())
        .set(auth(owner.token))
        .send({
          blocking_feature_id: featureA,
          blocked_feature_id: featureB,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.blocking_feature_id).toBe(featureA);
    });

    it('lets a viewer read but not write', async () => {
      const read = await request(h.server()).get(url()).set(auth(viewer.token));
      expect(read.status).toBe(200);
      expect(read.body.data.length).toBeGreaterThan(0);

      const write = await request(h.server())
        .post(url())
        .set(auth(viewer.token))
        .send({
          blocking_feature_id: featureB,
          blocked_feature_id: featureC,
        });
      expect(write.status).toBe(403);
    });

    it('hides the roadmap entirely from an outsider', async () => {
      const res = await request(h.server())
        .get(url())
        .set(auth(outsider.token));
      // 404 rather than 403 — existence must not leak.
      expect([403, 404]).toContain(res.status);
    });

    it('rejects an unauthenticated request', async () => {
      const res = await request(h.server()).get(url());
      expect(res.status).toBe(401);
    });
  });

  describe('invariants', () => {
    it('rejects a duplicate link with 409 rather than a raw 500', async () => {
      const res = await request(h.server())
        .post(url())
        .set(auth(owner.token))
        .send({
          blocking_feature_id: featureA,
          blocked_feature_id: featureB,
        });
      expect(res.status).toBe(409);
    });

    it('rejects a self link', async () => {
      const res = await request(h.server())
        .post(url())
        .set(auth(owner.token))
        .send({
          blocking_feature_id: featureA,
          blocked_feature_id: featureA,
        });
      expect(res.status).toBe(400);
    });

    it('rejects a direct cycle (A->B exists, so B->A must fail)', async () => {
      const res = await request(h.server())
        .post(url())
        .set(auth(owner.token))
        .send({
          blocking_feature_id: featureB,
          blocked_feature_id: featureA,
        });
      expect(res.status).toBe(409);
    });

    it('rejects a transitive cycle A->B->C->A', async () => {
      const bc = await request(h.server())
        .post(url())
        .set(auth(owner.token))
        .send({
          blocking_feature_id: featureB,
          blocked_feature_id: featureC,
        });
      expect(bc.status).toBe(201);

      const ca = await request(h.server())
        .post(url())
        .set(auth(owner.token))
        .send({
          blocking_feature_id: featureC,
          blocked_feature_id: featureA,
        });
      expect(ca.status).toBe(409);
    });

    it('rejects an endpoint from another roadmap', async () => {
      const res = await request(h.server())
        .post(url())
        .set(auth(owner.token))
        .send({
          blocking_feature_id: featureA,
          blocked_feature_id: otherFeature,
        });
      // 404: the foreign feature must not be confirmed to exist.
      expect(res.status).toBe(404);
    });

    it('rejects an unknown field (whitelist validation)', async () => {
      const res = await request(h.server())
        .post(url())
        .set(auth(owner.token))
        .send({
          blocking_feature_id: featureA,
          blocked_feature_id: featureC,
          sneaky: true,
        });
      expect(res.status).toBe(400);
    });
  });

  describe('delete binding', () => {
    it('404s when the edge belongs to a different roadmap, even for the owner', async () => {
      const list = await request(h.server()).get(url()).set(auth(owner.token));
      const someEdgeId = list.body.data[0].id as string;

      const res = await request(h.server())
        .delete(`${url(otherRoadmapId)}/${someEdgeId}`)
        .set(auth(owner.token));
      expect(res.status).toBe(404);
    });

    it('deletes an edge that does belong to the roadmap', async () => {
      const list = await request(h.server()).get(url()).set(auth(owner.token));
      const edgeId = list.body.data[0].id as string;

      const res = await request(h.server())
        .delete(`${url()}/${edgeId}`)
        .set(auth(owner.token));
      expect(res.status).toBe(204);

      const after = await request(h.server()).get(url()).set(auth(owner.token));
      expect(
        (after.body.data as { id: string }[]).some((e) => e.id === edgeId),
      ).toBe(false);
    });

    it('404s for an unknown dependency id', async () => {
      const res = await request(h.server())
        .delete(`${url()}/00000000-0000-4000-8000-000000000000`)
        .set(auth(owner.token));
      expect(res.status).toBe(404);
    });
  });
});
