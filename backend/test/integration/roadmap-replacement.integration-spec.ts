import request from 'supertest';
import { Harness } from './harness';

jest.setTimeout(120000);

describe('Project roadmap replacement (real database)', () => {
  const h = new Harness();
  let owner: Awaited<ReturnType<Harness['createUser']>>;
  let outsider: Awaited<ReturnType<Harness['createUser']>>;

  beforeAll(async () => {
    await h.boot();
    owner = await h.createUser('replacement-owner');
    outsider = await h.createUser('replacement-outsider');
  });
  afterAll(async () => {
    await h.cleanup();
    await h.close();
  });

  const fixture = async () => {
    const projectId = await h.createProject(owner.id);
    await h.grantAccess(projectId, owner.id, 'owner');
    const currentId = await h.createRoadmap(owner.id, projectId);
    const replacementId = await h.createRoadmap(owner.id);
    return { projectId, currentId, replacementId };
  };
  const replace = (
    projectId: string,
    replacementId: string,
    token = owner.token,
  ) =>
    request(h.server())
      .post('/api/roadmaps/replace-for-project')
      .set('Authorization', `Bearer ${token}`)
      .send({ project_id: projectId, replacement_roadmap_id: replacementId });

  const row = async (id: string) => {
    const { data, error } = await h.admin
      .from('roadmaps')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  };

  it('replaces an empty roadmap without violating project uniqueness and preserves replacement children', async () => {
    const { projectId, currentId, replacementId } = await fixture();
    const epicId = await h.createEpic(replacementId);
    const response = await replace(projectId, replacementId).expect(200);
    expect(response.body.data.id).toBe(replacementId);
    expect(await row(currentId)).toBeNull();
    expect((await row(replacementId))?.project_id).toBe(projectId);
    const { data, error } = await h.admin
      .from('roadmap_epics')
      .select('roadmap_id')
      .eq('id', epicId)
      .single();
    expect(error).toBeNull();
    expect(data?.roadmap_id).toBe(replacementId);
  });

  it('keeps both roadmaps when the current roadmap has content', async () => {
    const { projectId, currentId, replacementId } = await fixture();
    await h.createEpic(currentId);
    await replace(projectId, replacementId).expect(400);
    expect((await row(currentId))?.project_id).toBe(projectId);
    expect((await row(replacementId))?.project_id).toBeNull();
  });

  it('requires project permission and ownership of the replacement', async () => {
    const { projectId, currentId, replacementId } = await fixture();
    await replace(projectId, replacementId, outsider.token).expect(403);
    const foreignId = await h.createRoadmap(outsider.id);
    await replace(projectId, foreignId).expect(403);
    expect((await row(currentId))?.project_id).toBe(projectId);
    expect((await row(foreignId))?.project_id).toBeNull();
  });

  it('rejects a stale current roadmap when concurrent swaps compete', async () => {
    const { projectId, currentId, replacementId } = await fixture();
    const otherId = await h.createRoadmap(owner.id);
    const swap = (id: string) =>
      h.admin.rpc('replace_project_roadmap', {
        p_project_id: projectId,
        p_current_roadmap_id: currentId,
        p_replacement_roadmap_id: id,
        p_user_id: owner.id,
      });
    const results = await Promise.all([swap(replacementId), swap(otherId)]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.find((r) => r.error)?.error?.code).toBe('PT409');
    const rows = await Promise.all([row(replacementId), row(otherId)]);
    expect(rows.filter((r) => r?.project_id === projectId)).toHaveLength(1);
    expect(rows.filter((r) => r?.project_id === null)).toHaveLength(1);
  });

  it('rechecks emptiness inside the transaction even if service validation was stale', async () => {
    const { projectId, currentId, replacementId } = await fixture();
    await h.createEpic(currentId);
    const { error } = await h.admin.rpc('replace_project_roadmap', {
      p_project_id: projectId,
      p_current_roadmap_id: currentId,
      p_replacement_roadmap_id: replacementId,
      p_user_id: owner.id,
    });
    expect(error?.code).toBe('22023');
    expect((await row(currentId))?.project_id).toBe(projectId);
    expect((await row(replacementId))?.project_id).toBeNull();
  });
});
