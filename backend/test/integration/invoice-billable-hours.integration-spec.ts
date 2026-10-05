/**
 * Invoice hour reservations against hosted dev (P14; backend.md › Invoices, edge-cases E16, E17, E36, E37,
 * E57, E62, E73):
 *   - a legacy hourly contract bills only its provider team's approved time on its project (never another
 *     team's, the workspace's or anyone's personal time), reserving each entry once (E57);
 *   - `UNIQUE(entry_id)` keeps a second draft of the same period from billing the same hours (E37);
 *   - a reserved entry's sheet cannot be reopened (`TIMESHEET_HAS_SETTLED_ENTRIES {reason:'billed'}`);
 *   - issue-time verification passes on a freshly composed draft;
 *   - detaching hours releases, a recompose re-reserves, void-and-replace moves the rows (E37);
 *   - a retainer never reserves, even with approved hours on its project (E73);
 *   - a second live hourly legacy contract (E17) cannot arise: the database allows one signed client contract
 *     per project, so the composition's `LEGACY_CONTRACT_AMBIGUOUS {reason:'contracts'}` check is a backstop;
 *   - an engagement contract bills the provider party team's entries on its linked project only, at the
 *     engagement's billing rate (E16 b, E62).
 *
 * Runs after M2/M3 are applied to dev (§6 step 3) and P17 has wired TimeModule. Never against production
 * (describeDevOnly). Entries are logged today, after the dev billing floor (the M2 legacy-import day), on a
 * sole-owner workspace so the submit chains straight to approved (self route, D13). A run in the first minutes
 * after UTC midnight can end an entry a few minutes in the future; that is harmless.
 *
 * ⚠️ Not fully self-cleaning: the activated engagement graph is append-only (see
 * engagement-activation.integration-spec.ts), so the engagement is cancelled and left with its activating
 * contract. Its provider party pins the consultant's team (the teams FK's SET NULL is refused with
 * ENGAGEMENT_PARTY_IMMUTABLE), so that team and its owner membership stay too; everything else is removed.
 */
import { randomUUID } from 'crypto';
import { Harness, describeDevOnly } from './harness';
import { InvoicesService } from '../../src/modules/marketplace/invoices/invoices.service';
import { InvoiceCompositionService } from '../../src/modules/marketplace/invoices/invoice-composition.service';

jest.setTimeout(180000);

type User = Awaited<ReturnType<Harness['createUser']>>;
type Freeze = Record<string, Record<string, Record<string, unknown>>>;

interface SheetRow {
  id: string;
  status: string;
  revision: number;
  period_start: string;
  period_end: string;
  approver_scope: string | null;
}

const ENTRY_SECONDS = 600;

describeDevOnly('invoice billable hours (real DB)', () => {
  const h = new Harness();
  const invoiceIds: string[] = [];
  const contractIds: string[] = [];
  const createdEngagements: string[] = [];
  const cleanupProblems: string[] = [];

  let invoices: InvoicesService;
  let composition: InvoiceCompositionService;

  let consultant: User;
  let client: User;
  let otherOwner: User;
  let workspaceId: string;
  let teamId: string;
  let otherTeamId: string;
  let projectId: string;
  let engagementProjectId: string;
  let retainerProjectId: string;

  let legacyEntries: string[] = [];
  let engagementEntries: string[] = [];
  let foreignEntry: string;
  let workspaceEntry: string;
  let retainerEntry: string;
  let consultantSheet: SheetRow;
  let period: { start: string; end: string };
  let legacyContractId: string;

  // ── fixtures ──────────────────────────────────────────────────────────────

  async function insertRow(
    table: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await h.admin.from(table).insert(value);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }

  /** A start today (UTC), early enough that the back-to-back entries end before now. */
  function todayStart(index: number): string {
    const now = Date.now();
    const midnight = new Date(
      new Date(now).toISOString().slice(0, 10),
    ).getTime();
    const base = Math.max(midnight + 60_000, now - 3 * 3600_000);
    return new Date(base + index * (ENTRY_SECONDS + 60) * 1000).toISOString();
  }

  async function logEntry(o: {
    user: User;
    project: string;
    teamId?: string;
    workspaceId?: string;
    index: number;
  }): Promise<{ id: string; timesheet_id: string }> {
    const startedAt = todayStart(o.index);
    const row = await h.createTimeEntry({
      projectId: o.project,
      memberUserId: o.user.id,
      teamId: o.teamId ?? null,
      workspaceId: o.workspaceId ?? null,
      startedAt,
      endedAt: new Date(
        Date.parse(startedAt) + ENTRY_SECONDS * 1000,
      ).toISOString(),
      rateSnapshot: 0,
      currencySnapshot: 'USD',
    });
    if (!row.timesheet_id) throw new Error('entry has no timesheet');
    return { id: row.id, timesheet_id: row.timesheet_id };
  }

  async function sheetRow(id: string): Promise<SheetRow> {
    const { data, error } = await h.admin
      .from('timesheets')
      .select('id, status, revision, period_start, period_end, approver_scope')
      .eq('id', id)
      .single();
    if (error || !data) throw new Error(`sheet read failed: ${error?.message}`);
    return data as SheetRow;
  }

  /** p_freeze for one sheet: payable = duration, the stored rate, amount from it. */
  async function freezeFor(sheetId: string): Promise<Freeze> {
    const { data, error } = await h.admin
      .from('time_entries')
      .select(
        'id, duration_seconds, rate_snapshot, rate_type_snapshot, currency_snapshot',
      )
      .eq('timesheet_id', sheetId);
    if (error) throw new Error(`entries read failed: ${error.message}`);
    const value: Record<string, Record<string, unknown>> = {};
    for (const e of (data ?? []) as Array<Record<string, unknown>>) {
      const payable = Number(e.duration_seconds ?? 0);
      const rate = Number(e.rate_snapshot ?? 0);
      value[String(e.id)] = {
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

  /** Submit on a sole-decider sheet chains straight to approved (self route) when the freeze is sent. */
  async function approveBySubmit(sheetId: string, member: User): Promise<void> {
    const before = await sheetRow(sheetId);
    const { error } = await h.admin.rpc('time_timesheet_transition', {
      p_ids: [sheetId],
      p_actor: member.id,
      p_action: 'submit',
      p_expected_revisions: [before.revision],
      p_note: null,
      p_approve_overtime: false,
      p_freeze: await freezeFor(sheetId),
    });
    if (error) {
      throw new Error(`submit failed: ${error.message} ${error.details ?? ''}`);
    }
    const after = await sheetRow(sheetId);
    if (after.status !== 'approved') {
      throw new Error(
        `sheet ${sheetId} is ${after.status} (${after.approver_scope}), not approved`,
      );
    }
  }

  /** A signed client contract with no engagement (the pre-engagement shape), by default on `projectId`. */
  async function legacyContract(o: {
    billingMode: 'time_based' | 'hybrid' | 'retainer';
    providerTeamId?: string | null;
    project?: string;
  }): Promise<string> {
    const { data, error } = await h.admin
      .from('contracts')
      .insert({
        project_id: o.project ?? projectId,
        workspace_id: workspaceId,
        created_by: consultant.id,
        consultant_user_id: consultant.id,
        client_user_id: client.id,
        relationship_kind: 'client_services',
        scope_mode: 'project_specific',
        contract_family_id: randomUUID(),
        version: 1,
        status: 'signed',
        currency: 'USD',
        billing_mode: o.billingMode,
        client_hourly_rate: o.billingMode === 'retainer' ? null : 100,
        recurring_fee: o.billingMode === 'time_based' ? null : 1000,
        included_hours: o.billingMode === 'hybrid' ? 0 : null,
        service_start_date: '2026-01-01',
        service_end_date: '2027-12-31',
        time_tracking_mode: 'optional',
        time_approval_mode: 'none',
        client_hours_detail_level: 'summary',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`legacy contract: ${error?.message}`);
    const id = data.id as string;
    contractIds.push(id);
    await insertRow('contract_positions', {
      contract_id: id,
      position: 'provider',
      user_id: consultant.id,
      capacity: 'consultant',
      display_name_snapshot: 'Itest consultant',
      email_snapshot: consultant.email,
      team_id: o.providerTeamId ?? null,
    });
    await insertRow('contract_positions', {
      contract_id: id,
      position: 'hirer',
      user_id: client.id,
      capacity: 'client',
      display_name_snapshot: 'Itest client',
      email_snapshot: client.email,
    });
    return id;
  }

  /** A project-specific client contract signed through the activation RPC: an engagement linking the project. */
  async function engagementContract(): Promise<string> {
    const { data, error } = await h.admin
      .from('contracts')
      .insert({
        project_id: engagementProjectId,
        workspace_id: workspaceId,
        created_by: consultant.id,
        consultant_user_id: consultant.id,
        client_user_id: client.id,
        relationship_kind: 'client_services',
        scope_mode: 'project_specific',
        contract_family_id: randomUUID(),
        version: 1,
        status: 'draft',
        currency: 'USD',
        billing_mode: 'time_based',
        client_hourly_rate: 120,
        service_start_date: '2026-01-01',
        service_end_date: '2027-12-31',
        time_tracking_mode: 'optional',
        time_approval_mode: 'none',
        client_hours_detail_level: 'summary',
      })
      .select('id')
      .single();
    if (error || !data)
      throw new Error(`engagement contract: ${error?.message}`);
    const id = data.id as string;
    await insertRow('contract_positions', {
      contract_id: id,
      position: 'hirer',
      user_id: client.id,
      capacity: 'client',
      display_name_snapshot: 'Itest client',
      email_snapshot: client.email,
    });
    await insertRow('contract_positions', {
      contract_id: id,
      position: 'provider',
      user_id: consultant.id,
      capacity: 'consultant',
      display_name_snapshot: 'Itest consultant',
      email_snapshot: consultant.email,
      team_id: teamId,
    });
    for (const position of ['provider', 'hirer'] as const) {
      // The RPC refuses a stale revision (20261001100000); each signature bumps it.
      const { data: current, error: revisionError } = await h.admin
        .from('contracts')
        .select('revision')
        .eq('id', id)
        .single();
      if (revisionError) {
        throw new Error(`read revision: ${revisionError.message}`);
      }
      const { error: signError } = await h.admin.rpc(
        'sign_contract_position_and_activate',
        {
          p_contract_id: id,
          p_position: position,
          p_signer_name: `Signer ${position}`,
          p_signature_url: null,
          p_scale: 1,
          p_offset_x: 0,
          p_offset_y: 0,
          p_signed_at: '2026-03-01T00:00:00.000Z',
          p_expected_revision: (current as { revision: number }).revision,
        },
      );
      if (signError) throw new Error(`sign ${position}: ${signError.message}`);
    }
    const { data: signed } = await h.admin
      .from('contracts')
      .select('engagement_id')
      .eq('id', id)
      .single();
    const engagementId = signed?.engagement_id as string | null;
    if (!engagementId) throw new Error('contract did not activate');
    createdEngagements.push(engagementId);
    return id;
  }

  async function createDraft(
    contractId: string,
    project = projectId,
    attachHours = true,
  ) {
    const invoice = await invoices.createInvoice(consultant.id, {
      project_id: project,
      contract_id: contractId,
      attach_hours: attachHours,
      period_start: period.start,
      period_end: period.end,
      hours_detail_level: 'summary',
    });
    invoiceIds.push(invoice.id);
    return invoice;
  }

  async function reservedBy(invoiceId: string): Promise<string[]> {
    const { data, error } = await h.admin
      .from('invoice_time_entries')
      .select('entry_id')
      .eq('invoice_id', invoiceId);
    if (error) throw new Error(`reservations read failed: ${error.message}`);
    return ((data ?? []) as Array<{ entry_id: string }>)
      .map((row) => row.entry_id)
      .sort();
  }

  const hours = (
    lines: Array<{ source_type: string; quantity: number | string }>,
  ) =>
    lines
      .filter(
        (l) => l.source_type === 'time_log' || l.source_type === 'overage',
      )
      .reduce((sum, l) => sum + Number(l.quantity), 0);

  // ── setup ─────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    await h.boot();
    invoices = h.app.get(InvoicesService);
    composition = h.app.get(InvoiceCompositionService);

    consultant = await h.createUser('inv-consultant');
    client = await h.createUser('inv-client');
    otherOwner = await h.createUser('inv-other');
    await h.admin
      .from('consultant_profiles')
      .upsert(
        { user_id: consultant.id, status: 'verified' },
        { onConflict: 'user_id' },
      );

    // The consultant is the sole owner of the workspace and of its team, so their sheet routes to self.
    workspaceId = await h.createWorkspace(consultant.id, 'inv');
    teamId = await h.createTeam(consultant.id, workspaceId, 'itest inv team');
    // TeamsService.create adds the owner as a member; the time-entry trigger checks team_members.
    await insertRow('team_members', {
      team_id: teamId,
      user_id: consultant.id,
      role: 'owner',
    });
    await h.setTeamTime(teamId, { time_tracking_enabled: true });
    // Another team in the same workspace that the consultant also works for: its entries share the
    // consultant's workspace sheet (so they are approved with it) but belong to no provider seat.
    otherTeamId = await h.createTeam(
      otherOwner.id,
      workspaceId,
      'itest inv other',
    );
    await h.setTeamTime(otherTeamId, { time_tracking_enabled: true });
    await h.addTeamMember(otherTeamId, consultant.id, 'member');

    projectId = await h.createProject(consultant.id, 'itest invoice hours');
    await h.setProjectWorkspace(projectId, workspaceId);
    await h.grantAccess(projectId, consultant.id, 'owner');
    await h.attachTeam(projectId, teamId, true);
    await h.attachTeam(projectId, otherTeamId);

    engagementProjectId = await h.createProject(
      consultant.id,
      'itest invoice hours eng',
    );
    await h.setProjectWorkspace(engagementProjectId, workspaceId);
    await h.grantAccess(engagementProjectId, consultant.id, 'owner');
    await h.attachTeam(engagementProjectId, teamId, true);

    // uq_contracts_signed_client_services_per_project: one signed client contract per project, so the
    // retainer (E73) gets its own project, with the same provider team and approved hours of its own.
    retainerProjectId = await h.createProject(
      consultant.id,
      'itest invoice hours retainer',
    );
    await h.setProjectWorkspace(retainerProjectId, workspaceId);
    await h.grantAccess(retainerProjectId, consultant.id, 'owner');
    await h.attachTeam(retainerProjectId, teamId, true);

    // All of the consultant's entries land on one workspace sheet; log them all before it is approved.
    const a = await logEntry({
      user: consultant,
      project: projectId,
      teamId,
      index: 0,
    });
    const b = await logEntry({
      user: consultant,
      project: projectId,
      teamId,
      index: 1,
    });
    const ws = await logEntry({
      user: consultant,
      project: projectId,
      workspaceId,
      index: 2,
    });
    const c = await logEntry({
      user: consultant,
      project: engagementProjectId,
      teamId,
      index: 3,
    });
    const foreign = await logEntry({
      user: consultant,
      project: projectId,
      teamId: otherTeamId,
      index: 4,
    });
    const retained = await logEntry({
      user: consultant,
      project: retainerProjectId,
      teamId,
      index: 5,
    });
    legacyEntries = [a.id, b.id].sort();
    engagementEntries = [c.id];
    workspaceEntry = ws.id;
    foreignEntry = foreign.id;
    retainerEntry = retained.id;
    expect(
      new Set(
        [a, b, ws, c, foreign, retained].map((logged) => logged.timesheet_id),
      ).size,
    ).toBe(1);

    await approveBySubmit(a.timesheet_id, consultant);
    consultantSheet = await sheetRow(a.timesheet_id);
    period = {
      start: consultantSheet.period_start,
      end: consultantSheet.period_end,
    };

    legacyContractId = await legacyContract({
      billingMode: 'time_based',
      providerTeamId: teamId,
    });
  }, 180000);

  afterAll(async () => {
    try {
      if (invoiceIds.length > 0) {
        const { error } = await h.admin
          .from('invoices')
          .delete()
          .in('id', invoiceIds);
        if (error) cleanupProblems.push(`invoices: ${error.message}`);
      }
      if (contractIds.length > 0) {
        const { error } = await h.admin
          .from('contracts')
          .delete()
          .in('id', contractIds);
        if (error) cleanupProblems.push(`contracts: ${error.message}`);
      }
    } catch (error) {
      cleanupProblems.push(String(error));
    }

    await h.cleanup();

    for (const engagementId of createdEngagements) {
      const { error } = await h.admin
        .from('engagements')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          status_reason: 'integration test fixture',
        })
        .eq('id', engagementId)
        .eq('status', 'active');
      if (error)
        cleanupProblems.push(`cancel ${engagementId}: ${error.message}`);
    }
    if (consultant) {
      const { error } = await h.admin
        .from('consultant_profiles')
        .update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          status_reason: 'integration test fixture',
        })
        .eq('user_id', consultant.id);
      if (error) cleanupProblems.push(`revoke enrolment: ${error.message}`);
    }
    await h.close();

    if (createdEngagements.length > 0) {
      console.warn(
        `[cleanup] permanent by design — ${createdEngagements.length} engagement(s) cancelled, not deleted (${createdEngagements.join(', ')})`,
      );
    }
    if (cleanupProblems.length > 0) {
      console.warn(`[cleanup] ${cleanupProblems.join(' | ')}`);
    }
  }, 180000);

  // ── cases ─────────────────────────────────────────────────────────────────

  let firstDraftId: string;
  let secondDraftId: string;

  it("bills only the provider team's approved time on the contract project, once (E57, E37)", async () => {
    const first = await createDraft(legacyContractId);
    firstDraftId = first.id;
    expect(await reservedBy(first.id)).toEqual(legacyEntries);
    // Not the other team's entry, not the workspace entry, not the other project's team entry.
    const { data: everyReservation } = await h.admin
      .from('invoice_time_entries')
      .select('entry_id')
      .in('entry_id', [
        foreignEntry,
        workspaceEntry,
        retainerEntry,
        ...engagementEntries,
      ]);
    expect(everyReservation ?? []).toEqual([]);

    const hourLine = first.line_items.find((l) => l.source_type === 'time_log');
    expect(hourLine).toMatchObject({ unit_rate: 100 });
    expect(hours(first.line_items)).toBe(
      Math.round(((2 * ENTRY_SECONDS) / 3600) * 100) / 100,
    );
    await expect(
      composition.verifyReservations(first.id, first.line_items),
    ).resolves.toBeUndefined();

    // UNIQUE(entry_id): a second draft of the same period bills nothing.
    const second = await createDraft(legacyContractId);
    secondDraftId = second.id;
    expect(await reservedBy(second.id)).toEqual([]);
    expect(hours(second.line_items)).toBe(0);
  });

  it('refuses to reopen a sheet whose entries are reserved', async () => {
    const sheet = await sheetRow(consultantSheet.id);
    const { error } = await h.admin.rpc('time_timesheet_transition', {
      p_ids: [sheet.id],
      p_actor: consultant.id,
      p_action: 'reopen',
      p_expected_revisions: [sheet.revision],
      p_note: null,
      p_approve_overtime: false,
      p_freeze: null,
    });
    expect(error?.message).toBe('TIMESHEET_HAS_SETTLED_ENTRIES');
    expect(JSON.parse(error?.details ?? '{}')).toMatchObject({
      reason: 'billed',
    });
  });

  it('releases on detach and re-reserves on a recompose (E37)', async () => {
    await invoices.updateInvoice(consultant.id, firstDraftId, {
      attach_hours: false,
    });
    expect(await reservedBy(firstDraftId)).toEqual([]);

    const recomposed = await invoices.updateInvoice(
      consultant.id,
      secondDraftId,
      { hours_detail_level: 'summary' },
    );
    expect(await reservedBy(secondDraftId)).toEqual(legacyEntries);
    await expect(
      composition.verifyReservations(secondDraftId, recomposed.line_items),
    ).resolves.toBeUndefined();
  });

  it('moves the reservations to the replacement on void-and-replace (E37)', async () => {
    // Issuing would render and store a PDF; the lifecycle under test starts at an issued invoice.
    const { error } = await h.admin
      .from('invoices')
      .update({ status: 'issued', issued_at: new Date().toISOString() })
      .eq('id', secondDraftId);
    expect(error).toBeNull();

    const { voided, replacement } = await invoices.voidAndReplaceInvoice(
      consultant.id,
      secondDraftId,
      'itest: wrong period',
    );
    invoiceIds.push(replacement.id);
    expect(voided.status).toBe('void');
    expect(await reservedBy(secondDraftId)).toEqual([]);
    expect(await reservedBy(replacement.id)).toEqual(legacyEntries);
    await expect(
      composition.verifyReservations(replacement.id, replacement.line_items),
    ).resolves.toBeUndefined();
  });

  it('never reserves for a retainer, even with hours attached (E73)', async () => {
    const retainerId = await legacyContract({
      billingMode: 'retainer',
      providerTeamId: teamId,
      project: retainerProjectId,
    });
    const draft = await createDraft(retainerId, retainerProjectId);
    expect(draft.line_items.map((l) => l.source_type)).toEqual(['retainer']);
    expect(await reservedBy(draft.id)).toEqual([]);
    // The provider team's approved entry on the retainer project stays unreserved.
    const { data: held } = await h.admin
      .from('invoice_time_entries')
      .select('entry_id')
      .eq('entry_id', retainerEntry);
    expect(held ?? []).toEqual([]);
  });

  it('refuses a second signed client contract on the project, so no second live hourly legacy contract exists (E17)', async () => {
    // uq_contracts_signed_client_services_per_project allows one signed client_services contract per
    // project, so the ambiguity E17 describes cannot be set up: the composition's
    // LEGACY_CONTRACT_AMBIGUOUS {reason:'contracts'} check (assertOnlyLegacyHourlyContract) is a backstop
    // the database never lets fire. Its refusal is unit-tested in invoice-composition.service.spec.ts.
    const { count: before } = await h.admin
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);
    await expect(
      legacyContract({ billingMode: 'hybrid', providerTeamId: teamId }),
    ).rejects.toThrow(/uq_contracts_signed_client_services_per_project/);

    // Nothing was left behind: the project still has exactly its one signed client contract and no new invoice.
    const { data: live, error } = await h.admin
      .from('contracts')
      .select('id')
      .eq('project_id', projectId)
      .eq('status', 'signed')
      .eq('relationship_kind', 'client_services');
    expect(error).toBeNull();
    expect((live ?? []).map((row) => row.id as string)).toEqual([
      legacyContractId,
    ]);
    const { count: after } = await h.admin
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);
    expect(after).toBe(before);
  });

  it("bills an engagement's provider team on its linked project, at the engagement rate (E16 b, E62)", async () => {
    const contractId = await engagementContract();
    const draft = await createDraft(contractId, engagementProjectId);
    expect(await reservedBy(draft.id)).toEqual(engagementEntries);
    const hourLine = draft.line_items.find((l) => l.source_type === 'time_log');
    expect(hourLine).toMatchObject({ unit_rate: 120 });
  });
});
