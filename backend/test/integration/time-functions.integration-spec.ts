/**
 * M3 timesheet engine and the M3 rebuilds around it
 * (supabase/migrations/20261003110000_rename_time_entries.sql): real-DB coverage on hosted dev.
 *
 * Covers time_timesheet_transition (submit and its auto/self chain, approve, return, reopen on both
 * paths, request_reopen, submit_on_deletion, the argument checks), the freeze entry-set check, the
 * status mirror (approve, return, reopen; E72a), routing (self, auto, the cost-money 'wait' fallback,
 * time_sheet_routing_preview), time_scope_deciders / time_timesheet_deciders / time_approval_queue_ids,
 * time_stop_running_entries, the payout RPCs on the renamed table, time_policy_delete (D23),
 * reset_qa_fixture and account_deletion_preflight (TEAM_HAS_OPEN_TIME).
 *
 * Every case builds its own fixture through the harness's service-role client (no AppModule boot) and
 * afterAll removes it: time_test_cleanup per project (entries, reservations and the members' emptied
 * sheets, under maintenance), then payouts, the QA registry row, project teams, the harness's LIFO
 * deletes, and the policy audit rows the deletes leave behind.
 *
 * Valid from M3 until M5: it reads and writes time_entries.status (the old backend's per-entry review,
 * and the engine's mirror), which M5 drops. A true legacy-imported sheet (origin 'legacy_migration',
 * decision_kind 'legacy') can only be made under app.time_maintenance, which PostgREST cannot set, so
 * E72a is exercised on an app sheet whose entries were approved per entry before the sheet was approved.
 *
 * Never runs against production (describeDevOnly).
 */
import { randomUUID } from 'crypto';
import { Harness } from './harness';

jest.setTimeout(180000);

const DEV_PROJECT_REF = 'vyiedlwasdwmjbztqznl';
const describeDevOnly = (process.env.SUPABASE_URL ?? '').includes(
  DEV_PROJECT_REF,
)
  ? describe
  : describe.skip;

type User = Awaited<ReturnType<Harness['createUser']>>;

interface Routing {
  base: string;
  cost_money: boolean;
  deciders_count: number;
  fallback: string;
}

interface SheetRow {
  id: string;
  member_user_id: string | null;
  scope_kind: string;
  status: 'open' | 'submitted' | 'returned' | 'approved';
  approver_scope: string | null;
  revision: number;
  submitted_at: string | null;
  submitted_by: string | null;
  submission_kind: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_kind: string | null;
  decision_note: string | null;
  overtime_approved: boolean;
  total_seconds: number | null;
  payable_seconds: number | null;
  period_end: string;
  origin: string;
  policy_snapshot: Record<string, unknown> & { routing?: Routing };
}

interface EntryRow {
  id: string;
  timesheet_id: string | null;
  status: string;
  duration_seconds: number | null;
  payable_seconds: number | null;
  amount_snapshot: number | null;
  rate_snapshot: number;
  rate_type_snapshot: 'hourly' | 'fixed';
  currency_snapshot: string;
  legacy_status: string | null;
  payout_id: string | null;
}

interface EventRow {
  event: string;
  to_status: string;
  revision: number;
  actor_user_id: string | null;
}

interface PgError {
  code?: string;
  message: string;
  details?: string | null;
}

type Freeze = Record<string, Record<string, Record<string, unknown>>>;

const ENTRY_COLUMNS =
  'id, timesheet_id, status, duration_seconds, payable_seconds, amount_snapshot, rate_snapshot, ' +
  'rate_type_snapshot, currency_snapshot, legacy_status, payout_id';

/** Wednesday `hour`:00 UTC of the ISO week `weeksAgo` weeks before this one. */
function pastWednesday(weeksAgo = 2, hour = 9): Date {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour),
  );
  const isoDow = ((d.getUTCDay() + 6) % 7) + 1;
  d.setUTCDate(d.getUTCDate() - (isoDow - 3) - 7 * weeksAgo);
  return d;
}

function parseDetail(error: PgError | null): Record<string, unknown> {
  if (!error?.details) return {};
  try {
    return JSON.parse(error.details) as Record<string, unknown>;
  } catch {
    return { detail: error.details };
  }
}

/** A raised time sentinel: message is the bare code, details is JSON text. */
function expectRaised(
  error: PgError | null,
  code: string,
  detail?: Record<string, unknown>,
): void {
  expect(error).not.toBeNull();
  expect(error?.message).toBe(code);
  if (detail) expect(parseDetail(error)).toMatchObject(detail);
}

describeDevOnly('time engine functions (M3, real DB)', () => {
  const h = new Harness();
  const projects: string[] = [];
  const teams: string[] = [];
  const workspaces: string[] = [];
  const payouts: string[] = [];
  const qaFixtures: Array<{
    key: string;
    contractId: string;
    consultantId: string;
  }> = [];

  // Shared people; every case still builds its own workspace / team / project, so sheets never mix.
  let owner: User;
  let member: User;
  let outsider: User;
  let solo: User;

  beforeAll(async () => {
    owner = await h.createUser('eng-owner');
    member = await h.createUser('eng-member');
    outsider = await h.createUser('eng-outsider');
    solo = await h.createUser('eng-solo');
  });

  afterAll(async () => {
    for (const projectId of projects) {
      try {
        await h.admin.rpc('time_test_cleanup', { p_project_id: projectId });
      } catch {
        /* best-effort */
      }
    }
    try {
      if (payouts.length > 0) {
        await h.admin.from('payouts').delete().in('id', payouts);
      }
      for (const fixture of qaFixtures) {
        await h.admin.from('qa_fixtures').delete().eq('key', fixture.key);
        await h.admin.from('contracts').delete().eq('id', fixture.contractId);
        await h.admin
          .from('consultant_profiles')
          .delete()
          .eq('user_id', fixture.consultantId);
      }
      if (projects.length > 0) {
        await h.admin.from('project_teams').delete().in('project_id', projects);
      }
    } catch {
      /* best-effort */
    }
    await h.cleanup();
    try {
      // Deleting a team or workspace cascades its policy rows, whose audit (D23) outlives them.
      if (teams.length > 0) {
        await h.admin.from('time_policy_events').delete().in('team_id', teams);
      }
      if (workspaces.length > 0) {
        await h.admin
          .from('time_policy_events')
          .delete()
          .in('workspace_id', workspaces);
      }
    } catch {
      /* best-effort */
    }
  });

  // ── fixtures ──────────────────────────────────────────────────────────────

  async function insertRow(
    table: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await h.admin.from(table).insert(value);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }

  /** A workspace owned by `wsOwner` with a project in it; each extra member gets editor access. */
  async function workspaceProject(
    wsOwner: User,
    label: string,
    members: Array<{ user: User; role: 'owner' | 'admin' | 'member' }> = [],
  ): Promise<{ workspaceId: string; projectId: string }> {
    const workspaceId = await h.createWorkspace(wsOwner.id, label);
    workspaces.push(workspaceId);
    for (const m of members) {
      await h.addWorkspaceMember(workspaceId, m.user.id, m.role);
    }
    const projectId = await h.createProject(wsOwner.id);
    projects.push(projectId);
    await h.setProjectWorkspace(projectId, workspaceId);
    for (const m of members) {
      await h.grantAccess(projectId, m.user.id, 'editor');
    }
    return { workspaceId, projectId };
  }

  /** A team owned by `teamOwner` (no workspace unless given) attached as the primary team of a new project. */
  async function teamProject(
    teamOwner: User,
    members: User[],
    opts: {
      workspaceId?: string | null;
      payouts?: boolean;
      rates?: boolean;
      title?: string;
    } = {},
  ): Promise<{ teamId: string; projectId: string }> {
    const teamId = await h.createTeam(teamOwner.id, opts.workspaceId ?? null);
    teams.push(teamId);
    if (opts.payouts || opts.rates) {
      const { error } = await h.admin
        .from('teams')
        .update({
          payouts_enabled: opts.payouts ?? false,
          // teams_payouts_require_rates: payouts need member rates on.
          member_rates_enabled:
            (opts.rates ?? false) || (opts.payouts ?? false),
        })
        .eq('id', teamId);
      if (error) throw new Error(`team flags failed: ${error.message}`);
    }
    for (const m of members) {
      await h.addTeamMember(teamId, m.id, 'member');
    }
    const projectId = await h.createProject(teamOwner.id, opts.title);
    projects.push(projectId);
    if (opts.workspaceId) {
      await h.setProjectWorkspace(projectId, opts.workspaceId);
    }
    await insertRow('project_teams', {
      project_id: projectId,
      team_id: teamId,
      is_primary: true,
      attached_by: teamOwner.id,
    });
    for (const m of members) {
      await h.grantAccess(projectId, m.id, 'editor');
    }
    return { teamId, projectId };
  }

  /** A stopped entry; trg_30 puts it on its sheet. */
  async function logEntry(o: {
    projectId: string;
    user: User;
    context: { kind: 'workspace' | 'team'; id: string };
    start: Date;
    seconds?: number;
    rate?: number;
    rateType?: 'hourly' | 'fixed';
  }): Promise<{ id: string; timesheet_id: string }> {
    const seconds = o.seconds ?? 3600;
    const row: Record<string, unknown> = {
      project_id: o.projectId,
      member_user_id: o.user.id,
      started_at: o.start.toISOString(),
      ended_at: new Date(o.start.getTime() + seconds * 1000).toISOString(),
      duration_seconds: seconds,
      source: 'manual',
      context_kind: o.context.kind,
      context_ref: o.context.id,
      rate_snapshot: o.rate ?? 0,
      rate_type_snapshot: o.rateType ?? 'hourly',
      currency_snapshot: 'USD',
    };
    if (o.context.kind === 'team') row.team_id = o.context.id;
    else row.workspace_id = o.context.id;
    const { data, error } = await h.admin
      .from('time_entries')
      .insert(row)
      .select('id, timesheet_id')
      .single();
    if (error || !data) {
      throw new Error(`time entry insert failed: ${error?.message}`);
    }
    expect(data.timesheet_id).toBeTruthy();
    return data as { id: string; timesheet_id: string };
  }

  /** The old backend's per-entry approval (status stays writable until M5). */
  async function approvePerEntry(entryId: string): Promise<void> {
    const { error } = await h.admin
      .from('time_entries')
      .update({ status: 'approved' })
      .eq('id', entryId);
    if (error) throw new Error(`per-entry approve failed: ${error.message}`);
  }

  async function sheetRow(id: string): Promise<SheetRow> {
    const { data, error } = await h.admin
      .from('timesheets')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) throw new Error(`sheet read failed: ${error?.message}`);
    return data as SheetRow;
  }

  async function entriesOf(sheetId: string): Promise<EntryRow[]> {
    const { data, error } = await h.admin
      .from('time_entries')
      .select(ENTRY_COLUMNS)
      .eq('timesheet_id', sheetId)
      .order('started_at');
    if (error) throw new Error(`entries read failed: ${error.message}`);
    return (data ?? []) as unknown as EntryRow[];
  }

  async function eventsOf(sheetId: string): Promise<EventRow[]> {
    const { data, error } = await h.admin
      .from('timesheet_events')
      .select('event, to_status, revision, actor_user_id')
      .eq('timesheet_id', sheetId)
      .order('id');
    if (error) throw new Error(`events read failed: ${error.message}`);
    return data ?? [];
  }

  /** p_freeze for one sheet: payable = duration, the stored rate, amount NULL for fixed. */
  async function freezeFor(sheetId: string): Promise<Freeze> {
    const value: Record<string, Record<string, unknown>> = {};
    for (const e of await entriesOf(sheetId)) {
      const payable = e.duration_seconds ?? 0;
      const rate = Number(e.rate_snapshot);
      value[e.id] = {
        payable_seconds: payable,
        rate_snapshot: rate,
        rate_type_snapshot: e.rate_type_snapshot,
        currency_snapshot: e.currency_snapshot,
        amount_snapshot:
          e.rate_type_snapshot === 'fixed'
            ? null
            : Math.round((payable / 3600) * rate * 100) / 100,
      };
    }
    return { [sheetId]: value };
  }

  function act(p: {
    ids: string[];
    actor: string | null;
    action: string;
    revisions?: number[] | null;
    note?: string | null;
    freeze?: Freeze | null;
    overtime?: boolean;
  }) {
    return h.admin.rpc('time_timesheet_transition', {
      p_ids: p.ids,
      p_actor: p.actor,
      p_action: p.action,
      p_expected_revisions: p.revisions ?? null,
      p_note: p.note ?? null,
      p_approve_overtime: p.overtime ?? false,
      p_freeze: p.freeze ?? null,
    });
  }

  async function actOk(p: Parameters<typeof act>[0]): Promise<SheetRow[]> {
    const { data, error } = await act(p);
    if (error) {
      throw new Error(
        `${p.action} failed: ${error.message} ${error.details ?? ''}`,
      );
    }
    return (data ?? []) as SheetRow[];
  }

  async function submittedSheet(
    user: User,
    projectId: string,
    context: { kind: 'workspace' | 'team'; id: string },
    rate = 0,
  ): Promise<{ sheetId: string; entryId: string; sheet: SheetRow }> {
    const entry = await logEntry({
      projectId,
      user,
      context,
      start: pastWednesday(2),
      rate,
    });
    const [sheet] = await actOk({
      ids: [entry.timesheet_id],
      actor: user.id,
      action: 'submit',
      revisions: [(await sheetRow(entry.timesheet_id)).revision],
    });
    return { sheetId: entry.timesheet_id, entryId: entry.id, sheet };
  }

  // ── transition: arguments ────────────────────────────────────────────────

  it('validates the action, the arguments and the ids before it locks anything', async () => {
    const id = randomUUID();
    expectRaised(
      (await act({ ids: [id], actor: null, action: 'auto_finish' })).error,
      'TIMESHEET_TRANSITION_INVALID',
      { reason: 'action' },
    );
    // A NULL actor is only for auto_submit, submit_on_deletion and approve (D09).
    expectRaised(
      (await act({ ids: [id], actor: null, action: 'submit' })).error,
      'TIMESHEET_TRANSITION_INVALID',
      { reason: 'arguments' },
    );
    // auto_submit and submit_on_deletion require a NULL actor.
    expectRaised(
      (
        await act({
          ids: [id],
          actor: randomUUID(),
          action: 'auto_submit',
          revisions: [0],
        })
      ).error,
      'TIMESHEET_TRANSITION_INVALID',
      { reason: 'arguments' },
    );
    // A non-NULL actor must send revisions, one per id.
    expectRaised(
      (await act({ ids: [id], actor: randomUUID(), action: 'withdraw' })).error,
      'TIMESHEET_TRANSITION_INVALID',
      { reason: 'arguments' },
    );
    expectRaised(
      (await act({ ids: [id, id], actor: null, action: 'approve' })).error,
      'TIMESHEET_TRANSITION_INVALID',
      { reason: 'arguments' },
    );
    expectRaised(
      (await act({ ids: [], actor: null, action: 'approve' })).error,
      'TIMESHEET_TRANSITION_INVALID',
      { reason: 'arguments' },
    );
    expectRaised(
      (
        await act({
          ids: [id],
          actor: null,
          action: 'approve',
          note: 'x'.repeat(2001),
        })
      ).error,
      'TIMESHEET_TRANSITION_INVALID',
      { reason: 'note_too_long' },
    );
    expectRaised(
      (await act({ ids: [id], actor: null, action: 'approve' })).error,
      'TIMESHEET_NOT_FOUND',
      { timesheet_id: id },
    );
  });

  // ── transition: auto / self ──────────────────────────────────────────────

  it('chains submit -> approved on a sole-owner workspace sheet with a freeze, and the member reopens it to open', async () => {
    const { workspaceId, projectId } = await workspaceProject(solo, 'chain');
    const context = { kind: 'workspace' as const, id: workspaceId };
    const first = await logEntry({
      projectId,
      user: solo,
      context,
      start: pastWednesday(2),
    });
    await logEntry({
      projectId,
      user: solo,
      context,
      start: pastWednesday(2, 13),
      seconds: 1800,
    });
    const sheetId = first.timesheet_id;
    const before = await sheetRow(sheetId);
    expect(before).toMatchObject({
      status: 'open',
      origin: 'app',
      scope_kind: 'workspace',
    });

    const [approved] = await actOk({
      ids: [sheetId],
      actor: solo.id,
      action: 'submit',
      revisions: [before.revision],
      freeze: await freezeFor(sheetId),
    });
    expect(approved).toMatchObject({
      status: 'approved',
      approver_scope: 'self',
      decision_kind: 'self',
      decided_by: solo.id,
      submission_kind: 'manual',
      submitted_by: solo.id,
      total_seconds: 5400,
      payable_seconds: 5400,
      revision: before.revision + 2,
    });
    expect(approved.policy_snapshot.routing).toEqual({
      base: 'workspace',
      cost_money: false,
      deciders_count: 0,
      fallback: 'self',
    });
    expect(approved.policy_snapshot.timezone).toBeTruthy();

    const frozen = await entriesOf(sheetId);
    expect(frozen).toHaveLength(2);
    for (const e of frozen) {
      expect(e.payable_seconds).toBe(e.duration_seconds);
      expect(e.status).toBe('approved');
    }
    expect((await eventsOf(sheetId)).map((e) => [e.event, e.revision])).toEqual(
      [
        ['submitted', before.revision + 1],
        ['approved', before.revision + 2],
      ],
    );

    // A self sheet reopens straight to open (member path), clearing the freeze and the mirror.
    const [reopened] = await actOk({
      ids: [sheetId],
      actor: solo.id,
      action: 'reopen',
      revisions: [approved.revision],
    });
    expect(reopened).toMatchObject({
      status: 'open',
      approver_scope: null,
      submitted_at: null,
      submission_kind: null,
      decided_by: null,
      decision_kind: null,
      total_seconds: null,
      payable_seconds: null,
      revision: approved.revision + 1,
    });
    expect(reopened.policy_snapshot).toEqual({});
    for (const e of await entriesOf(sheetId)) {
      expect(e.payable_seconds).toBeNull();
      expect(e.status).toBe('pending');
    }
  });

  it('leaves an auto/self submit without a freeze submitted, and a NULL-actor approve (cron job 4) finishes it', async () => {
    const { workspaceId, projectId } = await workspaceProject(solo, 'nofreeze');
    const { sheetId, sheet } = await submittedSheet(solo, projectId, {
      kind: 'workspace',
      id: workspaceId,
    });
    expect(sheet).toMatchObject({
      status: 'submitted',
      approver_scope: 'self',
      payable_seconds: null,
      decided_at: null,
    });

    const freeze = await freezeFor(sheetId);
    expectRaised(
      (await act({ ids: [sheetId], actor: null, action: 'approve' })).error,
      'TIMESHEET_TRANSITION_INVALID',
      { reason: 'freeze_required' },
    );
    // Nobody approves their own sheet by hand, not even a self sheet.
    expectRaised(
      (
        await act({
          ids: [sheetId],
          actor: solo.id,
          action: 'approve',
          revisions: [sheet.revision],
          freeze,
        })
      ).error,
      'TIMESHEET_TRANSITION_INVALID',
      { reason: 'not_allowed' },
    );

    const [approved] = await actOk({
      ids: [sheetId],
      actor: null,
      action: 'approve',
      freeze,
    });
    expect(approved).toMatchObject({
      status: 'approved',
      decision_kind: 'self',
      decided_by: solo.id,
      payable_seconds: 3600,
      revision: sheet.revision + 1,
    });
  });

  it('routes submit_on_deletion to auto when nobody else can decide (D14); it never chains, and cron finishes it', async () => {
    const { workspaceId, projectId } = await workspaceProject(solo, 'ondel');
    const entry = await logEntry({
      projectId,
      user: solo,
      context: { kind: 'workspace', id: workspaceId },
      start: pastWednesday(2),
    });
    const sheetId = entry.timesheet_id;
    const freeze = await freezeFor(sheetId);

    const [submitted] = await actOk({
      ids: [sheetId],
      actor: null,
      action: 'submit_on_deletion',
      freeze,
    });
    expect(submitted).toMatchObject({
      status: 'submitted',
      approver_scope: 'auto',
      submission_kind: 'on_deletion',
      submitted_by: null,
      payable_seconds: null,
    });
    expect(submitted.policy_snapshot.routing).toEqual({
      base: 'workspace',
      cost_money: false,
      deciders_count: 0,
      fallback: 'auto',
    });

    const [approved] = await actOk({
      ids: [sheetId],
      actor: null,
      action: 'approve',
      freeze,
    });
    expect(approved).toMatchObject({
      status: 'approved',
      decision_kind: 'auto',
      decided_by: null,
    });
    expect(
      (await eventsOf(sheetId)).map((e) => [e.event, e.actor_user_id]),
    ).toEqual([
      ['submitted', null],
      ['approved', null],
    ]);
  });

  // ── transition: manual route ─────────────────────────────────────────────

  it('refuses a manual-route submit before the last local day of the period (D13); the preview shows the route', async () => {
    const { workspaceId, projectId } = await workspaceProject(owner, 'early', [
      { user: member, role: 'member' },
    ]);
    const now = Date.now();
    const entry = await logEntry({
      projectId,
      user: member,
      context: { kind: 'workspace', id: workspaceId },
      start: new Date(now - 60_000),
      seconds: 30,
    });
    const sheet = await sheetRow(entry.timesheet_id);

    const preview = await h.admin.rpc('time_sheet_routing_preview', {
      p_timesheet_id: sheet.id,
      p_action: 'submit',
    });
    expect(preview.error).toBeNull();
    expect(preview.data).toEqual({
      approver_scope: 'workspace',
      routing: {
        base: 'workspace',
        cost_money: false,
        deciders_count: 1,
        fallback: 'none',
      },
    });
    const missing = await h.admin.rpc('time_sheet_routing_preview', {
      p_timesheet_id: randomUUID(),
    });
    expect(missing.error).toBeNull();
    expect(missing.data).toBeNull();

    const result = await act({
      ids: [sheet.id],
      actor: member.id,
      action: 'submit',
      revisions: [sheet.revision],
    });
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (todayUtc < sheet.period_end) {
      expectRaised(result.error, 'TIMESHEET_TRANSITION_INVALID', {
        reason: 'too_early',
        timesheet_id: sheet.id,
      });
    } else {
      // Run on the period's last day (or the entry fell into last week): the submit is on time.
      expect(result.error).toBeNull();
    }
  });

  it('approve checks visibility, the revision, the freeze and its entry set; a decider approves (manual)', async () => {
    const { workspaceId, projectId } = await workspaceProject(
      owner,
      'approve',
      [{ user: member, role: 'member' }],
    );
    const { sheetId, sheet } = await submittedSheet(member, projectId, {
      kind: 'workspace',
      id: workspaceId,
    });
    expect(sheet).toMatchObject({
      status: 'submitted',
      approver_scope: 'workspace',
      submission_kind: 'manual',
      submitted_by: member.id,
    });
    expect(sheet.policy_snapshot.routing).toEqual({
      base: 'workspace',
      cost_money: false,
      deciders_count: 1,
      fallback: 'none',
    });

    const freeze = await freezeFor(sheetId);
    const rev = [sheet.revision];
    // Someone who cannot see the sheet gets a miss, never a 403.
    expectRaised(
      (
        await act({
          ids: [sheetId],
          actor: outsider.id,
          action: 'approve',
          revisions: rev,
          freeze,
        })
      ).error,
      'TIMESHEET_NOT_FOUND',
      { timesheet_id: sheetId },
    );
    expectRaised(
      (
        await act({
          ids: [sheetId],
          actor: owner.id,
          action: 'approve',
          revisions: [sheet.revision - 1],
          freeze,
        })
      ).error,
      'STALE_REVISION',
      {
        timesheet_id: sheetId,
        expected: sheet.revision - 1,
        actual: sheet.revision,
      },
    );
    expectRaised(
      (
        await act({
          ids: [sheetId],
          actor: owner.id,
          action: 'approve',
          revisions: rev,
        })
      ).error,
      'TIMESHEET_TRANSITION_INVALID',
      { reason: 'freeze_required' },
    );
    const wrongSet: Freeze = {
      [sheetId]: {
        [randomUUID()]: Object.values(freeze[sheetId])[0],
      },
    };
    expectRaised(
      (
        await act({
          ids: [sheetId],
          actor: owner.id,
          action: 'approve',
          revisions: rev,
          freeze: wrongSet,
        })
      ).error,
      'STALE_REVISION',
      { reason: 'entry_set', timesheet_id: sheetId },
    );

    const [approved] = await actOk({
      ids: [sheetId],
      actor: owner.id,
      action: 'approve',
      revisions: rev,
      note: 'Looks right',
      overtime: true,
      freeze,
    });
    expect(approved).toMatchObject({
      status: 'approved',
      decision_kind: 'manual',
      decided_by: owner.id,
      decision_note: 'Looks right',
      overtime_approved: true,
      payable_seconds: 3600,
      approver_scope: 'workspace',
    });

    // A manual decision is reopened on request, not by the member directly.
    expectRaised(
      (
        await act({
          ids: [sheetId],
          actor: member.id,
          action: 'reopen',
          revisions: [approved.revision],
        })
      ).error,
      'TIMESHEET_TRANSITION_INVALID',
      { reason: 'use_request_reopen' },
    );
    const [requested] = await actOk({
      ids: [sheetId],
      actor: member.id,
      action: 'request_reopen',
      revisions: [approved.revision],
      note: 'I logged Tuesday twice',
    });
    expect(requested).toMatchObject({
      status: 'approved',
      revision: approved.revision + 1,
    });
    const events = await eventsOf(sheetId);
    expect(events[events.length - 1]).toMatchObject({
      event: 'reopen_requested',
      to_status: 'approved',
      actor_user_id: member.id,
    });
  });

  it('return needs a note and mirrors per-entry approvals back to pending; the member resubmits and withdraws', async () => {
    const { workspaceId, projectId } = await workspaceProject(owner, 'return', [
      { user: member, role: 'member' },
    ]);
    const entry = await logEntry({
      projectId,
      user: member,
      context: { kind: 'workspace', id: workspaceId },
      start: pastWednesday(2),
    });
    await approvePerEntry(entry.id);
    const sheetId = entry.timesheet_id;
    const [submitted] = await actOk({
      ids: [sheetId],
      actor: member.id,
      action: 'submit',
      revisions: [(await sheetRow(sheetId)).revision],
    });
    const rev = [submitted.revision];

    expectRaised(
      (
        await act({
          ids: [sheetId],
          actor: owner.id,
          action: 'return',
          revisions: rev,
        })
      ).error,
      'TIMESHEET_TRANSITION_INVALID',
      { reason: 'note_required' },
    );
    expectRaised(
      (
        await act({
          ids: [sheetId],
          actor: member.id,
          action: 'return',
          revisions: rev,
          note: 'mine',
        })
      ).error,
      'TIMESHEET_TRANSITION_INVALID',
      { reason: 'not_allowed' },
    );

    const [returned] = await actOk({
      ids: [sheetId],
      actor: owner.id,
      action: 'return',
      revisions: rev,
      note: 'Split Tuesday by task',
    });
    expect(returned).toMatchObject({
      status: 'returned',
      decided_by: owner.id,
      decision_kind: 'manual',
      decision_note: 'Split Tuesday by task',
      approver_scope: 'workspace',
    });
    const [after] = await entriesOf(sheetId);
    expect(after).toMatchObject({ status: 'pending', payable_seconds: null });

    // A resubmit from returned has no timing rule and clears the decision.
    const [resubmitted] = await actOk({
      ids: [sheetId],
      actor: member.id,
      action: 'submit',
      revisions: [returned.revision],
    });
    expect(resubmitted).toMatchObject({
      status: 'submitted',
      decided_by: null,
      decision_note: null,
    });
    const [withdrawn] = await actOk({
      ids: [sheetId],
      actor: member.id,
      action: 'withdraw',
      revisions: [resubmitted.revision],
    });
    expect(withdrawn).toMatchObject({
      status: 'open',
      approver_scope: null,
      submitted_at: null,
      submission_kind: null,
    });
    expect(withdrawn.policy_snapshot).toEqual({});
  });

  it('a decider reopen of an approved sheet holding per-entry approvals returns it and writes status=pending (E72a)', async () => {
    const { workspaceId, projectId } = await workspaceProject(owner, 'reopen', [
      { user: member, role: 'member' },
    ]);
    const entry = await logEntry({
      projectId,
      user: member,
      context: { kind: 'workspace', id: workspaceId },
      start: pastWednesday(3),
      rate: 40,
    });
    await approvePerEntry(entry.id);
    const sheetId = entry.timesheet_id;
    const [submitted] = await actOk({
      ids: [sheetId],
      actor: member.id,
      action: 'submit',
      revisions: [(await sheetRow(sheetId)).revision],
    });
    const [approved] = await actOk({
      ids: [sheetId],
      actor: owner.id,
      action: 'approve',
      revisions: [submitted.revision],
      freeze: await freezeFor(sheetId),
    });
    const [frozen] = await entriesOf(sheetId);
    expect(frozen).toMatchObject({
      status: 'approved',
      payable_seconds: 3600,
      amount_snapshot: 40,
    });

    expectRaised(
      (
        await act({
          ids: [sheetId],
          actor: owner.id,
          action: 'reopen',
          revisions: [approved.revision],
        })
      ).error,
      'TIMESHEET_TRANSITION_INVALID',
      { reason: 'note_required' },
    );
    const [reopened] = await actOk({
      ids: [sheetId],
      actor: owner.id,
      action: 'reopen',
      revisions: [approved.revision],
      note: 'The rate was wrong',
    });
    expect(reopened).toMatchObject({
      status: 'returned',
      decided_by: owner.id,
      decision_kind: 'manual',
      decision_note: 'The rate was wrong',
      payable_seconds: null,
      approver_scope: 'workspace',
    });
    const [cleared] = await entriesOf(sheetId);
    expect(cleared).toMatchObject({
      status: 'pending',
      payable_seconds: null,
      amount_snapshot: null,
    });
    const events = await eventsOf(sheetId);
    expect(events[events.length - 1]).toMatchObject({
      event: 'reopened',
      to_status: 'returned',
    });
  });

  it('keeps a cost-money sheet with nobody else to decide submitted on its scope (fallback wait)', async () => {
    const lone = await h.createUser('eng-lone');
    const workspaceId = await h.createWorkspace(lone.id, 'money');
    workspaces.push(workspaceId);
    // A Business comp: time_team_rules on, so the team's member rates are cost money (D12).
    const { error: compError } = await h.admin
      .from('workspaces')
      .update({
        is_discounted_free: true,
        discounted_plan: 'business',
        discounted_at: new Date().toISOString(),
        discounted_until: null,
      })
      .eq('id', workspaceId);
    expect(compError).toBeNull();
    const { teamId, projectId } = await teamProject(lone, [], {
      workspaceId,
      rates: true,
    });
    // The owner logs for their own team, so they need a membership row (cascade-deleted with the team).
    await insertRow('team_members', {
      team_id: teamId,
      user_id: lone.id,
      role: 'admin',
    });

    const entry = await logEntry({
      projectId,
      user: lone,
      context: { kind: 'team', id: teamId },
      start: pastWednesday(2),
      rate: 25,
    });
    const sheetId = entry.timesheet_id;
    const money = await h.admin.rpc('time_sheet_has_cost_money', {
      p_timesheet_id: sheetId,
    });
    expect(money.error).toBeNull();
    expect(money.data).toBe(true);

    const [submitted] = await actOk({
      ids: [sheetId],
      actor: lone.id,
      action: 'submit',
      revisions: [(await sheetRow(sheetId)).revision],
      freeze: await freezeFor(sheetId),
    });
    expect(submitted).toMatchObject({
      status: 'submitted',
      scope_kind: 'workspace',
      approver_scope: 'workspace',
    });
    expect(submitted.policy_snapshot.routing).toEqual({
      base: 'workspace',
      cost_money: true,
      deciders_count: 0,
      fallback: 'wait',
    });
  });

  // ── settlement and payouts ───────────────────────────────────────────────

  it('creates a payout from per-entry approved, unfrozen time (status=paid), refuses self and fixed, and void reverts', async () => {
    const { teamId, projectId } = await teamProject(owner, [member], {
      payouts: true,
    });
    const context = { kind: 'team' as const, id: teamId };
    const hourly = await logEntry({
      projectId,
      user: member,
      context,
      start: pastWednesday(1),
      rate: 100,
    });
    const fixed = await logEntry({
      projectId,
      user: member,
      context,
      start: pastWednesday(1, 14),
      rate: 500,
      rateType: 'fixed',
    });
    await approvePerEntry(hourly.id);
    await approvePerEntry(fixed.id);

    const payout = (createdBy: string, ids: string[]) =>
      h.admin.rpc('create_payout_and_mark_paid', {
        p_team_id: teamId,
        p_member_user_id: member.id,
        p_created_by: createdBy,
        p_currency: 'USD',
        p_log_ids: ids,
      });

    expectRaised(
      (await payout(member.id, [hourly.id])).error,
      'PAYOUT_SELF_NOT_ALLOWED',
    );
    expectRaised(
      (await payout(owner.id, [fixed.id])).error,
      'FIXED_RATE_NOT_PAYABLE_BY_ENTRY',
    );

    const created = await payout(owner.id, [hourly.id]);
    expect(created.error).toBeNull();
    const payoutRow = created.data as {
      id: string;
      total_amount: number;
      status: string;
    };
    payouts.push(payoutRow.id);
    expect(Number(payoutRow.total_amount)).toBe(100);
    const { data: paid } = await h.admin
      .from('time_entries')
      .select('status, payout_id, payable_seconds')
      .eq('id', hourly.id)
      .single();
    expect(paid).toEqual({
      status: 'paid',
      payout_id: payoutRow.id,
      payable_seconds: null,
    });

    const voided = await h.admin.rpc('void_payout_and_revert', {
      p_payout_id: payoutRow.id,
      p_actor: owner.id,
    });
    expect(voided.error).toBeNull();
    expect((voided.data as { status: string }).status).toBe('void');
    const { data: reverted } = await h.admin
      .from('time_entries')
      .select('status, payout_id')
      .eq('id', hourly.id)
      .single();
    expect(reverted).toEqual({ status: 'approved', payout_id: null });
  });

  it('refuses to reopen a sheet with paid entries (TIMESHEET_HAS_SETTLED_ENTRIES)', async () => {
    const { teamId, projectId } = await teamProject(owner, [member], {
      payouts: true,
    });
    const { sheetId, entryId, sheet } = await submittedSheet(
      member,
      projectId,
      { kind: 'team', id: teamId },
      100,
    );
    // No workspace: the team scope is decided by the team's managers.
    expect(sheet).toMatchObject({
      scope_kind: 'team',
      approver_scope: 'workspace',
    });
    expect(sheet.policy_snapshot.routing).toMatchObject({
      deciders_count: 1,
      fallback: 'none',
    });
    // Rows lock on submit (trg_40).
    const locked = await h.admin
      .from('time_entries')
      .update({ duration_seconds: 60 })
      .eq('id', entryId);
    expectRaised(locked.error, 'TIME_ENTRY_LOCKED', {
      entry_id: entryId,
      reason: 'sheet_submitted',
    });

    const [approved] = await actOk({
      ids: [sheetId],
      actor: owner.id,
      action: 'approve',
      revisions: [sheet.revision],
      freeze: await freezeFor(sheetId),
    });
    const created = await h.admin.rpc('create_payout_and_mark_paid', {
      p_team_id: teamId,
      p_member_user_id: member.id,
      p_created_by: owner.id,
      p_currency: 'USD',
      p_log_ids: [entryId],
    });
    expect(created.error).toBeNull();
    const payoutRow = created.data as { id: string; total_amount: number };
    payouts.push(payoutRow.id);
    // Frozen time pays its payable seconds: 1 h at 100.
    expect(Number(payoutRow.total_amount)).toBe(100);

    expectRaised(
      (
        await act({
          ids: [sheetId],
          actor: owner.id,
          action: 'reopen',
          revisions: [approved.revision],
          note: 'Wrong week',
        })
      ).error,
      'TIMESHEET_HAS_SETTLED_ENTRIES',
      { timesheet_id: sheetId, reason: 'paid' },
    );
  });

  // ── deciders and the queue ───────────────────────────────────────────────

  it('time_scope_deciders excludes the member and tombstoned profiles; time_timesheet_deciders reads the frozen scope', async () => {
    const wsOwner = await h.createUser('eng-dec-owner');
    const admin = await h.createUser('eng-dec-admin');
    const tomb = await h.createUser('eng-dec-tomb');
    const subject = await h.createUser('eng-dec-subject');
    const plain = await h.createUser('eng-dec-plain');
    const { workspaceId, projectId } = await workspaceProject(
      wsOwner,
      'deciders',
      [
        { user: admin, role: 'admin' },
        { user: tomb, role: 'admin' },
        { user: subject, role: 'admin' },
        { user: plain, role: 'member' },
      ],
    );
    const { error: tombError } = await h.admin
      .from('profiles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', tomb.id);
    expect(tombError).toBeNull();

    const expected = [wsOwner.id, admin.id].sort();
    const deciders = await h.admin.rpc('time_scope_deciders', {
      p_approver_scope: 'workspace',
      p_team_id: null,
      p_policy_workspace_id: workspaceId,
      p_engagement_id: null,
      p_member_user_id: subject.id,
    });
    expect(deciders.error).toBeNull();
    expect([...(deciders.data as string[])].sort()).toEqual(expected);

    const { sheetId, sheet } = await submittedSheet(subject, projectId, {
      kind: 'workspace',
      id: workspaceId,
    });
    expect(sheet.approver_scope).toBe('workspace');
    expect(sheet.policy_snapshot.routing?.deciders_count).toBe(2);
    const fromSheet = await h.admin.rpc('time_timesheet_deciders', {
      p_timesheet_id: sheetId,
    });
    expect(fromSheet.error).toBeNull();
    expect([...(fromSheet.data as string[])].sort()).toEqual(expected);
  });

  it('time_approval_queue_ids returns exactly the sheets the user can decide, then what they decided', async () => {
    const approver = await h.createUser('eng-q-owner');
    const worker = await h.createUser('eng-q-member');
    const { workspaceId, projectId } = await workspaceProject(
      approver,
      'queue',
      [{ user: worker, role: 'member' }],
    );
    const context = { kind: 'workspace' as const, id: workspaceId };
    const waiting = await submittedSheet(worker, projectId, context);
    // The approver's own sheet routes to self (nobody else decides) and never enters their queue.
    const own = await submittedSheet(approver, projectId, context);
    expect(own.sheet).toMatchObject({
      status: 'submitted',
      approver_scope: 'self',
    });

    const queue = async (userId: string, status?: string, since?: string) => {
      const { data, error } = await h.admin.rpc('time_approval_queue_ids', {
        p_user_id: userId,
        ...(status ? { p_status: status } : {}),
        ...(since ? { p_since: since } : {}),
      });
      expect(error).toBeNull();
      return data as string[];
    };
    expect(await queue(approver.id)).toEqual([waiting.sheetId]);
    expect(await queue(worker.id)).toEqual([]);

    await actOk({
      ids: [waiting.sheetId],
      actor: approver.id,
      action: 'approve',
      revisions: [waiting.sheet.revision],
      freeze: await freezeFor(waiting.sheetId),
    });
    expect(await queue(approver.id)).toEqual([]);
    expect(await queue(approver.id, 'decided')).toEqual([waiting.sheetId]);
    const tomorrow = new Date(Date.now() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(await queue(approver.id, 'decided', tomorrow)).toEqual([]);
  });

  // ── running timers ───────────────────────────────────────────────────────

  it('time_stop_running_entries folds an in-progress pause and closes the open segment', async () => {
    const { workspaceId, projectId } = await workspaceProject(solo, 'stop');
    const t0 = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
    const at = (secondsBefore: number) =>
      new Date(t0.getTime() - secondsBefore * 1000).toISOString();
    const { data: running, error } = await h.admin
      .from('time_entries')
      .insert({
        project_id: projectId,
        member_user_id: solo.id,
        started_at: at(7200),
        paused_at: at(1800),
        break_seconds: 600,
        source: 'timer',
        context_kind: 'workspace',
        context_ref: workspaceId,
        workspace_id: workspaceId,
      })
      .select('id')
      .single();
    if (error || !running)
      throw new Error(`running insert failed: ${error?.message}`);
    const entryId = (running as { id: string }).id;
    const { error: segError } = await h.admin
      .from('time_entry_segments')
      .insert([
        {
          entry_id: entryId,
          kind: 'work',
          started_at: at(7200),
          ended_at: at(1800),
        },
        { entry_id: entryId, kind: 'break', started_at: at(1800) },
      ]);
    expect(segError).toBeNull();

    const stop = () =>
      h.admin.rpc('time_stop_running_entries', {
        p_ids: [entryId],
        p_at: t0.toISOString(),
        p_flag: 'stopped_by_assignment_end',
      });
    const first = await stop();
    expect(first.error).toBeNull();
    expect(first.data).toBe(1);

    const { data: stopped } = await h.admin
      .from('time_entries')
      .select(
        'ended_at, paused_at, break_seconds, break_minutes, duration_seconds, flagged_reason',
      )
      .eq('id', entryId)
      .single();
    const row = stopped as {
      ended_at: string;
      paused_at: string | null;
      break_seconds: number;
      break_minutes: number;
      duration_seconds: number;
      flagged_reason: string;
    };
    expect(Date.parse(row.ended_at)).toBe(t0.getTime());
    expect(row).toMatchObject({
      paused_at: null,
      break_seconds: 2400,
      break_minutes: 40,
      duration_seconds: 4800,
      flagged_reason: 'stopped_by_assignment_end',
    });
    const { data: segments } = await h.admin
      .from('time_entry_segments')
      .select('kind, ended_at')
      .eq('entry_id', entryId);
    const list = (segments ?? []) as Array<{
      kind: string;
      ended_at: string | null;
    }>;
    expect(list.every((s) => s.ended_at !== null)).toBe(true);
    const breakSegment = list.find((s) => s.kind === 'break');
    expect(Date.parse(breakSegment?.ended_at ?? '')).toBe(t0.getTime());

    const again = await stop();
    expect(again.error).toBeNull();
    expect(again.data).toBe(0);
  });

  // ── the rest of M3 ───────────────────────────────────────────────────────

  it('a team-policy DELETE through time_policy_delete keeps its audit rows (policy_id NULL) and writes a deleted event', async () => {
    const teamOwner = await h.createUser('eng-pol-owner');
    const teamId = await h.createTeam(teamOwner.id, null);
    teams.push(teamId);
    const { data: policy, error } = await h.admin
      .from('time_policies')
      .insert({
        scope: 'team',
        team_id: teamId,
        approver_scope: 'team',
        created_by: teamOwner.id,
        updated_by: teamOwner.id,
      })
      .select('id')
      .single();
    if (error || !policy)
      throw new Error(`policy insert failed: ${error?.message}`);
    const policyId = (policy as { id: string }).id;

    const deleted = await h.admin.rpc('time_policy_delete', {
      p_policy_id: policyId,
      p_actor: teamOwner.id,
    });
    expect(deleted.error).toBeNull();
    const { data: left } = await h.admin
      .from('time_policies')
      .select('id')
      .eq('id', policyId);
    expect(left).toEqual([]);

    const { data: events } = await h.admin
      .from('time_policy_events')
      .select('policy_id, actor_user_id, changes, scope, team_id')
      .eq('team_id', teamId)
      .order('id');
    const audit = (events ?? []) as Array<{
      policy_id: string | null;
      actor_user_id: string | null;
      changes: Record<string, unknown>;
      scope: string;
    }>;
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit.every((e) => e.policy_id === null && e.scope === 'team')).toBe(
      true,
    );
    expect(audit[audit.length - 1]).toMatchObject({
      actor_user_id: teamOwner.id,
      changes: { deleted: true },
    });
  });

  it('reset_qa_fixture deletes a fixture project entries and the now-empty submitted sheet', async () => {
    const consultant = await h.createUser('eng-qa-consultant');
    const worker = await h.createUser('eng-qa-worker');
    const client = await h.createUser('eng-qa-client');
    const key = `itest-eng-${h.runId}`;
    const contractId = randomUUID();
    await insertRow('consultant_profiles', {
      user_id: consultant.id,
      status: 'verified',
      verified_at: new Date().toISOString(),
    });
    qaFixtures.push({ key, contractId, consultantId: consultant.id });
    const { teamId: primaryTeamId, projectId } = await teamProject(
      consultant,
      [worker],
      {
        title: '[QA] itest engine fixture',
      },
    );
    const secondaryTeamId = await h.createTeam(
      consultant.id,
      null,
      'itest second team',
    );
    teams.push(secondaryTeamId);
    await insertRow('project_teams', {
      project_id: projectId,
      team_id: secondaryTeamId,
      is_primary: false,
      attached_by: consultant.id,
    });
    await insertRow('contracts', {
      id: contractId,
      project_id: projectId,
      version: 1,
      status: 'draft',
      consultant_user_id: consultant.id,
      client_user_id: client.id,
      created_by: consultant.id,
    });
    await insertRow('qa_fixtures', {
      key,
      project_id: projectId,
      contract_id: contractId,
      consultant_user_id: consultant.id,
      worker_user_id: worker.id,
      client_user_id: client.id,
      primary_team_id: primaryTeamId,
      secondary_team_id: secondaryTeamId,
    });

    const { sheetId, sheet } = await submittedSheet(worker, projectId, {
      kind: 'team',
      id: primaryTeamId,
    });
    expect(sheet.status).toBe('submitted');

    const reset = await h.admin.rpc('reset_qa_fixture', {
      p_key: key,
      p_mark_success: false,
    });
    expect(reset.error).toBeNull();
    const [{ data: entries }, { data: sheets }] = await Promise.all([
      h.admin.from('time_entries').select('id').eq('project_id', projectId),
      h.admin.from('timesheets').select('id').eq('id', sheetId),
    ]);
    expect(entries).toEqual([]);
    expect(sheets).toEqual([]);
  });

  it('account_deletion_preflight lists TEAM_HAS_OPEN_TIME for an owned team that would be purged', async () => {
    const teamOwner = await h.createUser('eng-del-owner');
    const { teamId, projectId } = await teamProject(teamOwner, [member]);
    const { sheet } = await submittedSheet(member, projectId, {
      kind: 'team',
      id: teamId,
    });
    expect(sheet.status).toBe('submitted');

    const preflight = await h.admin.rpc('account_deletion_preflight', {
      p_user_id: teamOwner.id,
    });
    expect(preflight.error).toBeNull();
    const blockers =
      (preflight.data as { blockers?: unknown[] }).blockers ?? [];
    expect(blockers).toContainEqual(
      expect.objectContaining({
        kind: 'team',
        id: teamId,
        code: 'TEAM_HAS_OPEN_TIME',
      }),
    );
  });
});
