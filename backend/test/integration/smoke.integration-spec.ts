/**
 * Infra smoke test: proves the harness can boot the real app against the live
 * SG project, mint a token the guard accepts, read a seeded roadmap over HTTP
 * with the production response envelope, and tear the fixtures down. If this
 * fails, none of the per-gap specs can be trusted.
 */
import request from 'supertest';
import { Harness } from './harness';

jest.setTimeout(120000);

describe('integration harness smoke', () => {
  const h = new Harness();
  let owner: Awaited<ReturnType<Harness['createUser']>>;
  let roadmapId: string;

  beforeAll(async () => {
    await h.boot();
    owner = await h.createUser('owner');
    roadmapId = await h.createRoadmap(owner.id);
  });

  afterAll(async () => {
    await h.cleanup();
    await h.close();
  });

  it('the guard rejects an unauthenticated request (401)', async () => {
    await request(h.server()).get(`/api/roadmaps/${roadmapId}`).expect(401);
  });

  it('the owner can read their own roadmap through the {data} envelope', async () => {
    const res = await request(h.server())
      .get(`/api/roadmaps/${roadmapId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data.id).toBe(roadmapId);
  });
});
