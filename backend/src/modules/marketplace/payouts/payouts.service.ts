import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { isTeamManager } from '../../execution/teams/team-authority';
import {
  mapTimeDbError,
  type PgErrorLike,
  throwTimeDb,
  timeError,
  timeNotFound,
} from '../../execution/time/time-errors';
import { TimeNotificationsService } from '../../execution/time/time-notifications.service';
import {
  addDays,
  localDate,
  localRangeToUtc,
} from '../../execution/time/time-periods';
import { TimePolicyService } from '../../execution/time/time-policy.service';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { UploadsService } from '../../shared/uploads/uploads.controller';
import {
  CreatePayoutDto,
  CreatePayoutMethodDto,
  UpdatePayoutMethodDto,
} from './dto/payouts.dto';
import { QaFixturePolicyService } from '../../shared/qa-fixtures/qa-fixture-policy.service';

const PAYOUT_METHOD_SELECT = `
  id, user_id, method_type, label, account_name, account_identifier,
  bank_name, currency, qr_path, is_default, is_archived, created_at, updated_at
`;

const PAYOUT_SELECT = `
  id, team_id, member_user_id, created_by, payout_method_id,
  method_type, method_label, method_account_name, method_account_identifier,
  method_bank_name, currency, total_amount, reference_number, proof_path,
  note, paid_at, status, source, created_at, updated_at,
  member:profiles!payouts_member_user_id_fkey(id, display_name, avatar_url, first_name, last_name, email),
  creator:profiles!payouts_created_by_fkey(id, display_name, avatar_url)
`;

export interface PayoutMethodRow {
  id: string;
  user_id: string;
  method_type: string;
  label: string | null;
  account_name: string;
  account_identifier: string;
  bank_name: string | null;
  currency: string | null;
  qr_path: string | null;
  /** Short-lived presigned GET for qr_path, computed on read (null if none). */
  qr_url?: string | null;
  is_default: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface PayoutRow {
  id: string;
  team_id: string;
  member_user_id: string;
  created_by: string;
  payout_method_id: string | null;
  method_type: string | null;
  method_label: string | null;
  method_account_name: string | null;
  method_account_identifier: string | null;
  method_bank_name: string | null;
  currency: string;
  total_amount: number;
  reference_number: string | null;
  proof_path: string | null;
  note: string | null;
  paid_at: string;
  status: 'recorded' | 'void';
  source: 'batch' | 'quick';
  created_at: string;
  updated_at: string;
}

/**
 * The pre-check's view of an entry: who and what it belongs to, and whether it
 * is Owed. Never `status` (it drops in M5; owed-ness is payable_seconds +
 * payout_id + legacy_status, CHANGE-5).
 */
const PAYABLE_CHECK_SELECT =
  'id, team_id, member_user_id, context_kind, payout_id, legacy_status, ' +
  'payable_seconds, rate_type_snapshot, currency_snapshot';

/** Owed rows. Column hints only: time-table FK names rename in M5. */
const OWED_SELECT =
  'id, member_user_id, currency_snapshot, payable_seconds, rate_snapshot, ' +
  'member:profiles!member_user_id(id, display_name, avatar_url, first_name, last_name, email)';

/** A payout's entries (`logs` and `entries` in GET /payouts/:id). */
const PAYOUT_ENTRY_SELECT =
  'id, project_id, task_id, started_at, ended_at, duration_seconds, payable_seconds, ' +
  'rate_snapshot, rate_type_snapshot, currency_snapshot, ' +
  'task:roadmap_tasks!task_id(id, title), project:projects!project_id(id, title)';

/** Owed is read in pages; PostgREST caps a response at 1000 rows. */
const OWED_PAGE = 1000;

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Copy for refusals the payout RPCs raise as plain text (never echoed: D55). */
const PAYOUT_NOT_PAYABLE_MESSAGE =
  "Some of this time can't be paid any more. Reload and try again.";
const PAYOUT_ALREADY_VOID_MESSAGE = 'This payment is already void.';
const PAYOUT_VOID_REFUSED_MESSAGE =
  "Proyekto couldn't void this payment. Reload and try again.";

interface PayableEntryRow {
  id: string;
  team_id: string | null;
  member_user_id: string | null;
  context_kind: string;
  payout_id: string | null;
  legacy_status: string | null;
  payable_seconds: number | null;
  rate_type_snapshot: string;
  currency_snapshot: string;
}

interface TeamGateRow {
  id: string;
  owner_id: string;
  workspace_id: string | null;
  time_tracking_enabled: boolean;
  payouts_enabled: boolean;
}

export interface OwedMember {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

export interface OwedRow {
  member_user_id: string;
  member: OwedMember | null;
  currency: string;
  /** Kept for today's callers (D37); always equals entry_count. */
  log_count: number;
  entry_count: number;
  hours: number;
  amount: number;
}

export interface PayoutDetail extends PayoutRow {
  /** Kept for today's web (D37); the same rows as `entries`. */
  logs: unknown[];
  entries: unknown[];
}

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly uploads: UploadsService,
    private readonly qaFixtures: QaFixturePolicyService,
    private readonly entitlements: EntitlementsService,
    private readonly timePolicy: TimePolicyService,
    private readonly timeNotifications: TimeNotificationsService,
  ) {}

  // ─── payout methods (owner-scoped) ───────────────────────────────────

  async listMyMethods(userId: string): Promise<PayoutMethodRow[]> {
    const { data, error } = await this.supabase
      .from('payout_methods')
      .select(PAYOUT_METHOD_SELECT)
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return this.attachQrUrls((data ?? []) as unknown as PayoutMethodRow[]);
  }

  async createMethod(
    userId: string,
    dto: CreatePayoutMethodDto,
  ): Promise<PayoutMethodRow> {
    if (dto.method_type === 'bank' && !dto.bank_name?.trim()) {
      throw new BadRequestException('Bank name is required for bank accounts.');
    }
    const makeDefault =
      dto.is_default === true || (await this.countActiveMethods(userId)) === 0;
    if (makeDefault) await this.clearDefault(userId);

    const { data, error } = await this.supabase
      .from('payout_methods')
      .insert({
        user_id: userId,
        method_type: dto.method_type,
        label: dto.label ?? null,
        account_name: dto.account_name,
        account_identifier: dto.account_identifier,
        bank_name: dto.method_type === 'bank' ? (dto.bank_name ?? null) : null,
        currency: dto.currency ?? null,
        qr_path: dto.qr_path || null,
        is_default: makeDefault,
      })
      .select(PAYOUT_METHOD_SELECT)
      .single();
    if (error) throw new Error(error.message);
    return this.attachQrUrl(data as unknown as PayoutMethodRow);
  }

  async updateMethod(
    userId: string,
    methodId: string,
    dto: UpdatePayoutMethodDto,
  ): Promise<PayoutMethodRow> {
    const existing = await this.fetchOwnMethodOrThrow(userId, methodId);
    const nextType = dto.method_type ?? existing.method_type;
    if (nextType === 'bank') {
      const nextBank =
        dto.bank_name !== undefined ? dto.bank_name : existing.bank_name;
      if (!nextBank?.trim()) {
        throw new BadRequestException(
          'Bank name is required for bank accounts.',
        );
      }
    }

    if (dto.is_default === true) await this.clearDefault(userId);

    const patch: Record<string, unknown> = {};
    if (dto.method_type !== undefined) patch.method_type = dto.method_type;
    if (dto.label !== undefined) patch.label = dto.label;
    if (dto.account_name !== undefined) patch.account_name = dto.account_name;
    if (dto.account_identifier !== undefined)
      patch.account_identifier = dto.account_identifier;
    if (dto.bank_name !== undefined)
      patch.bank_name = nextType === 'bank' ? dto.bank_name : null;
    else if (nextType !== 'bank') patch.bank_name = null;
    if (dto.currency !== undefined) patch.currency = dto.currency;
    // Empty string clears the QR; a non-empty key replaces it.
    if (dto.qr_path !== undefined) patch.qr_path = dto.qr_path || null;
    if (dto.is_default !== undefined) patch.is_default = dto.is_default;

    const { data, error } = await this.supabase
      .from('payout_methods')
      .update(patch)
      .eq('id', methodId)
      .eq('user_id', userId)
      .select(PAYOUT_METHOD_SELECT)
      .single();
    if (error) throw new Error(error.message);
    return this.attachQrUrl(data as unknown as PayoutMethodRow);
  }

  async deleteMethod(userId: string, methodId: string): Promise<void> {
    await this.fetchOwnMethodOrThrow(userId, methodId);
    // Payouts snapshot the method fields and the FK is ON DELETE SET NULL, so
    // deleting is safe for historical records.
    const { error } = await this.supabase
      .from('payout_methods')
      .delete()
      .eq('id', methodId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  async setDefaultMethod(
    userId: string,
    methodId: string,
  ): Promise<PayoutMethodRow> {
    await this.fetchOwnMethodOrThrow(userId, methodId);
    await this.clearDefault(userId);
    const { data, error } = await this.supabase
      .from('payout_methods')
      .update({ is_default: true })
      .eq('id', methodId)
      .eq('user_id', userId)
      .select(PAYOUT_METHOD_SELECT)
      .single();
    if (error) throw new Error(error.message);
    return this.attachQrUrl(data as unknown as PayoutMethodRow);
  }

  // Cross-user read: a paying approver views a member's methods.
  async listMemberMethodsForPayer(
    callerId: string,
    teamId: string,
    memberId: string,
  ): Promise<PayoutMethodRow[]> {
    await this.assertTeamPayer(callerId, teamId);
    await this.assertMemberOfTeam(memberId, teamId);
    const { data, error } = await this.supabase
      .from('payout_methods')
      .select(PAYOUT_METHOD_SELECT)
      .eq('user_id', memberId)
      .eq('is_archived', false)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return this.attachQrUrls((data ?? []) as unknown as PayoutMethodRow[]);
  }

  // ─── payouts ──────────────────────────────────────────────────────────

  /**
   * Records a payment for Owed team entries (approved, team context, no payout,
   * no legacy marker; CHANGE-5) of one member and one currency. The RPC still
   * takes `p_log_ids` and recomputes the authoritative total
   * (round(Σ payable_seconds/3600 × rate_snapshot, 2), once); the checks here
   * give the caller a precise refusal before it runs.
   */
  async createPayout(
    callerId: string,
    dto: CreatePayoutDto,
  ): Promise<PayoutRow> {
    const entryIds = this.requestedEntryIds(dto);
    await this.assertCanSettle(callerId, dto.team_id);
    await this.qaFixtures.assertTeamSideEffectAllowed(
      dto.team_id,
      'Payout creation',
    );
    // Also refused by the RPC; checked first so the caller gets the 403
    // without any entry being read.
    if (callerId === dto.member_user_id) {
      throw timeError('PAYOUT_SELF_NOT_ALLOWED');
    }

    const currency = await this.assertEntriesPayable(dto, entryIds);

    if (dto.payout_method_id) {
      // Confirm the chosen method belongs to the member being paid.
      const { data: method, error: methodErr } = await this.supabase
        .from('payout_methods')
        .select('id')
        .eq('id', dto.payout_method_id)
        .eq('user_id', dto.member_user_id)
        .maybeSingle();
      if (methodErr) throwTimeDb(methodErr as PgErrorLike);
      if (!method) {
        throw new BadRequestException(
          'Selected payout method does not belong to this member.',
        );
      }
    }

    const { data: created, error: rpcErr } = (await this.supabase.rpc(
      'create_payout_and_mark_paid',
      {
        p_team_id: dto.team_id,
        p_member_user_id: dto.member_user_id,
        p_created_by: callerId,
        p_currency: currency,
        // The RPC keeps its parameter name (L15); the values are entry ids.
        p_log_ids: entryIds,
        p_payout_method_id: dto.payout_method_id ?? null,
        p_reference_number: dto.reference_number ?? null,
        p_proof_path: dto.proof_path ?? null,
        p_note: dto.note ?? null,
        p_paid_at: dto.paid_at ?? new Date().toISOString(),
        p_source: dto.source ?? 'batch',
      },
    )) as { data: unknown; error: PgErrorLike | null };
    if (rpcErr) this.payoutRpcError(rpcErr, 'create');
    const payout = created as PayoutRow;

    // Awaited, never detached (Cloud Run freezes CPU after the response), and
    // it never throws (D51). The notice carries no amount (CHANGE-19).
    await this.timeNotifications.payoutRecorded(
      {
        id: payout.id,
        member_user_id: payout.member_user_id,
        team_id: payout.team_id,
      },
      entryIds.length,
      callerId,
    );
    return payout;
  }

  async listTeamPayouts(
    callerId: string,
    teamId: string,
    memberId?: string,
  ): Promise<PayoutRow[]> {
    await this.assertTeamPayer(callerId, teamId);
    let q = this.supabase
      .from('payouts')
      .select(PAYOUT_SELECT)
      .eq('team_id', teamId)
      .order('paid_at', { ascending: false });
    if (memberId) q = q.eq('member_user_id', memberId);
    const { data, error } = await q;
    if (error) throwTimeDb(error as PgErrorLike);
    return (data ?? []) as unknown as PayoutRow[];
  }

  /**
   * Outstanding balances: Owed team entries (approved, team context, no
   * payout, no legacy marker; fixed-rate time excluded, since it is paid
   * manually) grouped by (member, currency). `from` / `until` are local dates
   * in the team's policy timezone (L65), turned into UTC instants; never a raw
   * comparison on started_at. Each bucket's amount is
   * round(Σ payable_seconds/3600 × rate_snapshot, 2), rounded once, which is
   * what the payout RPC would record for the same entries. `pay_period_config`
   * only suggests `until`; the web picks it.
   */
  async listTeamOwed(
    callerId: string,
    teamId: string,
    range: { from?: string; until?: string } = {},
  ): Promise<OwedRow[]> {
    await this.assertCanSettle(callerId, teamId);
    const tz = await this.timePolicy.teamTimezone(teamId);
    const fromDate = this.owedDateBound(range.from, tz, 'from');
    const untilDate = this.owedDateBound(range.until, tz, 'until');
    const fromIso = fromDate
      ? localRangeToUtc({ start: fromDate, end: fromDate }, tz).fromIso
      : null;
    const untilExclusiveIso = untilDate
      ? localRangeToUtc({ start: untilDate, end: untilDate }, tz).toExclusiveIso
      : null;

    type Bucket = Omit<OwedRow, 'hours' | 'amount'> & {
      seconds: number;
      raw: number;
    };
    const map = new Map<string, Bucket>();

    for (let offset = 0; ; offset += OWED_PAGE) {
      let q = this.supabase
        .from('time_entries')
        .select(OWED_SELECT)
        .eq('team_id', teamId)
        .eq('context_kind', 'team')
        .not('payable_seconds', 'is', null)
        .is('payout_id', null)
        .is('legacy_status', null)
        .neq('rate_type_snapshot', 'fixed');
      if (fromIso) q = q.gte('started_at', fromIso);
      if (untilExclusiveIso) q = q.lt('started_at', untilExclusiveIso);

      const { data, error } = await q
        .order('started_at', { ascending: false })
        .order('id', { ascending: true })
        .range(offset, offset + OWED_PAGE - 1);
      if (error) throwTimeDb(error as PgErrorLike);
      const rows = (data ?? []) as unknown as Array<{
        id: string;
        member_user_id: string;
        currency_snapshot: string | null;
        payable_seconds: number | null;
        rate_snapshot: number | string | null;
        member: OwedMember | OwedMember[] | null;
      }>;
      for (const row of rows) {
        const currency = row.currency_snapshot || 'USD';
        const key = `${row.member_user_id}:${currency}`;
        let bucket = map.get(key);
        if (!bucket) {
          bucket = {
            member_user_id: row.member_user_id,
            member: Array.isArray(row.member)
              ? (row.member[0] ?? null)
              : (row.member ?? null),
            currency,
            log_count: 0,
            entry_count: 0,
            seconds: 0,
            raw: 0,
          };
          map.set(key, bucket);
        }
        const seconds = Math.max(0, row.payable_seconds ?? 0);
        const rate = Number(row.rate_snapshot ?? 0);
        bucket.log_count += 1;
        bucket.entry_count += 1;
        bucket.seconds += seconds;
        if (Number.isFinite(rate) && rate > 0) {
          bucket.raw += (seconds / 3600) * rate;
        }
      }
      if (rows.length < OWED_PAGE) break;
    }

    return Array.from(map.values())
      .map(
        (b): OwedRow => ({
          member_user_id: b.member_user_id,
          member: b.member,
          currency: b.currency,
          log_count: b.log_count,
          entry_count: b.entry_count,
          hours: b.seconds / 3600,
          // Once per (member, currency), never per entry (L63).
          amount: Math.round(b.raw * 100) / 100,
        }),
      )
      .sort((a, b) => b.amount - a.amount);
  }

  /**
   * A payout and the entries it paid. `logs` is kept for today's web (D37)
   * and `entries` carries the same rows. Each row says `status: 'paid'`, as
   * the old per-log status did, without reading time_entries.status: every
   * entry still pointing at this payout is paid by it.
   */
  async getPayout(callerId: string, payoutId: string): Promise<PayoutDetail> {
    const payout = await this.fetchPayoutOrThrow(payoutId);
    await this.assertCanViewPayout(callerId, payout);
    const { data, error } = await this.supabase
      .from('time_entries')
      .select(PAYOUT_ENTRY_SELECT)
      .eq('payout_id', payoutId)
      .order('started_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) throwTimeDb(error as PgErrorLike);
    const entries = ((data ?? []) as unknown as Record<string, unknown>[]).map(
      (row) => ({ ...row, status: 'paid' }),
    );
    return { ...payout, logs: entries, entries };
  }

  /** Never plan-gated: a team on a lower plan can always undo a payment. */
  async voidPayout(callerId: string, payoutId: string): Promise<PayoutRow> {
    const payout = await this.fetchPayoutOrThrow(payoutId);
    await this.assertTeamPayer(callerId, payout.team_id);
    const { data, error } = (await this.supabase.rpc('void_payout_and_revert', {
      p_payout_id: payoutId,
      p_actor: callerId,
    })) as { data: unknown; error: PgErrorLike | null };
    if (error) this.payoutRpcError(error, 'void');
    return data as PayoutRow;
  }

  async getProofUrl(
    callerId: string,
    payoutId: string,
  ): Promise<{ url: string }> {
    const payout = await this.fetchPayoutOrThrow(payoutId);
    await this.assertCanViewPayout(callerId, payout);
    if (!payout.proof_path) {
      throw new NotFoundException('This payout has no proof attached.');
    }
    const url = await this.uploads.getPrivateSignedUrl(payout.proof_path);
    return { url };
  }

  // ─── helpers ──────────────────────────────────────────────────────────

  /** Attach a short-lived presigned GET for the method's QR (null if none). */
  private async attachQrUrl(row: PayoutMethodRow): Promise<PayoutMethodRow> {
    if (!row.qr_path) return { ...row, qr_url: null };
    try {
      const qr_url = await this.uploads.getPrivateSignedUrl(row.qr_path);
      return { ...row, qr_url };
    } catch (err) {
      this.logger.warn(`Failed to presign QR: ${(err as Error).message}`);
      return { ...row, qr_url: null };
    }
  }

  private async attachQrUrls(
    rows: PayoutMethodRow[],
  ): Promise<PayoutMethodRow[]> {
    return Promise.all(rows.map((r) => this.attachQrUrl(r)));
  }

  private async countActiveMethods(userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('payout_methods')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_archived', false);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  private async clearDefault(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('payout_methods')
      .update({ is_default: false })
      .eq('user_id', userId)
      .eq('is_default', true);
    if (error) throw new Error(error.message);
  }

  private async fetchOwnMethodOrThrow(
    userId: string,
    methodId: string,
  ): Promise<PayoutMethodRow> {
    const { data, error } = await this.supabase
      .from('payout_methods')
      .select(PAYOUT_METHOD_SELECT)
      .eq('id', methodId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Payout method not found.');
    return data as unknown as PayoutMethodRow;
  }

  private async fetchPayoutOrThrow(payoutId: string): Promise<PayoutRow> {
    const { data, error } = await this.supabase
      .from('payouts')
      .select(PAYOUT_SELECT)
      .eq('id', payoutId)
      .maybeSingle();
    if (error) throwTimeDb(error as PgErrorLike);
    if (!data) throw new NotFoundException('Payout not found.');
    return data as unknown as PayoutRow;
  }

  /** The member reads their own payouts with no other check (never gated). */
  private async assertCanViewPayout(
    callerId: string,
    payout: PayoutRow,
  ): Promise<void> {
    if (payout.member_user_id === callerId) return;
    await this.assertTeamPayer(callerId, payout.team_id);
  }

  /**
   * A team manager (isTeamManager: owner_id, or a team_members role of
   * owner/admin) of a team that tracks time and records payouts here. Flags
   * are checked after the manager check, so someone outside the team learns
   * nothing about its settings. No plan check: listing, viewing and voiding
   * stay open on any plan (only create and owed need time_payouts).
   */
  private async assertTeamPayer(
    callerId: string,
    teamId: string,
  ): Promise<TeamGateRow> {
    const { data, error } = await this.supabase
      .from('teams')
      .select(
        'id, owner_id, workspace_id, time_tracking_enabled, payouts_enabled',
      )
      .eq('id', teamId)
      .maybeSingle();
    if (error) throwTimeDb(error as PgErrorLike);
    if (!data) throw new NotFoundException('Team not found.');
    const team = data as TeamGateRow;
    if (!(await isTeamManager(this.supabase, teamId, callerId))) {
      throw new ForbiddenException(
        'Only the team owner or team admins can manage payouts.',
      );
    }
    if (!team.time_tracking_enabled) {
      throw new ForbiddenException(
        'Time tracking is not enabled for this team.',
      );
    }
    // Payouts is its own switch, nested under member rates: a team can price
    // its hours without settling them here. The DB CHECK guarantees this flag
    // is false whenever rates are, so testing it alone is sufficient.
    if (!team.payouts_enabled) {
      throw new ForbiddenException('Payouts are disabled for this team.');
    }
    return team;
  }

  /**
   * assertTeamPayer plus the time_payouts plan key on the team's plan subject
   * (D26: its workspace, else the team scope; never a raw null). Create and
   * owed only. A PlanLimitException (403), so the web shows its upgrade
   * prompt.
   */
  private async assertCanSettle(
    callerId: string,
    teamId: string,
  ): Promise<TeamGateRow> {
    const team = await this.assertTeamPayer(callerId, teamId);
    await this.entitlements.assertFeature(
      await this.timePolicy.planRefForTeam(team),
      'time_payouts',
    );
    return team;
  }

  /** Exactly one of entry_ids / log_ids (D37), deduplicated in order. */
  private requestedEntryIds(dto: CreatePayoutDto): string[] {
    const entryIds = dto.entry_ids ?? [];
    const logIds = dto.log_ids ?? [];
    if (entryIds.length > 0 && logIds.length > 0) {
      throw new BadRequestException(
        'Send entry_ids or log_ids, not both. log_ids is the old name for entry_ids.',
      );
    }
    const ids = entryIds.length > 0 ? entryIds : logIds;
    if (ids.length === 0) {
      throw new BadRequestException('Choose the time to pay (entry_ids).');
    }
    return Array.from(new Set(ids));
  }

  /**
   * Every requested entry is Owed team time of this member on this team, none
   * is fixed-rate, and all share one currency, which is returned. Entries
   * that do not exist, or belong to another team, are a 404 (never confirming
   * that someone else's entry exists).
   */
  private async assertEntriesPayable(
    dto: CreatePayoutDto,
    entryIds: string[],
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from('time_entries')
      .select(PAYABLE_CHECK_SELECT)
      .in('id', entryIds);
    if (error) throwTimeDb(error as PgErrorLike);
    const rows = ((data ?? []) as unknown as PayableEntryRow[]).filter(
      (row) => row.team_id === dto.team_id,
    );
    if (rows.length !== entryIds.length) throw timeNotFound('entry');

    if (rows.some((row) => row.member_user_id !== dto.member_user_id)) {
      throw new BadRequestException(
        'All of this time must belong to the member being paid.',
      );
    }
    // Fixed pay is a manual payment (L9/L62, E61); also refused by the RPC.
    if (rows.some((row) => row.rate_type_snapshot === 'fixed')) {
      throw timeError('FIXED_RATE_NOT_PAYABLE_BY_ENTRY');
    }
    if (rows.some((row) => row.payout_id !== null)) {
      throw new BadRequestException('Some of this time is already paid.');
    }
    if (
      rows.some(
        (row) =>
          row.context_kind !== 'team' ||
          row.payable_seconds === null ||
          row.legacy_status !== null,
      )
    ) {
      throw new BadRequestException(
        'Only approved team time that is not paid yet can be paid.',
      );
    }
    const currencies = new Set(rows.map((row) => row.currency_snapshot));
    if (currencies.size !== 1) {
      throw new BadRequestException(
        'A payment must cover time in a single currency.',
      );
    }
    return rows[0].currency_snapshot;
  }

  /**
   * A local date bound for owed: YYYY-MM-DD as is, or an instant (the old
   * `from`/`to` took timestamps) read as its local date in the team timezone.
   */
  private owedDateBound(
    raw: string | undefined,
    tz: string,
    field: 'from' | 'until',
  ): string | null {
    const value = raw?.trim();
    if (!value) return null;
    try {
      if (LOCAL_DATE_RE.test(value)) return addDays(value, 0);
      if (!Number.isNaN(Date.parse(value))) return localDate(value, tz);
    } catch {
      // falls through to the 400
    }
    throw new BadRequestException(`${field} must be a date (YYYY-MM-DD).`);
  }

  /**
   * Payout RPC failures: time sentinels map through mapTimeDbError
   * (PAYOUT_SELF_NOT_ALLOWED 403, FIXED_RATE_NOT_PAYABLE_BY_ENTRY 422); the
   * RPCs' plain-text refusals (a race with another payment or a reopen) are a
   * 400 with fixed copy, the Postgres text going to the log only (D55).
   */
  private payoutRpcError(error: PgErrorLike, op: 'create' | 'void'): never {
    const mapped = mapTimeDbError(error);
    if (mapped) throw mapped;
    if (error.code === 'P0001') {
      this.logger.warn(
        `Payout ${op} refused by the database: ${error.message ?? ''}`,
      );
      if (op === 'create') {
        throw new BadRequestException(PAYOUT_NOT_PAYABLE_MESSAGE);
      }
      throw new BadRequestException(
        /already void/i.test(error.message ?? '')
          ? PAYOUT_ALREADY_VOID_MESSAGE
          : PAYOUT_VOID_REFUSED_MESSAGE,
      );
    }
    throwTimeDb(error);
  }

  private async assertMemberOfTeam(
    memberId: string,
    teamId: string,
  ): Promise<void> {
    const { data: team } = await this.supabase
      .from('teams')
      .select('owner_id')
      .eq('id', teamId)
      .maybeSingle();
    if ((team as { owner_id: string } | null)?.owner_id === memberId) return;
    const { count, error } = await this.supabase
      .from('team_members')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('user_id', memberId);
    if (error) throw new Error(error.message);
    if (!count) {
      throw new BadRequestException('That member is not on this team.');
    }
  }
}
