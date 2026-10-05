/**
 * TimesheetsService against hosted dev (P11): the TypeScript freeze builder feeding the M3 engine.
 *
 * time-functions.integration-spec.ts drives time_timesheet_transition with hand-built payloads; this spec drives
 * it through TimesheetsService, so the p_freeze that TypeScript builds (keyed by sheet, then entry, D10) is the one
 * the RPC applies. Covered: a sole-owner workspace sheet submitted and chained to `self` with policy rounding from
 * the snapshot, then reopened by its member to `open`; a stale freeze refused on its entry set (and the service's
 * rebuild succeeding); a cost-money team entry on a workspace-scope sheet: trg_40 locks it on submit, the decider's
 * detail carries the freeze preview with per-currency amounts, the approve re-resolves the team member rate in force,
 * and a payout then blocks the decider reopen (TIMESHEET_HAS_SETTLED_ENTRIES); E20 (the sole team manager's
 * cost-money sheet routes to the workspace admins); and a policy period change that never trips the
 * timesheets_no_overlap exclusion constraint.
 *
 * The services are built by hand on the harness's service-role client (no AppModule boot). Entitlements answer from
 * SQL (time_workspace_has_feature, the same plan state the real service reads) and notifications are recorded, not
 * sent. Runs after M2/M3 are applied to dev (§6). Never against production (describeDevOnly).
 */
import type { HttpException } from '@nestjs/common';
import { EngagementsService } from '../../src/modules/marketplace/engagements/engagements.service';
import type { EntitlementsService } from '../../src/modules/shared/entitlements/entitlements.service';
import type { ProjectAuthorizationService } from '../../src/modules/execution/projects/authorization/project-authorization.service';
import { TimeAuthorityService } from '../../src/modules/execution/time/time-authority.service';
import { TimeCacheService } from '../../src/modules/execution/time/time-cache';
import type { TimeNotificationsService } from '../../src/modules/execution/time/time-notifications.service';
import { TimePolicyService } from '../../src/modules/execution/time/time-policy.service';
import { TimeRatesService } from '../../src/modules/execution/time/time-rates.service';
import { TimesheetsService } from '../../src/modules/execution/time/timesheets.service';
import { Harness, describeDevOnly } from './harness';

jest.setTimeout(180000);

type User = Awaited<ReturnType<Harness['createUser']>>;

interface EntryRow {
  id: string;
  timesheet_id: string | null;
  duration_seconds: number | null;
  payable_seconds: number | null;
  amount_snapshot: number | string | null;
  rate_snapshot: number | string;
  currency_snapshot: string;
}

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

function body(e: unknown): Record<string, unknown> {
  return (e as HttpException).getResponse() as Record<string, unknown>;
}

describeDevOnly('TimesheetsService (real DB)', () => {
  const h = new Harness();
  const projects: string[] = [];
  const payouts: string[] = [];
  const notified: Array<{ method: string; args: unknown[] }> = [];

  let timesheets: TimesheetsService;

  beforeAll(() => {
    const sb = h.admin;
    const engagements = new EngagementsService(sb);
    // The real EntitlementsService needs Redis and the billing repo; this answers from the same SQL plan state.
    const entitlements = {
      hasFeature: async (ref: unknown, key: string) => {
        if (typeof ref !== 'string') return false;
        const { data, error } = await sb.rpc('time_workspace_has_feature', {
          p_workspace_id: ref,
          p_key: key,
        });
        return !error && data === true;
      },
      resolveScopeForTeam: async (teamId: string) => {
        const { data } = await sb
          .from('teams')
          .select('workspace_id')
          .eq('id', teamId)
          .maybeSingle();
        return (data as { workspace_id: string | null } | null)?.workspace_id;
      },
      assertFeature: () => Promise.resolve(),
    } as unknown as EntitlementsService;
    const cache = new TimeCacheService(null);
    const policy = new TimePolicyService(sb, engagements, entitlements, cache);
    const rates = new TimeRatesService(sb, engagements, entitlements, policy);
    const authority = new TimeAuthorityService(
      sb,
      {} as ProjectAuthorizationService,
      engagements,
      entitlements,
      policy,
    );
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        notified.push({ method, args });
        return Promise.resolve();
      };
    const notifications = {
      sheetSubmitted: record('sheetSubmitted'),
      sheetDecided: record('sheetDecided'),
      reopenRequested: record('reopenRequested'),
    } as unknown as TimeNotificationsService;
    timesheets = new TimesheetsService(
      sb,
      authority,
      policy,
      rates,
      notifications,
      engagements,
      entitlements,
    );
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
    } catch {
      /* best-effort */
    }
    await h.cleanup();
  });

  // ── fixtures ──────────────────────────────────────────────────────────────

  async function insertRow(
    table: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await h.admin.from(table).insert(value);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }

  async function project(
    ownerId: string,
    workspaceId: string,
  ): Promise<string> {
    const projectId = await h.createProject(ownerId);
    projects.push(projectId);
    await h.setProjectWorkspace(projectId, workspaceId);
    return projectId;
  }

  async function logEntry(o: {
    projectId: string;
    user: User;
    teamId?: string;
    workspaceId?: string;
    start: Date;
    seconds?: number;
    rate?: number;
  }): Promise<{ id: string; timesheet_id: string }> {
    const seconds = o.seconds ?? 3600;
    const row = await h.createTimeEntry({
      projectId: o.projectId,
      memberUserId: o.user.id,
      teamId: o.teamId ?? null,
      workspaceId: o.teamId ? null : (o.workspaceId ?? null),
      startedAt: o.start.toISOString(),
      endedAt: new Date(o.start.getTime() + seconds * 1000).toISOString(),
      rateSnapshot: o.rate ?? 0,
      currencySnapshot: 'USD',
    });
    expect(row.timesheet_id).toBeTruthy();
    return { id: row.id, timesheet_id: row.timesheet_id as string };
  }

  async function revision(sheetId: string): Promise<number> {
    const { data, error } = await h.admin
      .from('timesheets')
      .select('revision')
      .eq('id', sheetId)
      .single();
    if (error || !data) throw new Error(`sheet read failed: ${error?.message}`);
    return (data as { revision: number }).revision;
  }

  async function entriesOf(sheetId: string): Promise<EntryRow[]> {
    const { data, error } = await h.admin
      .from('time_entries')
      .select(
        'id, timesheet_id, duration_seconds, payable_seconds, amount_snapshot, rate_snapshot, currency_snapshot',
      )
      .eq('timesheet_id', sheetId)
      .order('started_at');
    if (error) throw new Error(`entries read failed: ${error.message}`);
    return (data ?? []) as unknown as EntryRow[];
  }

  async function setWorkspacePolicy(
    workspaceId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await h.admin.rpc('time_ensure_workspace_policy', {
      p_workspace_id: workspaceId,
      p_timezone_hint: 'UTC',
      p_member_user_id: null,
    });
    const { error } = await h.admin
      .from('time_policies')
      .update(patch)
      .eq('scope', 'workspace')
      .eq('workspace_id', workspaceId);
    if (error) throw new Error(`policy update failed: ${error.message}`);
  }

  // ── cases ─────────────────────────────────────────────────────────────────

  it('submits a sole-owner workspace sheet through the TS freeze (self, snapshot rounding), then the member reopens it', async () => {
    const solo = await h.createUser('ts-solo');
    const workspaceId = await h.createWorkspace(solo.id, 'ts-solo');
    const projectId = await project(solo.id, workspaceId);
    await setWorkspacePolicy(workspaceId, {
      rounding_minutes: 15,
      timezone: 'UTC',
    });

    const first = await logEntry({
      projectId,
      user: solo,
      workspaceId,
      start: pastWednesday(2),
    });
    await logEntry({
      projectId,
      user: solo,
      workspaceId,
      start: pastWednesday(2, 13),
      seconds: 37 * 60, // rounds to 30 min at 15-minute rounding
    });
    const sheetId = first.timesheet_id;

    const [approved] = await timesheets.act(
      solo.id,
      'submit',
      [sheetId],
      [await revision(sheetId)],
    );
    expect(approved).toMatchObject({
      id: sheetId,
      status: 'approved',
      approver_scope: 'self',
      decision_kind: 'self',
      payable_seconds: 3600 + 1800,
    });
    expect(approved).not.toHaveProperty('policy_snapshot');
    const frozen = await entriesOf(sheetId);
    expect(frozen.map((e) => e.payable_seconds)).toEqual([3600, 1800]);
    for (const e of frozen) expect(Number(e.amount_snapshot)).toBe(0);
    // D63: the self route still goes through sheetSubmitted (no recipients), then the approval.
    expect(
      notified
        .filter((n) => (n.args[0] as { id?: string })?.id === sheetId)
        .map((n) => n.method),
    ).toEqual(['sheetSubmitted', 'sheetDecided']);

    const detail = await timesheets.get(solo.id, sheetId);
    expect(detail.viewer).toEqual({
      is_member: true,
      can_decide: false,
      actions: ['reopen'],
    });
    expect(detail.rules).toMatchObject({ rounding_minutes: 15 });
    expect(detail.routing).toMatchObject({ fallback: 'self' });
    expect((await timesheets.listMine(solo.id, {})).map((s) => s.id)).toContain(
      sheetId,
    );

    const [reopened] = await timesheets.act(
      solo.id,
      'reopen',
      [sheetId],
      [approved.revision],
    );
    expect(reopened).toMatchObject({
      status: 'open',
      approver_scope: null,
      payable_seconds: null,
    });
    for (const e of await entriesOf(sheetId)) {
      expect(e.payable_seconds).toBeNull();
    }
  });

  it('refuses a freeze built before an entry was added (STALE_REVISION entry_set); the service rebuilds it', async () => {
    const solo = await h.createUser('ts-stale');
    const workspaceId = await h.createWorkspace(solo.id, 'ts-stale');
    const projectId = await project(solo.id, workspaceId);
    const first = await logEntry({
      projectId,
      user: solo,
      workspaceId,
      start: pastWednesday(2),
    });
    const sheetId = first.timesheet_id;
    const { payload } = await timesheets.buildFreeze([sheetId], {
      approveOvertime: false,
      mode: 'submit',
    });
    expect(Object.keys(payload[sheetId])).toEqual([first.id]);

    const second = await logEntry({
      projectId,
      user: solo,
      workspaceId,
      start: pastWednesday(2, 14),
    });
    expect(second.timesheet_id).toBe(sheetId);

    const stale = await h.admin.rpc('time_timesheet_transition', {
      p_ids: [sheetId],
      p_actor: solo.id,
      p_action: 'submit',
      p_expected_revisions: [await revision(sheetId)],
      p_note: null,
      p_approve_overtime: false,
      p_freeze: payload,
    });
    expect(stale.error?.message).toBe('STALE_REVISION');
    expect(JSON.parse(stale.error?.details ?? '{}')).toMatchObject({
      reason: 'entry_set',
      timesheet_id: sheetId,
    });

    const [approved] = await timesheets.act(
      solo.id,
      'submit',
      [sheetId],
      [await revision(sheetId)],
    );
    expect(approved.status).toBe('approved');
    expect((await entriesOf(sheetId)).map((e) => e.payable_seconds)).toEqual([
      3600, 3600,
    ]);
  });

  it('cost-money team time: locks on submit, the decider previews and approves at the rate in force, and a payout blocks the reopen', async () => {
    const owner = await h.createUser('ts-owner');
    const member = await h.createUser('ts-member');
    const workspaceId = await h.createWorkspace(owner.id, 'ts-money');
    await h.compWorkspace(workspaceId, 'business');
    const teamId = await h.createTeam(owner.id, workspaceId);
    await h.setTeamTime(teamId, {
      member_rates_enabled: true,
      payouts_enabled: true,
    });
    await h.addTeamMember(teamId, member.id, 'member');
    const projectId = await project(owner.id, workspaceId);
    await h.attachTeam(projectId, teamId, true);
    await h.grantAccess(projectId, member.id, 'editor');
    // The member's rate card for this project, in force on every date.
    await insertRow('team_member_rates', {
      team_id: teamId,
      user_id: member.id,
      project_id: projectId,
      hourly_rate: 100,
      currency: 'USD',
    });

    const logged = await logEntry({
      projectId,
      user: member,
      teamId,
      start: pastWednesday(2),
      rate: 100,
    });
    const sheetId = logged.timesheet_id;

    const [submitted] = await timesheets.act(
      member.id,
      'submit',
      [sheetId],
      [await revision(sheetId)],
    );
    // No team override: the team's time is on the workspace sheet, decided by the workspace's owners and admins.
    expect(submitted).toMatchObject({
      status: 'submitted',
      scope_kind: 'workspace',
      approver_scope: 'workspace',
    });

    // trg_40: rows lock on submit.
    const locked = await h.admin
      .from('time_entries')
      .update({ note: 'late edit' })
      .eq('id', logged.id);
    expect(locked.error?.message).toBe('TIME_ENTRY_LOCKED');

    const queue = await timesheets.queue(owner.id, {
      status: 'submitted',
      page: 1,
      limit: 100,
    });
    expect(queue.items.map((s) => s.id)).toContain(sheetId);
    expect((await timesheets.queueCount(owner.id)).waiting).toBeGreaterThan(0);

    const detail = await timesheets.get(owner.id, sheetId);
    expect(detail.viewer).toEqual({
      is_member: false,
      can_decide: true,
      actions: ['approve', 'return'],
    });
    expect(detail.deciders_count).toBe(1);
    expect(detail.freeze_preview?.entries).toEqual([
      {
        entry_id: logged.id,
        rounded_seconds: 3600,
        payable_seconds: 3600,
        over_cap_seconds: 0,
      },
    ]);
    // The team owner may read this team's member money (rates on, time_team_rules on Business).
    expect(detail.freeze_preview?.amounts_by_currency).toEqual({ USD: 100 });

    const [approved] = await timesheets.act(
      owner.id,
      'approve',
      [sheetId],
      [submitted.revision],
    );
    expect(approved).toMatchObject({
      status: 'approved',
      decision_kind: 'manual',
      decided_by: owner.id,
      payable_seconds: 3600,
    });
    const [frozen] = await entriesOf(sheetId);
    expect(Number(frozen.rate_snapshot)).toBe(100);
    expect(Number(frozen.amount_snapshot)).toBe(100);

    const created = await h.admin.rpc('create_payout_and_mark_paid', {
      p_team_id: teamId,
      p_member_user_id: member.id,
      p_created_by: owner.id,
      p_currency: 'USD',
      p_log_ids: [logged.id],
    });
    expect(created.error).toBeNull();
    payouts.push((created.data as { id: string }).id);

    const refused = await timesheets
      .act(owner.id, 'reopen', [sheetId], [approved.revision], {
        note: 'Wrong week',
      })
      .catch((e: unknown) => e);
    expect((refused as HttpException).getStatus()).toBe(409);
    expect(body(refused)).toMatchObject({
      code: 'TIMESHEET_HAS_SETTLED_ENTRIES',
      timesheet_id: sheetId,
      reason: 'paid',
    });

    // A decider reopen with no note is a 400 before the RPC (D33).
    const noNote = await timesheets
      .act(owner.id, 'reopen', [sheetId], [approved.revision])
      .catch((e: unknown) => e);
    expect((noNote as HttpException).getStatus()).toBe(400);
  });

  it("E20: the sole team manager's cost-money sheet routes to the workspace admins", async () => {
    const wsOwner = await h.createUser('ts-e20-owner');
    const lead = await h.createUser('ts-e20-lead');
    const workspaceId = await h.createWorkspace(wsOwner.id, 'ts-e20');
    await h.compWorkspace(workspaceId, 'business');
    const teamId = await h.createTeam(lead.id, workspaceId);
    await h.setTeamTime(teamId, { member_rates_enabled: true });
    // The lead logs for their own team: a membership row (cascade-deleted with the team).
    await insertRow('team_members', {
      team_id: teamId,
      user_id: lead.id,
      role: 'admin',
    });
    // A Business override routing approvals to the team: the sheet is team scope.
    await insertRow('time_policies', {
      scope: 'team',
      team_id: teamId,
      approver_scope: 'team',
    });
    const projectId = await project(wsOwner.id, workspaceId);
    await h.attachTeam(projectId, teamId, true);
    await h.grantAccess(projectId, lead.id, 'editor');

    const logged = await logEntry({
      projectId,
      user: lead,
      teamId,
      start: pastWednesday(2),
    });
    const [submitted] = await timesheets.act(
      lead.id,
      'submit',
      [logged.timesheet_id],
      [await revision(logged.timesheet_id)],
    );
    expect(submitted).toMatchObject({
      status: 'submitted',
      scope_kind: 'team',
      approver_scope: 'workspace',
    });
    const forOwner = await timesheets.get(wsOwner.id, logged.timesheet_id);
    expect(forOwner.viewer.can_decide).toBe(true);
    expect(forOwner.routing).toMatchObject({
      base: 'team',
      cost_money: true,
      fallback: 'workspace',
    });
    const forLead = await timesheets.get(lead.id, logged.timesheet_id);
    expect(forLead.viewer).toMatchObject({
      is_member: true,
      actions: ['withdraw'],
    });
    expect(forLead.deciders_count).toBe(1);
  });

  it('a policy period change clips the next sheet instead of tripping timesheets_no_overlap', async () => {
    const solo = await h.createUser('ts-period');
    const workspaceId = await h.createWorkspace(solo.id, 'ts-period');
    const projectId = await project(solo.id, workspaceId);
    await setWorkspacePolicy(workspaceId, {
      period_kind: 'weekly',
      week_start: 1,
      timezone: 'UTC',
    });
    const weekly = await logEntry({
      projectId,
      user: solo,
      workspaceId,
      start: new Date('2026-08-05T09:00:00.000Z'),
    });
    await setWorkspacePolicy(workspaceId, { period_kind: 'monthly' });
    const monthly = await logEntry({
      projectId,
      user: solo,
      workspaceId,
      start: new Date('2026-08-19T09:00:00.000Z'),
    });
    expect(monthly.timesheet_id).not.toBe(weekly.timesheet_id);
    const { data, error } = await h.admin
      .from('timesheets')
      .select('id, period_kind, period_start, period_end')
      .in('id', [weekly.timesheet_id, monthly.timesheet_id])
      .order('period_start');
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        id: weekly.timesheet_id,
        period_kind: 'weekly',
        period_start: '2026-08-03',
        period_end: '2026-08-09',
      },
      {
        id: monthly.timesheet_id,
        period_kind: 'monthly',
        period_start: '2026-08-10',
        period_end: '2026-08-31',
      },
    ]);
  });
});
