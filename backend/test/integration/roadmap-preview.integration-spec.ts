/**
 * Real-DB coverage for the public share-link preview endpoint behind
 * /roadmap/preview/:roadmapId/:nodeId (web/worker.ts).
 *
 * Exists because the task branch shipped selecting `roadmap_tasks.roadmap_id`,
 * a column that does not exist — every task share link 500'd in prod and the
 * mocked unit spec could not see it. Each node type is exercised against the
 * live schema here so a wrong column or embed breaks locally, not in prod.
 */
import request from 'supertest';
import { Harness } from './harness';

describe('GET /api/roadmap-shares/preview/:roadmapId/:nodeId (real DB)', () => {
  const h = new Harness();
  let owner: Awaited<ReturnType<Harness['createUser']>>;
  let roadmapId: string;
  let otherRoadmapId: string;
  let epicId: string;
  let featureId: string;
  let taskId: string;

  const url = (rid: string, nid: string) =>
    `/api/roadmap-shares/preview/${rid}/${nid}`;

  beforeAll(async () => {
    await h.boot();
    owner = await h.createUser('preview-owner');
    const projectId = await h.createProject(owner.id);
    await h.grantAccess(projectId, owner.id, 'owner');
    roadmapId = await h.createRoadmap(owner.id, projectId);
    epicId = await h.createEpic(roadmapId);
    featureId = await h.createFeature(epicId, roadmapId);
    taskId = await h.createTask(featureId, 0, { title: 'preview task' });

    const otherProjectId = await h.createProject(owner.id);
    await h.grantAccess(otherProjectId, owner.id, 'owner');
    otherRoadmapId = await h.createRoadmap(owner.id, otherProjectId);
  });

  afterAll(async () => {
    await h.cleanup();
    await h.close();
  });

  it.each([
    ['epic', () => epicId, 'itest epic'],
    ['feature', () => featureId, 'itest feature'],
    ['task', () => taskId, 'preview task'],
  ])('resolves a %s node without auth', async (type, id, title) => {
    const res = await request(h.server()).get(url(roadmapId, id()));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      roadmapId,
      nodeId: id(),
      nodeType: type,
      title,
    });
  });

  it('404s a task when the roadmap in the URL is not its own', async () => {
    const res = await request(h.server()).get(url(otherRoadmapId, taskId));
    expect(res.status).toBe(404);
  });

  it('404s an unknown node id', async () => {
    const res = await request(h.server()).get(
      url(roadmapId, '00000000-0000-0000-0000-000000000000'),
    );
    expect(res.status).toBe(404);
  });
});
