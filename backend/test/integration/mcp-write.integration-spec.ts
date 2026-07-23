/**
 * Real-DB end-to-end test for the MCP write tools (Phase 2) against the live SG
 * project. Mints write-scoped and read-only PATs, drives /mcp over JSON-RPC:
 * the preview→commit→revert roadmap-ops lifecycle, STALE_REVISION on a stale
 * token, the direct task_create→task_assign path, and read-only denial.
 *
 * MCP_ENABLED is forced on for this process only. Self-cleaning via Harness.
 */
process.env.MCP_ENABLED = 'true';

import request from 'supertest';
import { Harness } from './harness';

jest.setTimeout(120000);

const MCP_ACCEPT = 'application/json, text/event-stream';
const epicOp = (title: string) => ({ op: 'add_epic', data: { title } });

async function poll<T>(
  fn: () => Promise<T | null>,
  attempts = 20,
  delayMs = 300,
): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

describe('MCP write tools (Phase 2)', () => {
  const h = new Harness();
  let idCounter = 1;

  let owner: Awaited<ReturnType<Harness['createUser']>>;
  let viewer: Awaited<ReturnType<Harness['createUser']>>;
  let projectId: string;
  let roadmapId: string;
  let featureId: string;
  let writePat: string;
  let readPat: string;

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
      id: idCounter++,
      method: 'tools/call',
      params: { name, arguments: args },
    });

  const parse = (res: request.Response) =>
    JSON.parse(res.body.result.content[0].text);
  const isError = (res: request.Response) => res.body.result?.isError === true;

  beforeAll(async () => {
    await h.boot();
    owner = await h.createUser('mcpw-owner');
    viewer = await h.createUser('mcpw-viewer');
    projectId = await h.createProject(owner.id);
    await h.grantAccess(projectId, owner.id, 'owner');
    await h.grantAccess(projectId, viewer.id, 'viewer');
    roadmapId = await h.createRoadmap(owner.id, projectId);
    const epicId = await h.createEpic(roadmapId);
    featureId = await h.createFeature(epicId, roadmapId);

    writePat = (
      await h.createMcpToken(owner.id, [
        'roadmaps:read',
        'roadmaps:write',
        'tasks:write',
        'tasks:assign',
      ])
    ).raw;
    readPat = (await h.createMcpToken(owner.id, ['roadmaps:read'])).raw;
  });

  afterAll(async () => {
    await h.cleanup();
    await h.close();
  });

  it('previews, commits, and reverts an epic (roadmap-ops lifecycle)', async () => {
    const title = `mcp-e2e-${h.runId}`;

    // preview → get a revision_token
    const previewRes = await call(writePat, 'roadmap_preview_operations', {
      roadmap_id: roadmapId,
      operations: [epicOp(title)],
    }).expect(200);
    expect(isError(previewRes)).toBeFalsy();
    const revisionToken = parse(previewRes).revision_token as string;
    expect(revisionToken).toBeTruthy();

    // commit with that token + an idempotency key
    const commitRes = await call(writePat, 'roadmap_commit_operations', {
      roadmap_id: roadmapId,
      operations: [epicOp(title)],
      revision_token: revisionToken,
      idempotency_key: `mcpw-${h.runId}`,
    }).expect(200);
    expect(isError(commitRes)).toBeFalsy();
    const changeId = parse(commitRes).change_id as string;
    expect(changeId).toBeTruthy();

    // the epic now exists
    const created = await poll(async () => {
      const { data } = await h.admin
        .from('roadmap_epics')
        .select('id')
        .eq('roadmap_id', roadmapId)
        .eq('title', title)
        .limit(1);
      return data && data.length ? data[0] : null;
    });
    expect(created).toBeTruthy();

    // a commit audit row was written
    const auditRow = await poll(async () => {
      const { data } = await h.admin
        .from('project_activity_log')
        .select('id')
        .eq('project_id', projectId)
        .eq('action', 'roadmap.committed')
        .eq('entity_id', roadmapId)
        .limit(1);
      return data && data.length ? data[0] : null;
    });
    expect(auditRow).toBeTruthy();

    // revert (undo) the change → the epic is gone again
    const revertRes = await call(writePat, 'roadmap_revert_change', {
      roadmap_id: roadmapId,
      change_id: changeId,
    }).expect(200);
    expect(isError(revertRes)).toBeFalsy();

    // Revert is synchronous (the tool awaits the DB write) — the epic is gone.
    const { data: afterRevert } = await h.admin
      .from('roadmap_epics')
      .select('id')
      .eq('roadmap_id', roadmapId)
      .eq('title', title);
    expect(afterRevert ?? []).toHaveLength(0);
  });

  it('rejects a commit with a stale revision_token (STALE_REVISION)', async () => {
    const res = await call(writePat, 'roadmap_commit_operations', {
      roadmap_id: roadmapId,
      operations: [epicOp(`stale-${h.runId}`)],
      revision_token: '2000-01-01T00:00:00.000Z',
      idempotency_key: `stale-${h.runId}`,
    }).expect(200);
    expect(isError(res)).toBe(true);
    expect(res.body.result.content[0].text).toContain('STALE_REVISION');
  });

  it('denies a read-only token every write tool', async () => {
    const commit = await call(readPat, 'roadmap_commit_operations', {
      roadmap_id: roadmapId,
      operations: [epicOp('nope')],
      revision_token: 'x',
      idempotency_key: 'y',
    }).expect(200);
    expect(res_isForbidden(commit)).toBe(true);

    const create = await call(readPat, 'task_create', {
      feature_id: featureId,
      title: 'nope',
    }).expect(200);
    expect(res_isForbidden(create)).toBe(true);

    function res_isForbidden(res: request.Response): boolean {
      return (
        res.body.result?.isError === true &&
        res.body.result.content[0].text.includes('FORBIDDEN')
      );
    }
  });

  it('task_create then task_assign syncs the assignee join table', async () => {
    const createRes = await call(writePat, 'task_create', {
      feature_id: featureId,
      title: `mcp-task-${h.runId}`,
    }).expect(200);
    expect(isError(createRes)).toBeFalsy();
    const taskId = parse(createRes).task.id as string;
    expect(taskId).toBeTruthy();

    const assignRes = await call(writePat, 'task_assign', {
      task_id: taskId,
      assignee_ids: [viewer.id],
    }).expect(200);
    expect(isError(assignRes)).toBeFalsy();

    const assignee = await poll(async () => {
      const { data } = await h.admin
        .from('roadmap_task_assignees')
        .select('assignee_id')
        .eq('task_id', taskId)
        .eq('assignee_id', viewer.id)
        .limit(1);
      return data && data.length ? data[0] : null;
    });
    expect(assignee).toBeTruthy();
  });
});
