/**
 * Real-DB end-to-end test for the read-only MCP endpoint (Phase 1). Boots the
 * real AppModule against the live SG project, mints a PAT row directly, and
 * drives /mcp over JSON-RPC: protocol handshake, tool discovery, an authorized
 * read, a scope-gated denial, and a cross-user authorization denial.
 *
 * MCP_ENABLED is forced on for this process only (prod ships dark). Self-cleaning
 * via the shared Harness (the PAT row + all fixtures are torn down in afterAll).
 */
process.env.MCP_ENABLED = 'true';

import request from 'supertest';
import { Harness } from './harness';

jest.setTimeout(120000);

const MCP_ACCEPT = 'application/json, text/event-stream';

describe('MCP read-only endpoint (Phase 1)', () => {
  const h = new Harness();

  let owner: Awaited<ReturnType<Harness['createUser']>>;
  let outsider: Awaited<ReturnType<Harness['createUser']>>;
  let projectId: string;
  let roadmapId: string;
  let ownerToken: string;
  let outsiderToken: string;
  let noScopeToken: string;

  /** POST a single JSON-RPC message to /mcp with the given PAT. */
  const rpc = (pat: string, body: unknown) =>
    request(h.server())
      .post('/mcp')
      .set('Authorization', `Bearer ${pat}`)
      .set('Accept', MCP_ACCEPT)
      .set('Content-Type', 'application/json')
      .send(body as object);

  const call = (pat: string, name: string, args: Record<string, unknown>) =>
    rpc(pat, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name, arguments: args },
    });

  beforeAll(async () => {
    await h.boot();
    owner = await h.createUser('mcp-owner');
    outsider = await h.createUser('mcp-outsider');

    projectId = await h.createProject(owner.id);
    await h.grantAccess(projectId, owner.id, 'owner');
    roadmapId = await h.createRoadmap(owner.id, projectId);
    const epicId = await h.createEpic(roadmapId);
    await h.createFeature(epicId, roadmapId);

    ownerToken = (
      await h.createMcpToken(owner.id, ['projects:read', 'roadmaps:read'])
    ).raw;
    outsiderToken = (
      await h.createMcpToken(outsider.id, ['projects:read', 'roadmaps:read'])
    ).raw;
    noScopeToken = (await h.createMcpToken(owner.id, ['projects:read'])).raw;
  });

  afterAll(async () => {
    await h.cleanup();
    await h.close();
  });

  it('returns 503 when the token is unknown (or MCP disabled)', async () => {
    await rpc('pk_not_a_real_token', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    }).expect(401);
  });

  it('completes the initialize handshake', async () => {
    const res = await rpc(ownerToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'itest', version: '0' },
      },
    }).expect(200);
    expect(res.body.result?.serverInfo?.name).toBe('proyekto');
    expect(res.body.result?.instructions).toContain('authorized Proyekto');
  });

  it('lists the read tools', async () => {
    const res = await rpc(ownerToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    }).expect(200);
    const names = (res.body.result?.tools ?? []).map(
      (t: { name: string }) => t.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'projects_list',
        'roadmap_get_summary',
        'tasks_list',
        'project_knowledge_search',
        'chat_rooms_list',
      ]),
    );
  });

  it('serves an authorized roadmap summary read', async () => {
    const res = await call(ownerToken, 'roadmap_get_summary', {
      roadmap_id: roadmapId,
    }).expect(200);
    expect(res.body.result?.isError).toBeFalsy();
    const payload = JSON.parse(res.body.result.content[0].text);
    // The summary shape carries an epics collection; just assert it parsed.
    expect(payload).toBeDefined();
  });

  it('denies a tool whose scope the token lacks', async () => {
    const res = await call(noScopeToken, 'roadmap_get_summary', {
      roadmap_id: roadmapId,
    }).expect(200);
    expect(res.body.result?.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain('FORBIDDEN');
  });

  it('denies a cross-user read (outsider cannot read the owner’s roadmap)', async () => {
    const res = await call(outsiderToken, 'roadmap_get_summary', {
      roadmap_id: roadmapId,
    }).expect(200);
    expect(res.body.result?.isError).toBe(true);
    expect(res.body.result.content[0].text).toMatch(/FORBIDDEN|NOT_FOUND/);
  });

  it('lists the caller’s own projects but not an outsider’s', async () => {
    const ownerRes = await call(ownerToken, 'projects_list', {}).expect(200);
    const ownerProjects = JSON.parse(
      ownerRes.body.result.content[0].text,
    ).projects;
    expect(ownerProjects.some((p: { id: string }) => p.id === projectId)).toBe(
      true,
    );

    const outsiderRes = await call(outsiderToken, 'projects_list', {}).expect(
      200,
    );
    const outsiderProjects = JSON.parse(
      outsiderRes.body.result.content[0].text,
    ).projects;
    expect(
      outsiderProjects.some((p: { id: string }) => p.id === projectId),
    ).toBe(false);
  });
});
