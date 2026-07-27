import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.controller';
import {
  CreatePayoutDto,
  CreatePayoutMethodDto,
  UpdatePayoutMethodDto,
} from './dto/payouts.dto';

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

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly notifications: NotificationsService,
    private readonly uploads: UploadsService,
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
    await this.assertTeamApprover(callerId, teamId);
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

  async createPayout(callerId: string, dto: CreatePayoutDto): Promise<PayoutRow> {
    await this.assertTeamApprover(callerId, dto.team_id);
    if (callerId === dto.member_user_id) {
      throw new ForbiddenException('You cannot pay your own time logs.');
    }

    const { data, error } = await this.supabase
      .from('task_time_logs')
      .select('id, team_id, member_user_id, status, payout_id, currency_snapshot')
      .in('id', dto.log_ids);
    if (error) throw new Error(error.message);
    const logs = (data ?? []) as Array<{
      id: string;
      team_id: string | null;
      member_user_id: string;
      status: string;
      payout_id: string | null;
      currency_snapshot: string;
    }>;

    if (logs.length !== dto.log_ids.length) {
      throw new NotFoundException('One or more logs were not found.');
    }
    for (const log of logs) {
      if (log.team_id !== dto.team_id || log.member_user_id !== dto.member_user_id) {
        throw new BadRequestException(
          'All logs must belong to the same member and team.',
        );
      }
      if (log.status !== 'approved') {
        throw new BadRequestException('Only approved logs can be paid.');
      }
      if (log.payout_id) {
        throw new BadRequestException('One or more logs are already paid.');
      }
    }
    const currencies = new Set(logs.map((l) => l.currency_snapshot));
    if (currencies.size !== 1) {
      throw new BadRequestException(
        'A payout must cover logs of a single currency.',
      );
    }
    const currency = logs[0].currency_snapshot;

    if (dto.payout_method_id) {
      // Confirm the chosen method belongs to the member being paid.
      const { data: method, error: methodErr } = await this.supabase
        .from('payout_methods')
        .select('id')
        .eq('id', dto.payout_method_id)
        .eq('user_id', dto.member_user_id)
        .maybeSingle();
      if (methodErr) throw new Error(methodErr.message);
      if (!method) {
        throw new BadRequestException(
          'Selected payout method does not belong to this member.',
        );
      }
    }

    const { data: created, error: rpcErr } = await this.supabase.rpc(
      'create_payout_and_mark_paid',
      {
        p_team_id: dto.team_id,
        p_member_user_id: dto.member_user_id,
        p_created_by: callerId,
        p_currency: currency,
        p_log_ids: dto.log_ids,
        p_payout_method_id: dto.payout_method_id ?? null,
        p_reference_number: dto.reference_number ?? null,
        p_proof_path: dto.proof_path ?? null,
        p_note: dto.note ?? null,
        p_paid_at: dto.paid_at ?? new Date().toISOString(),
        p_source: dto.source ?? 'batch',
      },
    );
    if (rpcErr) throw new BadRequestException(rpcErr.message);
    const payout = created as unknown as PayoutRow;

    await this.notifyPaid(payout, callerId, dto.log_ids.length);
    return payout;
  }

  async listTeamPayouts(
    callerId: string,
    teamId: string,
    memberId?: string,
  ): Promise<PayoutRow[]> {
    await this.assertTeamApprover(callerId, teamId);
    let q = this.supabase
      .from('payouts')
      .select(PAYOUT_SELECT)
      .eq('team_id', teamId)
      .order('paid_at', { ascending: false });
    if (memberId) q = q.eq('member_user_id', memberId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PayoutRow[];
  }

  /**
   * Outstanding balances owed to members: approved (⟹ unpaid) logs grouped by
   * (member, currency), summed with the same fee formula the payout RPC uses.
   * Drives the Payouts page "To pay" section. Optional from/to scopes it to a
   * cut-off window. A member can appear once per currency they have logs in.
   */
  async listTeamOwed(
    callerId: string,
    teamId: string,
    from?: string,
    to?: string,
  ): Promise<
    Array<{
      member_user_id: string;
      member: {
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
      } | null;
      currency: string;
      log_count: number;
      hours: number;
      amount: number;
    }>
  > {
    await this.assertTeamApprover(callerId, teamId);
    const PAGE = 1000;
    type Bucket = {
      member_user_id: string;
      member: {
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
      } | null;
      currency: string;
      log_count: number;
      seconds: number;
      amount: number;
    };
    const map = new Map<string, Bucket>();

    for (let offset = 0; ; offset += PAGE) {
      let q = this.supabase
        .from('task_time_logs')
        .select(
          `member_user_id, currency_snapshot, duration_seconds, rate_snapshot,
           member:profiles!task_time_logs_member_user_id_fkey(id, display_name, avatar_url, first_name, last_name, email)`,
        )
        .eq('team_id', teamId)
        .eq('status', 'approved')
        .is('payout_id', null)
        .order('started_at', { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (from) q = q.gte('started_at', from);
      if (to) q = q.lte('started_at', to);

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as Array<{
        member_user_id: string;
        currency_snapshot: string | null;
        duration_seconds: number | null;
        rate_snapshot: number | string | null;
        member: Bucket['member'];
      }>;
      for (const row of rows) {
        const currency = row.currency_snapshot || 'USD';
        const key = `${row.member_user_id}:${currency}`;
        let bucket = map.get(key);
        if (!bucket) {
          bucket = {
            member_user_id: row.member_user_id,
            member: row.member ?? null,
            currency,
            log_count: 0,
            seconds: 0,
            amount: 0,
          };
          map.set(key, bucket);
        }
        const seconds = row.duration_seconds ?? 0;
        const rate = Number(row.rate_snapshot ?? 0);
        bucket.log_count += 1;
        if (seconds > 0) bucket.seconds += seconds;
        if (Number.isFinite(rate) && rate > 0 && seconds > 0) {
          bucket.amount += (seconds / 3600) * rate;
        }
      }
      if (rows.length < PAGE) break;
    }

    return Array.from(map.values())
      .map((b) => ({
        member_user_id: b.member_user_id,
        member: b.member,
        currency: b.currency,
        log_count: b.log_count,
        hours: b.seconds / 3600,
        amount: Math.round(b.amount * 100) / 100,
      }))
      .sort((a, b) => b.amount - a.amount);
  }

  async getPayout(
    callerId: string,
    payoutId: string,
  ): Promise<PayoutRow & { logs: unknown[] }> {
    const payout = await this.fetchPayoutOrThrow(payoutId);
    await this.assertCanViewPayout(callerId, payout);
    const { data: logs, error } = await this.supabase
      .from('task_time_logs')
      .select(
        `id, project_id, task_id, started_at, ended_at, duration_seconds,
         rate_snapshot, currency_snapshot, status,
         task:roadmap_tasks!task_time_logs_task_id_fkey(id, title),
         project:projects!task_time_logs_project_id_fkey(id, title)`,
      )
      .eq('payout_id', payoutId)
      .order('started_at', { ascending: true });
    if (error) throw new Error(error.message);
    return { ...payout, logs: (logs ?? []) as unknown[] };
  }

  async voidPayout(callerId: string, payoutId: string): Promise<PayoutRow> {
    const payout = await this.fetchPayoutOrThrow(payoutId);
    await this.assertTeamApprover(callerId, payout.team_id);
    const { data, error } = await this.supabase.rpc('void_payout_and_revert', {
      p_payout_id: payoutId,
      p_actor: callerId,
    });
    if (error) throw new BadRequestException(error.message);
    return data as unknown as PayoutRow;
  }

  async getProofUrl(callerId: string, payoutId: string): Promise<{ url: string }> {
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
  private async attachQrUrl(
    row: PayoutMethodRow,
  ): Promise<PayoutMethodRow> {
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
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Payout not found.');
    return data as unknown as PayoutRow;
  }

  private async assertCanViewPayout(
    callerId: string,
    payout: PayoutRow,
  ): Promise<void> {
    if (payout.member_user_id === callerId) return;
    await this.assertTeamApprover(callerId, payout.team_id);
  }

  /** Caller is the team owner or a team admin. Mirrors TeamTimeService. */
  private async assertTeamApprover(
    callerId: string,
    teamId: string,
  ): Promise<void> {
    const { data: team, error } = await this.supabase
      .from('teams')
      .select('owner_id, time_tracking_enabled')
      .eq('id', teamId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!team) throw new NotFoundException('Team not found.');
    const t = team as { owner_id: string; time_tracking_enabled: boolean };
    if (!t.time_tracking_enabled) {
      throw new ForbiddenException(
        'Time tracking is not enabled for this team.',
      );
    }
    if (t.owner_id === callerId) return;

    const { data: member, error: memErr } = await this.supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', callerId)
      .maybeSingle();
    if (memErr) throw new Error(memErr.message);
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      throw new ForbiddenException(
        'Only the team owner or team admins can manage payouts.',
      );
    }
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

  private async notifyPaid(
    payout: PayoutRow,
    actorId: string,
    logCount: number,
  ): Promise<void> {
    if (payout.member_user_id === actorId) return;
    try {
      await this.notifications.createNotification({
        user_id: payout.member_user_id,
        actor_id: actorId,
        type_name: 'time_log_approved',
        content: {
          payout_id: payout.id,
          status: 'paid',
          total_amount: payout.total_amount,
          currency: payout.currency,
          log_count: logCount,
          message: `You were paid ${payout.total_amount} ${payout.currency} for ${logCount} time log(s).`,
        },
        link_url: `/teams/${payout.team_id}/time/my-logs`,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to send payout notification: ${(err as Error).message}`,
      );
    }
  }
}
