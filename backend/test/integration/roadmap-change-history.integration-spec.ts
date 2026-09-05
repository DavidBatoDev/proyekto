/**
 * Real-DB test for the durable roadmap change history (Phase 4a) against the
 * live SG project.
 *
 * What this proves that a mocked test could not: that the operations payload
 * actually round-trips through jsonb, that the RLS policy on the new table
 * really scopes reads to people who can view the roadmap, and that a personal
 * (project-less) roadmap now gets a durable row where previously it got nothing
 * anywhere.
 *
 * MCP_ENABLED is forced on for this process only. Self-cleaning via Harness —
 * roadmap_change_history CASCADEs from roadmaps, which the harness tracks.
 */
process.env.MCP_ENABLED = 'true';

import request from 'supertest';
import { Harness } from './harness';

jest.setTimeout(120000);

const MCP_ACCEPT = 'application/json, text/event-stream';
const epicOp = (title: string) => ({ op: 'add_epic', data: { title } });

async function poll<T>(
  fn: () => Promise<T | null>,
  attempts = 25,
  delayMs = 300,
): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

describe('Durable roadmap change history (Phase 4a)', () => {
  const h = new Harness();
  let idCounter = 1;

  let owner: Awaited<ReturnType<Harness['createUser']>>;
  let outsider: Awaited<ReturnType<Harness['createUser']>>;
  let projectId: string;
  let roadmapId: string;
  let personalRoadmapId: string;
  let pat: string;

  const call = (name: string, args: Record<string, unknown>) =>
    request(h.server())
      .post('/mcp')
      .set('Authorization', `Bearer ${pat}`)
      .set('Accept', MCP_ACCEPT)
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: idCounter++,
        method: 'tools/call',
        params: { name, arguments: args },
      });

  const parse = (res: request.Response) =>
    JSON.parse(res.body.result.content[0].text);
  const isError = (res: request.Response) => res.body.result?.isError === true;

  const commitEpic = async (targetRoadmapId: string, title: string) => {
    const previewRes = await call('roadmap_preview_operations', {
      roadmap_id: targetRoadmapId,
      operations: [epicOp(title)],
    }).expect(200);
    expect(isError(previewRes)).toBeFalsy();
    const revisionToken = parse(previewRes).revision_token as string;

    const commitRes = await call('roadmap_commit_operations', {
      roadmap_id: targetRoadmapId,
      operations: [epicOp(title)],
      revision_token: revisionToken,
      idempotency_key: `rch-${title}`,
    }).expect(200);
    if (isError(commitRes)) {
      throw new Error(
        `commit failed: ${commitRes.body.result.content[0].text}`,
      );
    }
    return parse(commitRes).change_id as string;
  };

  const historyRow = (changeId: string) =>
    poll(async () => {
      const { data } = await h.admin
        .from('roadmap_change_history')
        .select('*')
        .eq('change_id', changeId)
        .limit(1);
      return data && data.length ? data[0] : null;
    });

  /**
   * A fresh roadmap per committing test.
   *
   * Not just hygiene: RoadmapAiService caches its authz decision (which carries
   * the roadmap's updated_at) for a short TTL, so two commits to the SAME
   * roadmap in quick succession make the second one fail STALE_REVISION against
   * a stale cached token. That is a pre-existing bug on the commit path, not
   * something this table introduced — reusing one roadmap here would test the
   * bug instead of the history.
   */
  // A project holds at most one linked roadmap (uq_roadmaps_project_id_linked),
  // so every fresh roadmap gets its own owner-granted project.
  const freshRoadmap = async () => {
    const freshProjectId = await h.createProject(owner.id, 'itest rch project');
    await h.grantAccess(freshProjectId, owner.id, 'owner');
    return h.createRoadmap(owner.id, freshProjectId);
  };

  beforeAll(async () => {
    await h.boot();
    owner = await h.createUser('rch-owner');
    outsider = await h.createUser('rch-outsider');
    projectId = await h.createProject(owner.id);
    await h.grantAccess(projectId, owner.id, 'owner');
    roadmapId = await h.createRoadmap(owner.id, projectId);
    personalRoadmapId = await h.createRoadmap(owner.id, null);

    pat = (
      await h.createMcpToken(owner.id, ['roadmaps:read', 'roadmaps:write'])
    ).raw;
  });

  afterAll(async () => {
    await h.cleanup();
    await h.close();
  });

  it('records a committed change durably, operations payload and all', async () => {
    const title = `rch-commit-${h.runId}`;
    const changeId = await commitEpic(roadmapId, title);

    const row = await historyRow(changeId);
    expect(row).toBeTruthy();
    expect(row.roadmap_id).toBe(roadmapId);
    expect(row.project_id).toBe(projectId);
    expect(row.actor_id).toBe(owner.id);
    expect(row.status).toBe('applied');
    expect(row.operations_count).toBe(1);
    expect(row.operations_hash).toBeTruthy();
    expect(row.revision_token_before).toBeTruthy();
    expect(row.revision_token_after).toBeTruthy();

    // The operations array is the thing project_activity_log throws away
    // (it keeps only a hash), so assert it really survives the jsonb round-trip.
    expect(Array.isArray(row.operations)).toBe(true);
    expect(row.operations).toHaveLength(1);
    expect(row.operations[0].op).toBe('add_epic');
    expect(row.operations[0].data.title).toBe(title);
  });

  it('gives a personal roadmap a row with a null project_id', async () => {
    // Before this table, a project-less roadmap produced no durable record at
    // all: both AuditService call sites are wrapped in `if (project_id)`.
    const changeId = await commitEpic(
      personalRoadmapId,
      `rch-personal-${h.runId}`,
    );

    const row = await historyRow(changeId);
    expect(row).toBeTruthy();
    expect(row.roadmap_id).toBe(personalRoadmapId);
    expect(row.project_id).toBeNull();
    expect(row.actor_id).toBe(owner.id);
  });

  it('lists changes through roadmap_list_changes, withholding operations by default', async () => {
    const listRoadmapId = await freshRoadmap();
    const title = `rch-list-${h.runId}`;
    const changeId = await commitEpic(listRoadmapId, title);
    await historyRow(changeId);

    const listRes = await call('roadmap_list_changes', {
      roadmap_id: listRoadmapId,
    }).expect(200);
    expect(isError(listRes)).toBeFalsy();

    const changes = parse(listRes).changes as any[];
    const found = changes.find((c) => c.change_id === changeId);
    expect(found).toBeTruthy();
    expect(found.operations_count).toBe(1);
    expect(found.status).toBe('applied');
    // Large payload withheld unless explicitly requested.
    expect(found.operations).toBeUndefined();

    const withOps = await call('roadmap_list_changes', {
      roadmap_id: listRoadmapId,
      include_operations: true,
    }).expect(200);
    const withOpsFound = (parse(withOps).changes as any[]).find(
      (c) => c.change_id === changeId,
    );
    expect(Array.isArray(withOpsFound.operations)).toBe(true);
    expect(withOpsFound.operations[0].data.title).toBe(title);
  });

  it('marks a reverted change discarded and writes the audit row that was previously missing', async () => {
    const revertRoadmapId = await freshRoadmap();
    const changeId = await commitEpic(revertRoadmapId, `rch-revert-${h.runId}`);
    await historyRow(changeId);

    const revertRes = await call('roadmap_revert_change', {
      roadmap_id: revertRoadmapId,
      change_id: changeId,
    }).expect(200);
    expect(isError(revertRes)).toBeFalsy();

    const discarded = await poll<any>(async () => {
      const { data } = await h.admin
        .from('roadmap_change_history')
        .select('status, discarded_at, discarded_by')
        .eq('change_id', changeId)
        .eq('status', 'discarded')
        .limit(1);
      return data && data.length ? data[0] : null;
    });
    expect(discarded).toBeTruthy();
    expect(discarded.discarded_by).toBe(owner.id);
    expect(discarded.discarded_at).toBeTruthy();

    // discard() previously logged nothing at all — the one mutating path with
    // no durable trail, and the exact path roadmap_revert_change calls.
    const { data: revertRoadmap } = await h.admin
      .from('roadmaps')
      .select('project_id')
      .eq('id', revertRoadmapId)
      .single();
    const auditRow = await poll(async () => {
      const { data } = await h.admin
        .from('project_activity_log')
        .select('id, metadata')
        .eq('project_id', revertRoadmap?.project_id as string)
        .eq('action', 'roadmap.reverted')
        .eq('entity_id', revertRoadmapId)
        .limit(1);
      return data && data.length ? data[0] : null;
    });
    expect(auditRow).toBeTruthy();
  });

  it('scopes reads by RLS: a roadmap viewer sees rows, an outsider sees none', async () => {
    const rlsRoadmapId = await freshRoadmap();
    const changeId = await commitEpic(rlsRoadmapId, `rch-rls-${h.runId}`);
    await historyRow(changeId);

    // Service role bypasses RLS, so this must go through real user JWTs.
    const ownerClient = h.userClient(h.mintToken(owner.id, owner.email));
    const { data: ownerRows, error: ownerErr } = await ownerClient
      .from('roadmap_change_history')
      .select('change_id')
      .eq('roadmap_id', rlsRoadmapId);
    expect(ownerErr).toBeNull();
    expect((ownerRows ?? []).some((r) => r.change_id === changeId)).toBe(true);

    const outsiderClient = h.userClient(
      h.mintToken(outsider.id, outsider.email),
    );
    const { data: outsiderRows } = await outsiderClient
      .from('roadmap_change_history')
      .select('change_id')
      .eq('roadmap_id', rlsRoadmapId);
    expect(outsiderRows ?? []).toHaveLength(0);
  });

  it('denies a token without roadmaps:read', async () => {
    const readlessPat = (await h.createMcpToken(owner.id, ['projects:read']))
      .raw;
    const res = await request(h.server())
      .post('/mcp')
      .set('Authorization', `Bearer ${readlessPat}`)
      .set('Accept', MCP_ACCEPT)
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: idCounter++,
        method: 'tools/call',
        params: {
          name: 'roadmap_list_changes',
          arguments: { roadmap_id: roadmapId },
        },
      })
      .expect(200);

    expect(res.body.result?.isError).toBe(true);
    expect(JSON.parse(res.body.result.content[0].text).error).toBe('FORBIDDEN');
  });
});
