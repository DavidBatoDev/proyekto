import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type { EngagementListQueryDto } from './dto/engagements.dto';

const ENGAGEMENT_SELECT = `
  id, kind, scope_mode, status, origin, activated_by_contract_id,
  started_at, ended_at, cancelled_at, status_reason, created_at, updated_at
`;

const PARTY_SELECT = `
  engagement_id, position, user_id, capacity,
  display_name_snapshot, email_snapshot, team_id, team_name_snapshot
`;

const PROJECT_LINK_SELECT = `
  id, engagement_id, project_id, project_title_snapshot,
  basis, status, linked_at, ended_at
`;

const SETTINGS_SELECT = `
  id, engagement_id, source_contract_id, tracking_mode, approval_mode,
  allow_manual_entries, rounding_minutes, weekly_limit_minutes,
  client_hours_detail_level, effective_from, effective_until
`;

const RATE_SELECT = `
  id, engagement_id, source_contract_id, worker_user_id, rate_kind, unit,
  work_type, amount, currency, effective_from, effective_until
`;

const ASSIGNMENT_SELECT = `
  id, project_id, worker_user_id, talent_engagement_id, client_engagement_id,
  team_id, role_title, status, started_at, ended_at, created_at
`;

/** `time_scope_label`'s fallback when the governing hirer seat is gone. */
const UNKNOWN_HIRER_LABEL = 'Unknown';

export type EngagementPosition = 'hirer' | 'provider';

export type EngagementKind = 'talent_services' | 'client_services';

/** Structurally equal to `time.types` `WorkType`; declared here so this module imports nothing from `time/`. */
export type EngagementWorkType = 'real_work' | 'training';

/**
 * One engagement assignment with its governing engagement resolved
 * (CHANGE-3: the talent engagement, else the client engagement). Read with
 * the service role; carries the worker id, so callers decide who may see it.
 */
export interface AssignmentContext {
  id: string;
  /**
   * Null only on a severed assignment (its project was deleted; the FK is
   * ON DELETE SET NULL). Only `getAssignment` can return one: the list
   * methods filter by project.
   */
  project_id: string | null;
  worker_user_id: string;
  talent_engagement_id: string | null;
  client_engagement_id: string | null;
  /** coalesce(talent, client) — CHANGE-3. */
  governing_engagement_id: string;
  governing_kind: EngagementKind;
  /** engagements.status of the governing engagement. */
  governing_status: string;
  team_id: string | null;
  role_title: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  /** The governing hirer's display_name_snapshot (`time_scope_label`). */
  hirer_label: string;
}

interface AssignmentRow {
  id: string;
  project_id: string | null;
  worker_user_id: string;
  talent_engagement_id: string | null;
  client_engagement_id: string | null;
  team_id: string | null;
  role_title: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

export interface EngagementPartyRow {
  engagement_id: string;
  position: EngagementPosition;
  user_id: string;
  capacity: string;
  display_name_snapshot: string | null;
  email_snapshot: string | null;
  /** The team this seat signed on behalf of (snapshot at activation). */
  team_id: string | null;
  team_name_snapshot: string | null;
}

export interface EngagementProjectLinkRow {
  id: string;
  engagement_id: string;
  project_id: string | null;
  project_title_snapshot: string;
  basis: string;
  status: string;
  linked_at: string | null;
  ended_at: string | null;
}

export interface EngagementTimeSettingsRow {
  id: string;
  engagement_id: string;
  source_contract_id: string | null;
  tracking_mode: string;
  approval_mode: string;
  allow_manual_entries: boolean;
  rounding_minutes: number;
  weekly_limit_minutes: number | null;
  client_hours_detail_level: string;
  effective_from: string;
  effective_until: string | null;
}

export interface EngagementTimeRateRow {
  id: string;
  engagement_id: string;
  source_contract_id: string | null;
  worker_user_id: string | null;
  rate_kind: string;
  unit: string;
  work_type: string | null;
  amount: number;
  currency: string | null;
  effective_from: string;
  effective_until: string | null;
}

interface EngagementRow {
  id: string;
  kind: string;
  scope_mode: string;
  status: string;
  origin: string | null;
  activated_by_contract_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  cancelled_at: string | null;
  status_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * One engagement as the requesting party is allowed to see it. The viewer is
 * always a party, so `counterparty` is the other seat and never a third one.
 */
export interface EngagementView extends EngagementRow {
  viewer_position: EngagementPosition;
  viewer_capacity: string;
  /** The team the viewer's own seat signed on behalf of. */
  viewer_team: { id: string; name: string } | null;
  counterparty: Omit<EngagementPartyRow, 'engagement_id' | 'team_id'> | null;
  project_links: EngagementProjectLinkRow[];
  current_settings: EngagementTimeSettingsRow | null;
  current_rates: EngagementTimeRateRow[];
}

export function isEffective(
  row: { effective_from: string; effective_until: string | null },
  today: string,
): boolean {
  if (row.effective_from > today) return false;
  return row.effective_until === null || row.effective_until >= today;
}

/**
 * The rates in force on a past (or future) date. Past-period reports read the
 * terms of the version that governed that day, never today's: a recorded
 * agreement amended in June and September still prices March at the original
 * rate (decision 2026-09-30).
 */
export function ratesInForceOn<
  T extends { effective_from: string; effective_until: string | null },
>(rates: T[], date: string): T[] {
  return rates.filter((row) => isEffective(row, date));
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Newest `effective_from` first, then `id`, so equal dates still pick one row deterministically. */
function newestEffectiveFirst(
  a: { id: string; effective_from: string },
  b: { id: string; effective_from: string },
): number {
  return (
    compareText(b.effective_from, a.effective_from) || compareText(a.id, b.id)
  );
}

/**
 * The single rate that prices an entry of `workType` worked on `localDate`
 * (backend.md freeze step 1, invoices' bill rate; E43). Pure.
 *
 * Callers pass rows already narrowed to one engagement and one `rate_kind`
 * (`ratesFor`); this filters them to the rows in force on `localDate` again,
 * so a caller that skipped `ratesInForceOn` still gets the right answer.
 *
 * Preference, in order:
 *   1. `work_type = workType` before `work_type IS NULL`; a row for the other
 *      work type never applies.
 *   2. Unit `'hour'` before `'month'`/`'fixed'`. A hybrid agreement carries
 *      both a monthly retainer and an hourly row from the same version; only
 *      the hourly row prices time. A `'month'`/`'fixed'` row is returned
 *      as-is when it is all there is, and the caller treats it as fixed
 *      (not amountable).
 *   3. The latest `effective_from`, then the lowest `id`.
 */
export function pickRate(
  rows: EngagementTimeRateRow[],
  localDate: string,
  workType: EngagementWorkType,
): EngagementTimeRateRow | null {
  const workTypeRank = (row: EngagementTimeRateRow): number => {
    const rowWorkType = row.work_type ?? null;
    if (rowWorkType === workType) return 0;
    return rowWorkType === null ? 1 : -1;
  };
  const unitRank = (row: EngagementTimeRateRow): number =>
    row.unit === 'hour' ? 0 : 1;

  const candidates = ratesInForceOn(rows, localDate).filter(
    (row) => workTypeRank(row) >= 0,
  );
  if (candidates.length === 0) return null;
  return (
    [...candidates].sort(
      (a, b) =>
        workTypeRank(a) - workTypeRank(b) ||
        unitRank(a) - unitRank(b) ||
        newestEffectiveFirst(a, b),
    )[0] ?? null
  );
}

/**
 * One contract seat of the caller's, redacted for their capacity. Talent
 * never sees `client_hourly_rate` (the client price is not their commercial
 * business), and no internal cost rate exists on the contract row at all.
 */
export interface AgreementView {
  contract_id: string;
  contract_number: string | null;
  status: string;
  relationship_kind: string;
  my_position: string;
  my_capacity: string;
  counterparty_name: string | null;
  project_id: string | null;
  project_title: string | null;
  currency: string | null;
  signed_at: string | null;
  client_hourly_rate?: number | null;
  /** The team the caller's seat signs on behalf of. */
  my_team_name: string | null;
  /** The team the other seat signs on behalf of. */
  counterparty_team_name: string | null;
  /** The paper's own title — "Service Agreement", "Consulting Agreement". */
  document_title: string | null;
}

/**
 * Read access to engagements.
 *
 * Authorization is party membership and nothing else: a caller sees an
 * engagement only when they occupy one of its two seats. That single rule is
 * what keeps the two commercial sides apart — a Client is only ever a party on
 * their own `client_services` engagement, so the `talent_services` engagement
 * that carries Talent identity and `cost` rates is never in their result set at
 * all. There is deliberately no "list every engagement on this project" path,
 * because that would have to re-derive the redaction this scoping gives free.
 *
 * These tables have RLS enabled with no policies, so the anon/authenticated
 * clients cannot read them. This service therefore runs on the admin client and
 * owns the filtering itself.
 */
@Injectable()
export class EngagementsService {
  private readonly logger = new Logger(EngagementsService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async list(
    callerId: string,
    query: EngagementListQueryDto = {},
  ): Promise<EngagementView[]> {
    const seats = await this.seatsFor(callerId);
    if (seats.size === 0) return [];

    let builder = this.supabase
      .from('engagements')
      .select(ENGAGEMENT_SELECT)
      .in('id', [...seats.keys()]);
    if (query.kind) builder = builder.eq('kind', query.kind);
    if (query.status) builder = builder.eq('status', query.status);

    const { data, error } = await builder.order('started_at', {
      ascending: false,
      nullsFirst: false,
    });
    if (error) throw new Error(error.message);

    const engagements = (data ?? []) as unknown as EngagementRow[];
    const views = await this.compose(engagements, seats);
    if (!query.project_id) return views;
    return views.filter((view) =>
      view.project_links.some((link) => link.project_id === query.project_id),
    );
  }

  async getById(callerId: string, id: string): Promise<EngagementView> {
    const seats = await this.seatsFor(callerId);
    const seat = seats.get(id);
    // Not a party: report the same way as a genuinely missing row so the
    // endpoint cannot be used to probe which engagement ids exist.
    if (!seat) throw new NotFoundException('Engagement not found');

    const { data, error } = await this.supabase
      .from('engagements')
      .select(ENGAGEMENT_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Engagement not found');

    const [view] = await this.compose(
      [data as unknown as EngagementRow],
      seats,
    );
    if (!view) throw new NotFoundException('Engagement not found');
    return view;
  }

  /**
   * Every contract seat the caller occupies, INCLUDING contracts that have no
   * engagement row (legacy/seeded). All statuses are returned — draft/sent
   * simply render as pending states. Redaction mirrors the engagement views:
   * the counterparty contributes only its display-name snapshot, and
   * `client_hourly_rate` (the CLIENT price — no internal cost rate is ever
   * selected) is included only for client/consultant capacities.
   */
  async listAgreements(callerId: string): Promise<AgreementView[]> {
    interface SeatRow {
      contract_id: string;
      position: string;
      capacity: string;
      signed_at: string | null;
      team_name_snapshot: string | null;
      contract: {
        id: string;
        contract_number: string | null;
        status: string;
        relationship_kind: string;
        document_title: string | null;
        currency: string | null;
        client_hourly_rate: number | null;
        project_id: string | null;
        created_by: string | null;
        project: { id: string; title: string | null } | null;
      } | null;
    }
    const { data, error } = await this.supabase
      .from('contract_positions')
      .select(
        `contract_id, position, capacity, signed_at, team_name_snapshot,
         contract:contracts(id, contract_number, status, relationship_kind,
           document_title, currency, client_hourly_rate, project_id, created_by,
           project:projects(id, title))`,
      )
      .eq('user_id', callerId);
    if (error) throw new Error(error.message);
    const seats = ((data ?? []) as unknown as SeatRow[]).filter(
      (seat) =>
        seat.contract !== null &&
        // A draft is private to its author until it is sent (two-way
        // contract authoring): the other seat does not see it yet.
        !(
          seat.contract.status === 'draft' &&
          seat.contract.created_by !== null &&
          seat.contract.created_by !== callerId
        ),
    );
    if (seats.length === 0) return [];

    // The OTHER position's display-name snapshot, per contract.
    const contractIds = [...new Set(seats.map((seat) => seat.contract_id))];
    const { data: siblingData, error: siblingError } = await this.supabase
      .from('contract_positions')
      .select(
        'contract_id, position, user_id, display_name_snapshot, team_name_snapshot',
      )
      .in('contract_id', contractIds);
    if (siblingError) throw new Error(siblingError.message);
    const siblings = (siblingData ?? []) as Array<{
      contract_id: string;
      position: string;
      user_id: string | null;
      display_name_snapshot: string | null;
      team_name_snapshot: string | null;
    }>;

    return seats.map((seat) => {
      const contract = seat.contract as NonNullable<SeatRow['contract']>;
      const counterparty = siblings.find(
        (row) =>
          row.contract_id === seat.contract_id &&
          row.position !== seat.position,
      );
      const view: AgreementView = {
        contract_id: contract.id,
        contract_number: contract.contract_number,
        status: contract.status,
        relationship_kind: contract.relationship_kind,
        my_position: seat.position,
        my_capacity: seat.capacity,
        counterparty_name: counterparty?.display_name_snapshot ?? null,
        project_id: contract.project_id,
        project_title: contract.project?.title ?? null,
        currency: contract.currency,
        signed_at: seat.signed_at,
        my_team_name: seat.team_name_snapshot,
        counterparty_team_name: counterparty?.team_name_snapshot ?? null,
        document_title: contract.document_title,
      };
      // Talent never receives the client price; and internal cost rates were
      // never selected in the first place.
      if (seat.capacity === 'client' || seat.capacity === 'consultant') {
        view.client_hourly_rate = contract.client_hourly_rate;
      }
      return view;
    });
  }

  // ── Time-composition reads (time-management rebuild, PR-1) ────────────────
  //
  // Everything below is a service-role read for TimeModule and the
  // assignment endpoints. None of it checks a caller: the caller of these
  // methods authorises (resolver, authority, assignments service), and none
  // of them is exposed by EngagementsController. They are the only reads of
  // the engagement tables outside this file's party-scoped views
  // (authorization-axes.md: only this module reads engagement tables).

  /**
   * The worker's assignments on a project at `at` (resolver step 2, L37).
   * `status <> 'cancelled'` and `started_at ≤ at < coalesce(ended_at, ∞)`.
   * By default only active assignments count; `includeEndedWindow` (manual
   * entries) also accepts an ended one whose window holds `at`. Each row
   * carries its governing engagement's kind, status and hirer label. The
   * engagement status is reported, not filtered: the resolver turns a
   * non-active one into `unavailable: 'engagement_inactive'`.
   * Order: `started_at`, then `id`.
   */
  async listActiveAssignmentsForWorker(
    workerId: string,
    projectId: string,
    at: Date,
    o: { includeEndedWindow?: boolean } = {},
  ): Promise<AssignmentContext[]> {
    const atIso = at.toISOString();
    let builder = this.supabase
      .from('engagement_assignments')
      .select(ASSIGNMENT_SELECT)
      .eq('worker_user_id', workerId)
      .eq('project_id', projectId)
      .lte('started_at', atIso);
    builder = o.includeEndedWindow
      ? builder
          .in('status', ['active', 'ended'])
          .or(`ended_at.is.null,ended_at.gt.${atIso}`)
      : builder.eq('status', 'active');
    const { data, error } = await builder
      .order('started_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) this.fail('listActiveAssignmentsForWorker', error);

    // The query already applies the window; re-checking it on parsed instants
    // keeps the rule exact whatever timestamp format PostgREST returns.
    const atMs = at.getTime();
    const rows = ((data ?? []) as unknown as AssignmentRow[]).filter(
      (row) =>
        (row.status === 'active' ||
          (o.includeEndedWindow === true && row.status === 'ended')) &&
        Date.parse(row.started_at) <= atMs &&
        (row.ended_at === null || atMs < Date.parse(row.ended_at)),
    );
    return this.toAssignmentContexts(rows);
  }

  async getAssignment(assignmentId: string): Promise<AssignmentContext | null> {
    const { data, error } = await this.supabase
      .from('engagement_assignments')
      .select(ASSIGNMENT_SELECT)
      .eq('id', assignmentId)
      .maybeSingle();
    if (error) this.fail('getAssignment', error);
    if (!data) return null;
    const [context] = await this.toAssignmentContexts([
      data as unknown as AssignmentRow,
    ]);
    return context ?? null;
  }

  /**
   * Every assignment on a project, whatever its status: masking and identity
   * apply to entries logged under ended and cancelled assignments too.
   * Order: `started_at`, then `id`.
   */
  async assignmentsForProject(projectId: string): Promise<AssignmentContext[]> {
    const { data, error } = await this.supabase
      .from('engagement_assignments')
      .select(ASSIGNMENT_SELECT)
      .eq('project_id', projectId)
      .order('started_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) this.fail('assignmentsForProject', error);
    return this.toAssignmentContexts(
      (data ?? []) as unknown as AssignmentRow[],
    );
  }

  async engagementKind(engagementId: string): Promise<EngagementKind | null> {
    const { data, error } = await this.supabase
      .from('engagements')
      .select('kind')
      .eq('id', engagementId)
      .maybeSingle();
    if (error) this.fail('engagementKind', error);
    return (data as { kind: EngagementKind } | null)?.kind ?? null;
  }

  async hirerUserIdForEngagement(engagementId: string): Promise<string | null> {
    return (await this.partySeat(engagementId, 'hirer'))?.user_id ?? null;
  }

  async providerUserIdForEngagement(
    engagementId: string,
  ): Promise<string | null> {
    return (await this.partySeat(engagementId, 'provider'))?.user_id ?? null;
  }

  /** The team the hirer seat signed for (L35, L7b); null when none or the team was deleted. */
  async hirerPartyTeamId(engagementId: string): Promise<string | null> {
    return (await this.partySeat(engagementId, 'hirer'))?.team_id ?? null;
  }

  /** The team the provider seat signed for (L7b); null when none or the team was deleted. */
  async providerPartyTeamId(engagementId: string): Promise<string | null> {
    return (await this.partySeat(engagementId, 'provider'))?.team_id ?? null;
  }

  /** The seat `userId` holds on the engagement, or null when they hold none. */
  async isParty(
    engagementId: string,
    userId: string,
  ): Promise<EngagementPosition | null> {
    const { data, error } = await this.supabase
      .from('engagement_parties')
      .select('position')
      .eq('engagement_id', engagementId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) this.fail('isParty', error);
    return (data as { position: EngagementPosition } | null)?.position ?? null;
  }

  /**
   * The `engagement_time_settings` row in force on a local date:
   * `effective_from ≤ d ≤ coalesce(effective_until, ∞)`, newest
   * `effective_from` first — the same pick as `time_resolve_policy`'s
   * contract layer (M1). An amendment closes the previous row the day
   * before it starts, so the boundary day belongs to exactly one version.
   */
  async settingsInForceOn(
    engagementId: string,
    localDate: string,
  ): Promise<EngagementTimeSettingsRow | null> {
    const { data, error } = await this.supabase
      .from('engagement_time_settings')
      .select(SETTINGS_SELECT)
      .eq('engagement_id', engagementId)
      .lte('effective_from', localDate)
      .order('effective_from', { ascending: false });
    if (error) this.fail('settingsInForceOn', error);
    const inForce = ratesInForceOn(
      (data ?? []) as unknown as EngagementTimeSettingsRow[],
      localDate,
    );
    return [...inForce].sort(newestEffectiveFirst)[0] ?? null;
  }

  /**
   * Every rate row of one kind on an engagement, all versions (callers apply
   * `ratesInForceOn` / `pickRate` for the local date). With `workerId`, rows
   * for that worker plus rows with no worker; without it, every row.
   */
  async ratesFor(
    engagementId: string,
    o: { rateKind: 'cost' | 'billing'; workerId?: string | null },
  ): Promise<EngagementTimeRateRow[]> {
    const { data, error } = await this.supabase
      .from('engagement_time_rates')
      .select(RATE_SELECT)
      .eq('engagement_id', engagementId)
      .eq('rate_kind', o.rateKind)
      .order('effective_from', { ascending: false });
    if (error) this.fail('ratesFor', error);
    const rows = (data ?? []) as unknown as EngagementTimeRateRow[];
    const workerId = o.workerId ?? null;
    if (workerId === null) return rows;
    return rows.filter(
      (row) =>
        (row.worker_user_id ?? null) === null ||
        row.worker_user_id === workerId,
    );
  }

  /**
   * Ids of every assignment billed through a client engagement, whatever its
   * status: entries logged before an assignment ended still bill (E16 a).
   */
  async assignmentIdsForClientEngagement(
    engagementId: string,
  ): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('engagement_assignments')
      .select('id')
      .eq('client_engagement_id', engagementId)
      .order('started_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) this.fail('assignmentIdsForClientEngagement', error);
    return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  }

  /**
   * The workspace whose time policy an engagement sheet falls back to.
   * Mirrors `time_sheet_scope_for`'s engagement branch (M1
   * `20261003090100_time_entries_expand.sql`) exactly:
   *   coalesce(contracts.workspace_id via engagements.activated_by_contract_id,
   *            the hirer party team's teams.workspace_id)
   * and null (platform default) when neither exists. Never the project's
   * workspace: one engagement sheet spans projects. It never gates.
   */
  async policyWorkspaceFor(engagementId: string): Promise<string | null> {
    const { data: engagement, error: engagementError } = await this.supabase
      .from('engagements')
      .select('activated_by_contract_id')
      .eq('id', engagementId)
      .maybeSingle();
    if (engagementError) this.fail('policyWorkspaceFor', engagementError);
    const contractId =
      (engagement as { activated_by_contract_id: string | null } | null)
        ?.activated_by_contract_id ?? null;

    if (contractId) {
      const { data: contract, error: contractError } = await this.supabase
        .from('contracts')
        .select('workspace_id')
        .eq('id', contractId)
        .maybeSingle();
      if (contractError) this.fail('policyWorkspaceFor', contractError);
      const workspaceId =
        (contract as { workspace_id: string | null } | null)?.workspace_id ??
        null;
      if (workspaceId) return workspaceId;
    }

    const hirerTeamId = await this.hirerPartyTeamId(engagementId);
    if (!hirerTeamId) return null;
    const { data: team, error: teamError } = await this.supabase
      .from('teams')
      .select('workspace_id')
      .eq('id', hirerTeamId)
      .maybeSingle();
    if (teamError) this.fail('policyWorkspaceFor', teamError);
    return (
      (team as { workspace_id: string | null } | null)?.workspace_id ?? null
    );
  }

  /**
   * The engagement a contract version governs: `contracts.engagement_id`
   * (set on the root and every signed amendment), else the engagement that
   * contract activated. Null for a legacy or unsigned contract.
   */
  async engagementForContract(
    contractId: string,
  ): Promise<{ id: string; kind: EngagementKind; status: string } | null> {
    const { data: contract, error: contractError } = await this.supabase
      .from('contracts')
      .select('engagement_id')
      .eq('id', contractId)
      .maybeSingle();
    if (contractError) this.fail('engagementForContract', contractError);
    const engagementId =
      (contract as { engagement_id: string | null } | null)?.engagement_id ??
      null;

    let builder = this.supabase
      .from('engagements')
      .select('id, kind, status, created_at');
    builder = engagementId
      ? builder.eq('id', engagementId)
      : builder.eq('activated_by_contract_id', contractId);
    const { data, error } = await builder
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) this.fail('engagementForContract', error);
    const row = (
      (data ?? []) as Array<{
        id: string;
        kind: EngagementKind;
        status: string;
      }>
    )[0];
    return row ? { id: row.id, kind: row.kind, status: row.status } : null;
  }

  /** An active `engagement_project_links` row joins the engagement to the project. */
  async isLinkedToProject(
    engagementId: string,
    projectId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('engagement_project_links')
      .select('id')
      .eq('engagement_id', engagementId)
      .eq('project_id', projectId)
      .eq('status', 'active')
      .limit(1);
    if (error) this.fail('isLinkedToProject', error);
    return ((data ?? []) as unknown[]).length > 0;
  }

  /** One party seat (the PK is (engagement_id, position), so at most one row). */
  private async partySeat(
    engagementId: string,
    position: EngagementPosition,
  ): Promise<{ user_id: string; team_id: string | null } | null> {
    const { data, error } = await this.supabase
      .from('engagement_parties')
      .select('user_id, team_id')
      .eq('engagement_id', engagementId)
      .eq('position', position)
      .maybeSingle();
    if (error) this.fail('partySeat', error);
    return (data as { user_id: string; team_id: string | null } | null) ?? null;
  }

  /**
   * Resolves each assignment's governing engagement (talent, else client)
   * with two batched reads: the engagements' kind and status, and their
   * hirer seats' display names. Preserves input order.
   */
  private async toAssignmentContexts(
    rows: AssignmentRow[],
  ): Promise<AssignmentContext[]> {
    if (rows.length === 0) return [];
    const governingId = (row: AssignmentRow): string | null =>
      row.talent_engagement_id ?? row.client_engagement_id;
    const ids = [
      ...new Set(
        rows
          .map(governingId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];

    const [engagementsResult, hirersResult] = await Promise.all([
      this.supabase
        .from('engagements')
        .select('id, kind, status')
        .in('id', ids),
      this.supabase
        .from('engagement_parties')
        .select('engagement_id, display_name_snapshot')
        .in('engagement_id', ids)
        .eq('position', 'hirer'),
    ]);
    if (engagementsResult.error) {
      this.fail('toAssignmentContexts', engagementsResult.error);
    }
    if (hirersResult.error) {
      this.fail('toAssignmentContexts', hirersResult.error);
    }

    const engagements = new Map(
      (
        (engagementsResult.data ?? []) as Array<{
          id: string;
          kind: EngagementKind;
          status: string;
        }>
      ).map((row) => [row.id, row]),
    );
    const hirerLabels = new Map(
      (
        (hirersResult.data ?? []) as Array<{
          engagement_id: string;
          display_name_snapshot: string | null;
        }>
      ).map((row) => [row.engagement_id, row.display_name_snapshot]),
    );

    const contexts: AssignmentContext[] = [];
    for (const row of rows) {
      const governing = governingId(row);
      // engagement_assignments_context_check makes this unreachable.
      if (!governing) continue;
      const engagement = engagements.get(governing);
      contexts.push({
        id: row.id,
        project_id: row.project_id,
        worker_user_id: row.worker_user_id,
        talent_engagement_id: row.talent_engagement_id,
        client_engagement_id: row.client_engagement_id,
        governing_engagement_id: governing,
        governing_kind:
          engagement?.kind ??
          (row.talent_engagement_id ? 'talent_services' : 'client_services'),
        // The FK is ON DELETE RESTRICT, so a missing row is not expected; an
        // unknown status reads as inactive to every caller.
        governing_status: engagement?.status ?? 'unknown',
        team_id: row.team_id,
        role_title: row.role_title,
        status: row.status,
        started_at: row.started_at,
        ended_at: row.ended_at,
        created_at: row.created_at,
        hirer_label: hirerLabels.get(governing) ?? UNKNOWN_HIRER_LABEL,
      });
    }
    return contexts;
  }

  /**
   * DB failures on the time-composition reads: log the Postgres text, answer
   * a plain 500 (§0: no Postgres text in a response body).
   */
  private fail(operation: string, error: { message: string }): never {
    this.logger.error(
      `EngagementsService.${operation} failed: ${error.message}`,
    );
    throw new InternalServerErrorException(
      "Proyekto couldn't load the agreement details. Try again.",
    );
  }

  /** The caller's own seat on each engagement they are a party to. */
  private async seatsFor(
    callerId: string,
  ): Promise<Map<string, EngagementPartyRow>> {
    const { data, error } = await this.supabase
      .from('engagement_parties')
      .select(PARTY_SELECT)
      .eq('user_id', callerId);
    if (error) throw new Error(error.message);

    const seats = new Map<string, EngagementPartyRow>();
    for (const row of (data ?? []) as unknown as EngagementPartyRow[]) {
      seats.set(row.engagement_id, row);
    }
    return seats;
  }

  private async compose(
    engagements: EngagementRow[],
    seats: Map<string, EngagementPartyRow>,
  ): Promise<EngagementView[]> {
    if (engagements.length === 0) return [];
    const ids = engagements.map((engagement) => engagement.id);
    const today = new Date().toISOString().slice(0, 10);

    const [parties, links, settings, rates] = await Promise.all([
      this.fetch<EngagementPartyRow>('engagement_parties', PARTY_SELECT, ids),
      this.fetch<EngagementProjectLinkRow>(
        'engagement_project_links',
        PROJECT_LINK_SELECT,
        ids,
      ),
      this.fetch<EngagementTimeSettingsRow>(
        'engagement_time_settings',
        SETTINGS_SELECT,
        ids,
      ),
      this.fetch<EngagementTimeRateRow>(
        'engagement_time_rates',
        RATE_SELECT,
        ids,
      ),
    ]);

    return engagements.map((engagement) => {
      const seat = seats.get(engagement.id);
      const counterpartyRow = parties.find(
        (party) =>
          party.engagement_id === engagement.id &&
          party.position !== seat?.position,
      );
      return {
        ...engagement,
        viewer_position: seat?.position ?? 'provider',
        viewer_capacity: seat?.capacity ?? '',
        viewer_team:
          seat?.team_id && seat.team_name_snapshot
            ? { id: seat.team_id, name: seat.team_name_snapshot }
            : null,
        // Built field by field rather than spread so `engagement_id` cannot
        // ride along, and so adding a column to the table never silently
        // widens what a counterparty exposes.
        counterparty: counterpartyRow
          ? {
              position: counterpartyRow.position,
              user_id: counterpartyRow.user_id,
              capacity: counterpartyRow.capacity,
              display_name_snapshot: counterpartyRow.display_name_snapshot,
              email_snapshot: counterpartyRow.email_snapshot,
              // The name only: which team a party signed for is on the paper
              // both of them signed; its id is not the viewer's business.
              team_name_snapshot: counterpartyRow.team_name_snapshot,
            }
          : null,
        project_links: links.filter(
          (link) => link.engagement_id === engagement.id,
        ),
        current_settings:
          settings.find(
            (row) =>
              row.engagement_id === engagement.id && isEffective(row, today),
          ) ?? null,
        current_rates: rates.filter(
          (row) =>
            row.engagement_id === engagement.id && isEffective(row, today),
        ),
      };
    });
  }

  private async fetch<T>(
    table: string,
    select: string,
    ids: string[],
  ): Promise<T[]> {
    const { data, error } = await this.supabase
      .from(table)
      .select(select)
      .in('engagement_id', ids);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as T[];
  }
}
