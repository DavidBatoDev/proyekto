import { randomUUID } from 'node:crypto';
import { Harness } from './harness';

jest.setTimeout(120000);

describe('production QA fixture registry', () => {
  const h = new Harness();
  const key = `itest-${h.runId}`;
  const primaryTeamId = randomUUID();
  const secondaryTeamId = randomUUID();
  const contractId = randomUUID();
  let projectId: string;
  let consultant: Awaited<ReturnType<Harness['createUser']>>;
  let worker: Awaited<ReturnType<Harness['createUser']>>;
  let client: Awaited<ReturnType<Harness['createUser']>>;

  beforeAll(async () => {
    consultant = await h.createUser('qa-consultant');
    worker = await h.createUser('qa-worker');
    client = await h.createUser('qa-client');
    projectId = await h.createProject(client.id, '[QA] integration fixture');

    await insert('consultant_profiles', {
      user_id: consultant.id,
      status: 'verified',
      verified_at: new Date().toISOString(),
    });
    for (const [id, name, enabled] of [
      [primaryTeamId, '[QA] primary', false],
      [secondaryTeamId, '[QA] secondary', true],
    ] as const) {
      await insert('teams', {
        id,
        owner_id: consultant.id,
        name,
        time_tracking_enabled: enabled,
      });
      await insert('team_members', {
        team_id: id,
        user_id: consultant.id,
        role: 'owner',
      });
      await insert('team_members', {
        team_id: id,
        user_id: worker.id,
        role: 'member',
      });
    }
    await insert('project_teams', {
      project_id: projectId,
      team_id: primaryTeamId,
      is_primary: true,
      attached_by: consultant.id,
    });
    await insert('project_teams', {
      project_id: projectId,
      team_id: secondaryTeamId,
      is_primary: false,
      attached_by: consultant.id,
    });
    // The worker logs time below. Since the time rebuild's M1 migration, the
    // database refuses a time log from someone with no access to the project.
    await h.grantAccess(projectId, worker.id, 'editor');
    await insert('contracts', {
      id: contractId,
      project_id: projectId,
      version: 1,
      status: 'draft',
      consultant_user_id: consultant.id,
      client_user_id: client.id,
      created_by: consultant.id,
    });
    await insert('qa_fixtures', {
      key,
      project_id: projectId,
      contract_id: contractId,
      consultant_user_id: consultant.id,
      worker_user_id: worker.id,
      client_user_id: client.id,
      primary_team_id: primaryTeamId,
      secondary_team_id: secondaryTeamId,
    });
  });

  afterAll(async () => {
    await h.admin.from('qa_fixtures').delete().eq('key', key);
    await h.admin.from('invoices').delete().eq('project_id', projectId);
    // Time goes through the test clean-up RPC: an entry on a submitted or
    // approved sheet is locked, and an emptied sheet is removed with it.
    await h.admin.rpc('time_test_cleanup', { p_project_id: projectId });
    await h.admin.from('contracts').delete().eq('id', contractId);
    await h.admin.from('project_teams').delete().eq('project_id', projectId);
    await h.admin
      .from('team_members')
      .delete()
      .in('team_id', [primaryTeamId, secondaryTeamId]);
    await h.admin
      .from('teams')
      .delete()
      .in('id', [primaryTeamId, secondaryTeamId]);
    await h.admin
      .from('consultant_profiles')
      .delete()
      .eq('user_id', consultant.id);
    await h.cleanup();
  });

  it('is invisible and non-executable to authenticated users', async () => {
    const userDb = h.userClient(worker.token);
    const registry = await userDb.from('qa_fixtures').select('*');
    expect(registry.error).toMatchObject({ code: '42501' });
    expect(registry.data).toBeNull();

    const reset = await userDb.rpc('reset_qa_fixture', {
      p_key: key,
      p_mark_success: false,
    });
    expect(reset.error).not.toBeNull();
  });

  it('atomically deletes transient rows and restores both team flags', async () => {
    // A team-context entry (time_entries, M3). trg_30 files it on the
    // worker's sheet for that period; the reset must remove both.
    const entry = await h.createTimeEntry({
      projectId,
      memberUserId: worker.id,
      teamId: primaryTeamId,
      startedAt: '2026-08-12T09:00:00.000Z',
      endedAt: '2026-08-12T10:00:00.000Z',
      durationSeconds: 3600,
      workItem: 'other',
      source: 'manual',
    });
    expect(entry.context_kind).toBe('team');
    expect(entry.context_ref).toBe(primaryTeamId);
    expect(entry.timesheet_id).toBeTruthy();
    await insert('invoices', {
      project_id: projectId,
      contract_id: contractId,
      issuer_user_id: consultant.id,
      number: `ITEST-${h.runId}`,
      status: 'draft',
      currency: 'USD',
    });

    const reset = await h.admin.rpc('reset_qa_fixture', {
      p_key: key,
      p_mark_success: true,
    });
    expect(reset.error).toBeNull();

    const [entries, sheets, invoices, teams, registry] = await Promise.all([
      h.admin.from('time_entries').select('id').eq('project_id', projectId),
      h.admin.from('timesheets').select('id').eq('member_user_id', worker.id),
      h.admin.from('invoices').select('id').eq('project_id', projectId),
      h.admin
        .from('teams')
        .select('id, time_tracking_enabled')
        .in('id', [primaryTeamId, secondaryTeamId]),
      h.admin
        .from('qa_fixtures')
        .select('last_success_at')
        .eq('key', key)
        .single(),
    ]);
    expect(entries.data).toEqual([]);
    expect(sheets.data).toEqual([]);
    expect(invoices.data).toEqual([]);
    expect(teams.data).toHaveLength(2);
    expect(teams.data?.every((team) => team.time_tracking_enabled)).toBe(true);
    expect(registry.data?.last_success_at).toBeTruthy();
  });

  async function insert(
    table: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await h.admin.from(table).insert(value);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
});
