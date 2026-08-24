/**
 * Real-DB test for the delivery-governance MCP surface — deliverables, change
 * requests, the risk & issue register, and the decision log.
 *
 * MCP_ENABLED is forced on for this process only. There is deliberately NO
 * second flag: unlike chat writes, delivery ships flagless, so the gates under
 * test are the scope, the live project permission, and the per-row visibility
 * rules. Self-cleaning via Harness.
 */
process.env.MCP_ENABLED = 'true';

import request from 'supertest';
import { Harness } from './harness';

jest.setTimeout(180000);

const MCP_ACCEPT = 'application/json, text/event-stream';

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

describe('MCP delivery governance', () => {
  const h = new Harness();
  let idCounter = 1;

  let owner: Awaited<ReturnType<Harness['createUser']>>;
  let editor: Awaited<ReturnType<Harness['createUser']>>;
  let outsider: Awaited<ReturnType<Harness['createUser']>>;
  let projectId: string;
  let roadmapId: string;

  // owner: admin-tier — holds change_requests.decide, risks.view_internal,
  // decisions.view_internal. editor: holds risks.edit / decisions.edit but
  // NEITHER view_internal key, which is the interesting case.
  let ownerPat: string;
  let editorPat: string;
  let readOnlyPat: string;
  let outsiderPat: string;

  const call = (
    pat: string,
    name: string,
    args: Record<string, unknown>,
  ): request.Test =>
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
  const errorCode = (res: request.Response) => parse(res).error as string;

  beforeAll(async () => {
    await h.boot();
    owner = await h.createUser('dlv-owner');
    editor = await h.createUser('dlv-editor');
    outsider = await h.createUser('dlv-outsider');

    projectId = await h.createProject(owner.id);
    await h.grantAccess(projectId, owner.id, 'owner');
    await h.grantAccess(projectId, editor.id, 'editor');
    roadmapId = await h.createRoadmap(owner.id, projectId);

    ownerPat = (
      await h.createMcpToken(owner.id, [
        'projects:read',
        'delivery:read',
        'delivery:write',
        'roadmaps:read',
        'roadmaps:write',
      ])
    ).raw;
    editorPat = (
      await h.createMcpToken(editor.id, ['delivery:read', 'delivery:write'])
    ).raw;
    readOnlyPat = (await h.createMcpToken(owner.id, ['delivery:read'])).raw;
    outsiderPat = (
      await h.createMcpToken(outsider.id, ['delivery:read', 'delivery:write'])
    ).raw;
  });

  afterAll(async () => {
    await h.cleanup();
  });

  it('advertises the delivery tools in tools/list', async () => {
    const res = await request(h.server())
      .post('/mcp')
      .set('Authorization', `Bearer ${ownerPat}`)
      .set('Accept', MCP_ACCEPT)
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: idCounter++, method: 'tools/list' });

    const names = (res.body.result.tools as Array<{ name: string }>).map(
      (t) => t.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'deliverables_list',
        'change_requests_list',
        'risks_list',
        'risk_get',
        'decisions_list',
        'decision_categories_list',
        'change_request_decide',
        'decision_finalize',
      ]),
    );
    // No delete tools anywhere on this surface.
    expect(
      names.filter((n) =>
        /^(deliverable|change_request|risk|decision)_(remove|delete)/.test(n),
      ),
    ).toEqual([]);
  });

  describe('gates', () => {
    it('denies a write to a delivery:read-only token', async () => {
      const res = await call(readOnlyPat, 'risk_create', {
        project_id: projectId,
        kind: 'issue',
        title: 'should not exist',
      });

      expect(isError(res)).toBe(true);
      expect(errorCode(res)).toBe('FORBIDDEN');

      const { data } = await h.admin
        .from('project_risk_register')
        .select('id')
        .eq('project_id', projectId)
        .eq('title', 'should not exist');
      expect(data ?? []).toHaveLength(0);
    });

    it('answers NOT_FOUND, never FORBIDDEN, to a non-member', async () => {
      // A FORBIDDEN here would confirm to an outsider that the project exists.
      const res = await call(outsiderPat, 'deliverables_list', {
        project_id: projectId,
      });

      expect(isError(res)).toBe(true);
      expect(errorCode(res)).toBe('NOT_FOUND');
    });
  });

  describe('internal visibility', () => {
    let internalRiskId: string;

    it('withholds an internal risk from an editor without risks.view_internal', async () => {
      const created = parse(
        await call(ownerPat, 'risk_create', {
          project_id: projectId,
          kind: 'risk',
          title: 'Vendor may rate-limit us',
          likelihood: 'medium',
          severity: 'high',
        }),
      );
      internalRiskId = created.risk.id as string;
      // No visibility passed — the service default must win.
      expect(created.risk.visibility).toBe('internal');

      const list = parse(
        await call(editorPat, 'risks_list', { project_id: projectId }),
      );
      expect(list.can_view_internal).toBe(false);
      expect(
        (list.risks as Array<{ id: string }>).map((r) => r.id),
      ).not.toContain(internalRiskId);

      const get = await call(editorPat, 'risk_get', {
        project_id: projectId,
        risk_id: internalRiskId,
      });
      expect(errorCode(get)).toBe('NOT_FOUND');
    });

    it('shows the same row to the owner, who holds risks.view_internal', async () => {
      const list = parse(
        await call(ownerPat, 'risks_list', { project_id: projectId }),
      );
      expect(list.can_view_internal).toBe(true);
      expect((list.risks as Array<{ id: string }>).map((r) => r.id)).toContain(
        internalRiskId,
      );
    });

    it('404s decision_update on an internal decision for an unprivileged editor', async () => {
      // Locks the DecisionsService fix: before it, the mutation paths skipped
      // the visibility gate that `get` applied, and returned the full row.
      const created = parse(
        await call(ownerPat, 'decision_create', {
          project_id: projectId,
          title: 'Internal pricing floor',
          decision: 'Hold at the current rate card.',
          status: 'final',
          visibility: 'internal',
        }),
      );

      const res = await call(editorPat, 'decision_update', {
        project_id: projectId,
        decision_id: created.decision.id,
        title: 'Renamed by someone who cannot see it',
      });

      expect(errorCode(res)).toBe('NOT_FOUND');
    });
  });

  describe('deliverables', () => {
    it('never returns a reviewer email address', async () => {
      const created = parse(
        await call(ownerPat, 'deliverable_create', {
          project_id: projectId,
          title: 'Design system v1',
          criteria: ['Tokens documented'],
        }),
      );
      const deliverableId = created.deliverable.id as string;

      // Name a reviewer out of band — the tool deliberately cannot.
      await h.admin.from('deliverable_reviewers').insert({
        deliverable_id: deliverableId,
        reviewer_id: editor.id,
        added_by: owner.id,
      });

      const res = await call(ownerPat, 'deliverable_get', {
        project_id: projectId,
        deliverable_id: deliverableId,
      });
      const raw = res.body.result.content[0].text as string;

      // REVIEWER_PROFILE_COLS selects email/first_name/last_name and the TS
      // type does not declare them, so this assertion is the only guard.
      expect(raw).not.toContain('@');
      expect(raw).not.toContain('first_name');
      expect(raw).not.toContain('avatar_url');
    });
  });

  describe('the change-request apply loop', () => {
    it('walks draft -> submit -> decide -> roadmap commit -> mark_applied', async () => {
      const created = parse(
        await call(ownerPat, 'change_request_create', {
          project_id: projectId,
          title: 'Add an onboarding epic',
          description: 'Client asked for a guided first run.',
          impact_timeline_days: 5,
          roadmap_id: roadmapId,
        }),
      );
      const crId = created.change_request.id as string;
      // create is always a draft: `submit` is never forwarded.
      expect(created.change_request.status).toBe('draft');

      expect(
        parse(
          await call(ownerPat, 'change_request_submit', {
            project_id: projectId,
            change_request_id: crId,
          }),
        ).change_request.status,
      ).toBe('submitted');

      expect(
        parse(
          await call(ownerPat, 'change_request_decide', {
            project_id: projectId,
            change_request_id: crId,
            decision: 'approved',
          }),
        ).change_request.status,
      ).toBe('approved');

      // Approval alone must not have touched the roadmap.
      const revisionToken = await h.roadmapUpdatedAt(roadmapId);
      const operations = [
        {
          op: 'add_epic',
          temp_id: 'e-new',
          data: { title: `Onboarding ${h.runId}` },
        },
      ];
      await call(ownerPat, 'roadmap_preview_operations', {
        roadmap_id: roadmapId,
        operations,
        revision_token: revisionToken,
      });
      const commit = parse(
        await call(ownerPat, 'roadmap_commit_operations', {
          roadmap_id: roadmapId,
          operations,
          revision_token: revisionToken,
          idempotency_key: `cr-apply-${h.runId}`,
        }),
      );

      const applied = parse(
        await call(ownerPat, 'change_request_mark_applied', {
          project_id: projectId,
          change_request_id: crId,
          applied_change_id: commit.change_id,
        }),
      );
      expect(applied.change_request.status).toBe('applied');
    });

    it('rejects a change_id that is not a commit on this project', async () => {
      const created = parse(
        await call(ownerPat, 'change_request_create', {
          project_id: projectId,
          title: 'Second request',
        }),
      );
      const crId = created.change_request.id as string;
      await call(ownerPat, 'change_request_submit', {
        project_id: projectId,
        change_request_id: crId,
      });
      await call(ownerPat, 'change_request_decide', {
        project_id: projectId,
        change_request_id: crId,
        decision: 'approved',
      });

      const res = await call(ownerPat, 'change_request_mark_applied', {
        project_id: projectId,
        change_request_id: crId,
        applied_change_id: '00000000-0000-4000-8000-000000000000',
      });

      expect(isError(res)).toBe(true);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
    });
  });

  describe('provenance', () => {
    it('marks the service’s own audit row as connector-driven, with no mcp.* duplicate', async () => {
      const created = parse(
        await call(ownerPat, 'risk_create', {
          project_id: projectId,
          kind: 'issue',
          title: 'Staging deploy is flaky',
          visibility: 'shared',
        }),
      );
      const riskId = created.risk.id as string;

      const row = await poll(async () => {
        const { data } = await h.admin
          .from('project_activity_log')
          .select('action, metadata')
          .eq('project_id', projectId)
          .eq('entity_id', riskId)
          .eq('action', 'risk.created')
          .maybeSingle();
        return data ?? null;
      });

      expect(row).toBeTruthy();
      const metadata = (row as { metadata: Record<string, unknown> }).metadata;
      expect((metadata.origin as { via: string }).via).toBe('mcp');
      // The register's own rule: never a title in activity metadata, because
      // is_sensitive is per-action while visibility is per-row.
      expect(metadata).not.toHaveProperty('title');

      // Exactly one row — the delivery services self-audit, so a tool-layer
      // write would double-log.
      const { data: all } = await h.admin
        .from('project_activity_log')
        .select('action')
        .eq('project_id', projectId)
        .eq('entity_id', riskId);
      expect(all ?? []).toHaveLength(1);
      expect(
        (all ?? []).filter((r) => (r.action as string).startsWith('mcp.')),
      ).toHaveLength(0);
    });
  });
});
