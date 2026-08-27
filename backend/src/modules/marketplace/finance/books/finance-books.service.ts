import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import {
  FinanceBookAccessService,
  type FinanceBookRow,
  type ResolvedBookAccess,
} from './finance-book-access.service';

export interface EngagedProject {
  project_id: string;
  project_title: string;
  contract_id: string;
  contract_status: string;
  relationship_kind: string;
  currency: string;
}

export interface PersonalDashboard {
  book: FinanceBookRow;
  engaged_projects: EngagedProject[];
  hours: {
    total_seconds: number;
    month_seconds: number;
    pending_seconds: number;
  };
  /** Payouts received, grouped by native currency — no FX conversion. */
  payouts_in: Array<{ currency: string; total: number; count: number }>;
}

/**
 * The finance-books lifecycle: creation wizards, listings, and the personal
 * dashboard. Authorization is delegated to `FinanceBookAccessService`;
 * everything here runs on the service-role client, so the asserts in this
 * file ARE the boundary.
 */
@Injectable()
export class FinanceBooksService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly access: FinanceBookAccessService,
  ) {}

  /** Every book the caller can open: their F1, plus F2/F3 via ownership or membership. */
  async listMyBooks(
    callerId: string,
  ): Promise<
    Array<FinanceBookRow & { access_role: string; inherited: boolean }>
  > {
    const [personal, ownedTeams, memberRows] = await Promise.all([
      this.supabase
        .from('finance_books')
        .select('*')
        .eq('kind', 'personal')
        .eq('owner_user_id', callerId),
      this.supabase.from('teams').select('id').eq('owner_id', callerId),
      this.supabase
        .from('finance_book_members')
        .select('book_id, finance_role')
        .eq('user_id', callerId),
    ]);
    for (const result of [personal, ownedTeams, memberRows]) {
      if (result.error) throw new Error(result.error.message);
    }

    const out = new Map<
      string,
      FinanceBookRow & { access_role: string; inherited: boolean }
    >();
    for (const row of (personal.data ?? []) as FinanceBookRow[]) {
      out.set(row.id, { ...row, access_role: 'owner', inherited: false });
    }

    const teamIds = ((ownedTeams.data ?? []) as Array<{ id: string }>).map(
      (t) => t.id,
    );
    if (teamIds.length > 0) {
      const { data, error } = await this.supabase
        .from('finance_books')
        .select('*')
        .in('owner_team_id', teamIds);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as FinanceBookRow[]) {
        out.set(row.id, {
          ...row,
          access_role: 'owner',
          inherited: row.kind === 'project',
        });
      }
    }

    const membered = (memberRows.data ?? []) as Array<{
      book_id: string;
      finance_role: string;
    }>;
    if (membered.length > 0) {
      const ids = membered.map((m) => m.book_id);
      const { data, error } = await this.supabase
        .from('finance_books')
        .select('*')
        .in('id', ids);
      if (error) throw new Error(error.message);
      const roleById = new Map(
        membered.map((m) => [m.book_id, m.finance_role]),
      );
      for (const row of (data ?? []) as FinanceBookRow[]) {
        if (!out.has(row.id)) {
          out.set(row.id, {
            ...row,
            access_role: roleById.get(row.id) ?? 'viewer',
            inherited: false,
          });
        }
      }
      // F2 owner/manager members also see child F3s (read-time inheritance).
      const inheritIds = membered
        .filter(
          (m) => m.finance_role === 'owner' || m.finance_role === 'manager',
        )
        .map((m) => m.book_id);
      if (inheritIds.length > 0) {
        const children = await this.supabase
          .from('finance_books')
          .select('*')
          .in('parent_book_id', inheritIds);
        if (children.error) throw new Error(children.error.message);
        for (const row of (children.data ?? []) as FinanceBookRow[]) {
          if (!out.has(row.id)) {
            out.set(row.id, {
              ...row,
              access_role: roleById.get(row.parent_book_id ?? '') ?? 'manager',
              inherited: true,
            });
          }
        }
      }
    }
    return [...out.values()].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
  }

  async getBook(callerId: string, bookId: string): Promise<ResolvedBookAccess> {
    return this.access.assertBookCapability(callerId, bookId, 'view');
  }

  /**
   * F1 creation — open to every authenticated user, contracts or not. A
   * zero-contract book simply renders empty states; data, not creation, is
   * what contracts unlock.
   */
  async createPersonalBook(
    callerId: string,
    currency?: string,
  ): Promise<FinanceBookRow> {
    const { data, error } = await this.supabase
      .from('finance_books')
      .insert({
        kind: 'personal',
        owner_kind: 'user',
        owner_user_id: callerId,
        currency: (currency ?? 'USD').toUpperCase(),
        created_by: callerId,
      })
      .select('*')
      .single<FinanceBookRow>();
    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('You already have a personal finance book');
      }
      throw new Error(error.message);
    }
    return data;
  }

  /**
   * F2 creation — team owner only. Selected projects become F3 children, but
   * only when they are attached to the team AND carry a live client-services
   * contract (signed or active); anything else is refused by name.
   */
  async createTeamBook(
    callerId: string,
    teamId: string,
    projectIds: string[],
    currency?: string,
  ): Promise<{ book: FinanceBookRow; project_books: FinanceBookRow[] }> {
    const { data: team, error: teamError } = await this.supabase
      .from('teams')
      .select('id, owner_id')
      .eq('id', teamId)
      .maybeSingle();
    if (teamError) throw new Error(teamError.message);
    if (!team || (team as { owner_id: string }).owner_id !== callerId) {
      throw new NotFoundException('Team not found');
    }

    const eligible =
      projectIds.length > 0
        ? await this.contractedTeamProjects(teamId, projectIds)
        : [];
    const eligibleIds = new Set(eligible.map((p) => p.project_id));
    const rejected = projectIds.filter((id) => !eligibleIds.has(id));
    if (rejected.length > 0) {
      throw new BadRequestException(
        `Projects without a signed client contract on this team cannot join finance: ${rejected.join(', ')}`,
      );
    }

    const { data: book, error } = await this.supabase
      .from('finance_books')
      .insert({
        kind: 'team',
        owner_kind: 'team',
        owner_team_id: teamId,
        currency: (currency ?? 'USD').toUpperCase(),
        created_by: callerId,
      })
      .select('*')
      .single<FinanceBookRow>();
    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('This team already has a finance book');
      }
      throw new Error(error.message);
    }

    const projectBooks = await this.createProjectBooksUnder(
      callerId,
      book,
      eligible,
    );
    return { book: book, project_books: projectBooks };
  }

  /** F3 creation onto an existing F2 (owner or manage_book capability). */
  async addProjectBook(
    callerId: string,
    parentBookId: string,
    projectId: string,
  ): Promise<FinanceBookRow> {
    const access = await this.access.assertBookCapability(
      callerId,
      parentBookId,
      'manage_book',
    );
    if (access.book.kind !== 'team' || !access.book.owner_team_id) {
      throw new BadRequestException('Project books attach to a team book');
    }
    const eligible = await this.contractedTeamProjects(
      access.book.owner_team_id,
      [projectId],
    );
    if (eligible.length === 0) {
      throw new BadRequestException(
        'This project has no signed client contract on the team',
      );
    }
    const [created] = await this.createProjectBooksUnder(
      callerId,
      access.book,
      eligible,
    );
    return created;
  }

  /**
   * Projects a user is contract-engaged on: a signed seat on a live contract.
   * The seed of the Phase-2 eligibility engine — the wizard uses it to
   * pre-check engaged projects.
   */
  async listEngagedProjects(userId: string): Promise<EngagedProject[]> {
    const { data, error } = await this.supabase
      .from('contract_positions')
      .select(
        'contract:contracts(id, status, project_id, relationship_kind, currency, project:projects(id, title))',
      )
      .eq('user_id', userId)
      .not('signed_at', 'is', null);
    if (error) throw new Error(error.message);

    const out: EngagedProject[] = [];
    for (const row of (data ?? []) as unknown as Array<{
      contract: {
        id: string;
        status: string;
        project_id: string | null;
        relationship_kind: string;
        currency: string;
        project: { id: string; title: string } | null;
      } | null;
    }>) {
      const contract = row.contract;
      if (!contract || !contract.project) continue;
      if (!['signed', 'active'].includes(contract.status)) continue;
      out.push({
        project_id: contract.project.id,
        project_title: contract.project.title,
        contract_id: contract.id,
        contract_status: contract.status,
        relationship_kind: contract.relationship_kind,
        currency: contract.currency,
      });
    }
    return out;
  }

  /** The F1 dashboard: hours worked, payouts in, engaged projects. */
  async getPersonalDashboard(callerId: string): Promise<PersonalDashboard> {
    const { data: bookRow, error: bookError } = await this.supabase
      .from('finance_books')
      .select('*')
      .eq('kind', 'personal')
      .eq('owner_user_id', callerId)
      .maybeSingle<FinanceBookRow>();
    if (bookError) throw new Error(bookError.message);
    if (!bookRow) throw new NotFoundException('Finance book not found');

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [engaged, logs, payouts] = await Promise.all([
      this.listEngagedProjects(callerId),
      this.supabase
        .from('task_time_logs')
        .select('duration_seconds, status, started_at')
        .eq('member_user_id', callerId)
        .not('ended_at', 'is', null),
      this.supabase
        .from('payouts')
        .select('total_amount, currency, status')
        .eq('member_user_id', callerId)
        .eq('status', 'recorded'),
    ]);
    if (logs.error) throw new Error(logs.error.message);

    let totalSeconds = 0;
    let monthSeconds = 0;
    let pendingSeconds = 0;
    for (const log of (logs.data ?? []) as Array<{
      duration_seconds: number | null;
      status: string;
      started_at: string;
    }>) {
      const seconds = log.duration_seconds ?? 0;
      totalSeconds += seconds;
      if (log.started_at >= monthStart.toISOString()) monthSeconds += seconds;
      if (log.status === 'pending') pendingSeconds += seconds;
    }

    const payoutsByCurrency = new Map<
      string,
      { total: number; count: number }
    >();
    if (!payouts.error) {
      for (const payout of (payouts.data ?? []) as Array<{
        total_amount: number;
        currency: string;
      }>) {
        const entry = payoutsByCurrency.get(payout.currency) ?? {
          total: 0,
          count: 0,
        };
        entry.total += Number(payout.total_amount) || 0;
        entry.count += 1;
        payoutsByCurrency.set(payout.currency, entry);
      }
    }

    return {
      book: bookRow,
      engaged_projects: engaged,
      hours: {
        total_seconds: totalSeconds,
        month_seconds: monthSeconds,
        pending_seconds: pendingSeconds,
      },
      payouts_in: [...payoutsByCurrency.entries()].map(([currency, value]) => ({
        currency,
        ...value,
      })),
    };
  }

  private async contractedTeamProjects(
    teamId: string,
    projectIds: string[],
  ): Promise<Array<{ project_id: string; currency: string }>> {
    const unique = [...new Set(projectIds)].filter(Boolean);
    if (unique.length === 0) return [];

    const { data: links, error: linksError } = await this.supabase
      .from('project_teams')
      .select('project_id')
      .eq('team_id', teamId)
      .in('project_id', unique);
    if (linksError) throw new Error(linksError.message);
    const attached = new Set(
      ((links ?? []) as Array<{ project_id: string }>).map((l) => l.project_id),
    );
    if (attached.size === 0) return [];

    const { data: contracts, error } = await this.supabase
      .from('contracts')
      .select('project_id, currency')
      .in('project_id', [...attached])
      .eq('relationship_kind', 'client_services')
      .in('status', ['signed', 'active']);
    if (error) throw new Error(error.message);

    const byProject = new Map<string, string>();
    for (const contract of (contracts ?? []) as Array<{
      project_id: string;
      currency: string;
    }>) {
      byProject.set(contract.project_id, contract.currency);
    }
    return [...byProject.entries()].map(([project_id, currency]) => ({
      project_id,
      currency,
    }));
  }

  private async createProjectBooksUnder(
    callerId: string,
    parent: FinanceBookRow,
    projects: Array<{ project_id: string; currency: string }>,
  ): Promise<FinanceBookRow[]> {
    if (projects.length === 0) return [];
    const { data, error } = await this.supabase
      .from('finance_books')
      .insert(
        projects.map((project) => ({
          kind: 'project',
          owner_kind: 'team',
          owner_team_id: parent.owner_team_id,
          parent_book_id: parent.id,
          project_id: project.project_id,
          currency: project.currency ?? parent.currency,
          created_by: callerId,
        })),
      )
      .select('*');
    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('A project already has a finance book');
      }
      throw new Error(error.message);
    }
    return (data ?? []) as FinanceBookRow[];
  }
}
