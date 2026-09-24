import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { FinanceExpensesService } from '../expenses/finance-expenses.service';
import { BILLED_STATUSES, collectedByInvoice } from '../receivables';
import {
  FinanceBookAccessService,
  type FinanceBookRow,
  type ResolvedBookAccess,
} from './finance-book-access.service';
import type {
  FinanceBookPermissions,
  FinanceBookRole,
} from './finance-book-permissions';
import {
  buildMyFinanceTotals,
  decideTeamScope,
  type HoursBreakdown,
  type MyFinanceSummary,
  type MyFinanceTeam,
  type MyTeamRole,
  moneyOutFromExpenseSummary,
  summarizeMoneyIn,
  summarizePaidToMe,
} from './my-finance-summary';

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

export interface HubProjectBook {
  book: FinanceBookRow;
  project_title: string | null;
  contract_status: string | null;
}

export interface HubTeamEntry {
  team_id: string;
  team_name: string;
  avatar_url: string | null;
  my_team_role: 'owner' | 'admin' | 'member';
  book: FinanceBookRow | null;
  can_create: boolean;
  book_role: string | null;
  project_books: HubProjectBook[];
}

export interface HubSharedEntry {
  book: FinanceBookRow;
  role: string;
  team_name: string | null;
  project_title: string | null;
}

export interface FinanceHub {
  personal: FinanceBookRow | null;
  teams: HubTeamEntry[];
  shared: HubSharedEntry[];
}

export interface OverviewTimeByMember {
  user_id: string;
  display_name: string;
  seconds: number;
  amount?: number;
  currency?: string;
}

export interface BookOverview {
  book: FinanceBookRow;
  role: FinanceBookRole;
  permissions: FinanceBookPermissions;
  inherited: boolean;
  team_name: string | null;
  project_title: string | null;
  parent_book_id: string | null;
  time?: {
    total_seconds: number;
    pending_seconds: number;
    approved_seconds: number;
    by_member: OverviewTimeByMember[];
  };
  payouts?: Array<{ currency: string; total: number; count: number }>;
  contracts?: Array<{
    id: string;
    contract_number: string | null;
    status: string;
    billing_mode: string | null;
    currency: string | null;
    client_hourly_rate: number | null;
    signed_at: string | null;
  }>;
  invoices?: Array<{
    id: string;
    status: string;
    total: number;
    currency: string | null;
    issued_at: string | null;
  }>;
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
    private readonly expenses: FinanceExpensesService,
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
   * The single entry point the web hub renders from: the caller's F1, every
   * team they belong to (with the team's F2/F3s as far as they may see them),
   * and books shared with them from teams they are NOT on (the external
   * accountant/client case).
   */
  async getHub(callerId: string): Promise<FinanceHub> {
    const [personalRes, ownedTeamsRes, teamMemberRes, bookMemberRes] =
      await Promise.all([
        this.supabase
          .from('finance_books')
          .select('*')
          .eq('kind', 'personal')
          .eq('owner_user_id', callerId)
          .maybeSingle<FinanceBookRow>(),
        this.supabase
          .from('teams')
          .select('id, name, avatar_url, owner_id')
          .eq('owner_id', callerId),
        this.supabase
          .from('team_members')
          .select('team_id, role')
          .eq('user_id', callerId),
        this.supabase
          .from('finance_book_members')
          .select('book_id, finance_role')
          .eq('user_id', callerId),
      ]);
    for (const result of [
      personalRes,
      ownedTeamsRes,
      teamMemberRes,
      bookMemberRes,
    ]) {
      if (result.error) throw new Error(result.error.message);
    }

    interface TeamRow {
      id: string;
      name: string;
      avatar_url: string | null;
      owner_id: string;
    }
    const teamsById = new Map<string, TeamRow>();
    for (const team of (ownedTeamsRes.data ?? []) as TeamRow[]) {
      teamsById.set(team.id, team);
    }
    const memberRoleByTeam = new Map<string, string>();
    for (const row of (teamMemberRes.data ?? []) as Array<{
      team_id: string;
      role: string;
    }>) {
      memberRoleByTeam.set(row.team_id, row.role);
    }
    const missingTeamIds = [...memberRoleByTeam.keys()].filter(
      (id) => !teamsById.has(id),
    );
    if (missingTeamIds.length > 0) {
      const { data, error } = await this.supabase
        .from('teams')
        .select('id, name, avatar_url, owner_id')
        .in('id', missingTeamIds);
      if (error) throw new Error(error.message);
      for (const team of (data ?? []) as TeamRow[]) {
        teamsById.set(team.id, team);
      }
    }

    // Every finance book owned by one of the caller's teams.
    const myTeamIds = [...teamsById.keys()];
    const teamBooksById = new Map<string, FinanceBookRow>();
    if (myTeamIds.length > 0) {
      const { data, error } = await this.supabase
        .from('finance_books')
        .select('*')
        .in('owner_team_id', myTeamIds);
      if (error) throw new Error(error.message);
      for (const book of (data ?? []) as FinanceBookRow[]) {
        teamBooksById.set(book.id, book);
      }
    }

    // The caller's explicit membership rows, split into "on my teams' books"
    // and "shared from elsewhere".
    const bookRoleById = new Map<string, string>();
    for (const row of (bookMemberRes.data ?? []) as Array<{
      book_id: string;
      finance_role: string;
    }>) {
      bookRoleById.set(row.book_id, row.finance_role);
    }
    const foreignBookIds = [...bookRoleById.keys()].filter(
      (id) => !teamBooksById.has(id),
    );
    const foreignBooks: FinanceBookRow[] = [];
    if (foreignBookIds.length > 0) {
      const { data, error } = await this.supabase
        .from('finance_books')
        .select('*')
        .in('id', foreignBookIds);
      if (error) throw new Error(error.message);
      for (const book of (data ?? []) as FinanceBookRow[]) {
        // Personal books are private; a stray member row on one is ignored.
        if (book.kind !== 'personal') foreignBooks.push(book);
      }
    }
    const sharedBooks = foreignBooks.filter(
      (book) => !book.owner_team_id || !teamsById.has(book.owner_team_id),
    );

    // Names for the shared books' teams, titles for every referenced project,
    // and live client contracts for the caller's teams' project books.
    const sharedTeamIds = [
      ...new Set(
        sharedBooks
          .map((book) => book.owner_team_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const sharedTeamNames = new Map<string, string>();
    if (sharedTeamIds.length > 0) {
      const { data, error } = await this.supabase
        .from('teams')
        .select('id, name')
        .in('id', sharedTeamIds);
      if (error) throw new Error(error.message);
      for (const team of (data ?? []) as Array<{ id: string; name: string }>) {
        sharedTeamNames.set(team.id, team.name);
      }
    }

    const projectIds = [
      ...new Set(
        [...teamBooksById.values(), ...sharedBooks]
          .map((book) => book.project_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const projectTitles = new Map<string, string | null>();
    if (projectIds.length > 0) {
      const { data, error } = await this.supabase
        .from('projects')
        .select('id, title')
        .in('id', projectIds);
      if (error) throw new Error(error.message);
      for (const project of (data ?? []) as Array<{
        id: string;
        title: string | null;
      }>) {
        projectTitles.set(project.id, project.title);
      }
    }

    const contractStatusByProject = new Map<string, string>();
    if (projectIds.length > 0) {
      const { data, error } = await this.supabase
        .from('contracts')
        .select('project_id, status')
        .in('project_id', projectIds)
        .eq('relationship_kind', 'client_services')
        .in('status', ['signed', 'active']);
      if (error) throw new Error(error.message);
      for (const contract of (data ?? []) as Array<{
        project_id: string;
        status: string;
      }>) {
        contractStatusByProject.set(contract.project_id, contract.status);
      }
    }

    const teams: HubTeamEntry[] = [];
    for (const team of teamsById.values()) {
      const isTeamOwner = team.owner_id === callerId;
      const myTeamRole = (
        isTeamOwner ? 'owner' : (memberRoleByTeam.get(team.id) ?? 'member')
      ) as HubTeamEntry['my_team_role'];

      const teamBook =
        [...teamBooksById.values()].find(
          (book) => book.kind === 'team' && book.owner_team_id === team.id,
        ) ?? null;
      const children = [...teamBooksById.values()].filter(
        (book) =>
          book.kind === 'project' &&
          book.owner_team_id === team.id &&
          (!teamBook || book.parent_book_id === teamBook.id),
      );

      const bookRole = teamBook
        ? isTeamOwner
          ? 'owner'
          : (bookRoleById.get(teamBook.id) ?? null)
        : null;
      const seesAllChildren = bookRole === 'owner' || bookRole === 'manager';
      const visibleChildren = children.filter(
        (child) => seesAllChildren || bookRoleById.has(child.id),
      );

      teams.push({
        team_id: team.id,
        team_name: team.name,
        avatar_url: team.avatar_url,
        my_team_role: myTeamRole,
        book: bookRole ? teamBook : null,
        can_create: !teamBook && isTeamOwner,
        book_role: bookRole,
        project_books: visibleChildren.map((child) => ({
          book: child,
          project_title: child.project_id
            ? (projectTitles.get(child.project_id) ?? null)
            : null,
          contract_status: child.project_id
            ? (contractStatusByProject.get(child.project_id) ?? null)
            : null,
        })),
      });
    }

    return {
      personal: personalRes.data ?? null,
      teams,
      shared: sharedBooks.map((book) => ({
        book,
        role: bookRoleById.get(book.id) ?? 'viewer',
        team_name: book.owner_team_id
          ? (sharedTeamNames.get(book.owner_team_id) ?? null)
          : null,
        project_title: book.project_id
          ? (projectTitles.get(book.project_id) ?? null)
          : null,
      })),
    };
  }

  /**
   * One book's overview page. Sections are capability-gated: time and payouts
   * need `view_time`; per-member amounts need `view_costs` (rate_snapshot is
   * internal cost and is never even SELECTED without it — the
   * assertNoInternalRates philosophy); contracts and invoices need
   * `view_contracts` (client_hourly_rate is the client price, not a cost).
   */
  async getBookOverview(
    callerId: string,
    bookId: string,
  ): Promise<BookOverview> {
    const { book, role, permissions, inherited } =
      await this.access.assertBookCapability(callerId, bookId, 'view');

    let teamName: string | null = null;
    if (book.owner_team_id) {
      const { data, error } = await this.supabase
        .from('teams')
        .select('id, name')
        .eq('id', book.owner_team_id)
        .maybeSingle<{ id: string; name: string }>();
      if (error) throw new Error(error.message);
      teamName = data?.name ?? null;
    }
    let projectTitle: string | null = null;
    if (book.project_id) {
      const { data, error } = await this.supabase
        .from('projects')
        .select('id, title')
        .eq('id', book.project_id)
        .maybeSingle<{ id: string; title: string | null }>();
      if (error) throw new Error(error.message);
      projectTitle = data?.title ?? null;
    }

    const overview: BookOverview = {
      book,
      role,
      permissions,
      inherited,
      team_name: teamName,
      project_title: projectTitle,
      parent_book_id: book.parent_book_id,
    };

    if (permissions.view_time) {
      overview.time = await this.overviewTime(book, permissions);
      overview.payouts = await this.overviewPayouts(book);
    }
    if (permissions.view_contracts) {
      overview.contracts = await this.overviewContracts(book);
      overview.invoices = await this.overviewInvoices(book);
    }
    return overview;
  }

  private async overviewTime(
    book: FinanceBookRow,
    permissions: FinanceBookPermissions,
  ): Promise<NonNullable<BookOverview['time']>> {
    const baseColumns =
      'member_user_id, member_display_name_snapshot, duration_seconds, status';
    const columns = permissions.view_costs
      ? `${baseColumns}, rate_snapshot, currency_snapshot`
      : baseColumns;
    // Same scoping as finance-export: personal → the owner's own logs,
    // team → the team's, project → the project's.
    let query = this.supabase.from('task_time_logs').select(columns);
    if (book.kind === 'personal') {
      query = query.eq('member_user_id', book.owner_user_id);
    } else if (book.kind === 'team') {
      query = query.eq('team_id', book.owner_team_id);
    } else {
      query = query.eq('project_id', book.project_id);
    }
    const { data, error } = await query.not('ended_at', 'is', null);
    if (error) throw new Error(error.message);

    let totalSeconds = 0;
    let pendingSeconds = 0;
    let approvedSeconds = 0;
    const byMember = new Map<string, OverviewTimeByMember>();
    for (const log of (data ?? []) as unknown as Array<{
      member_user_id: string | null;
      member_display_name_snapshot: string | null;
      duration_seconds: number | null;
      status: string | null;
      rate_snapshot?: number | null;
      currency_snapshot?: string | null;
    }>) {
      const seconds = Math.max(0, Number(log.duration_seconds ?? 0));
      totalSeconds += seconds;
      if (log.status === 'pending') pendingSeconds += seconds;
      if (log.status === 'approved') approvedSeconds += seconds;

      const userId = log.member_user_id ?? 'unknown';
      const entry = byMember.get(userId) ?? {
        user_id: userId,
        display_name: log.member_display_name_snapshot ?? userId,
        seconds: 0,
      };
      entry.seconds += seconds;
      if (permissions.view_costs) {
        const rate = Number(log.rate_snapshot ?? 0);
        entry.amount = Number(
          ((entry.amount ?? 0) + rate * (seconds / 3600)).toFixed(2),
        );
        entry.currency = log.currency_snapshot ?? entry.currency;
      }
      byMember.set(userId, entry);
    }
    return {
      total_seconds: totalSeconds,
      pending_seconds: pendingSeconds,
      approved_seconds: approvedSeconds,
      by_member: [...byMember.values()],
    };
  }

  private async overviewPayouts(
    book: FinanceBookRow,
  ): Promise<NonNullable<BookOverview['payouts']>> {
    let query = this.supabase
      .from('payouts')
      .select('currency, total_amount, status')
      .eq('status', 'recorded');
    // Payouts have no project column, so a project (F3) book reports the
    // owning team's payouts — same widened scope as finance-export.
    if (book.kind === 'personal') {
      query = query.eq('member_user_id', book.owner_user_id);
    } else {
      query = query.eq('team_id', book.owner_team_id);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const byCurrency = new Map<string, { total: number; count: number }>();
    for (const payout of (data ?? []) as Array<{
      currency: string;
      total_amount: number | string | null;
    }>) {
      const entry = byCurrency.get(payout.currency) ?? { total: 0, count: 0 };
      entry.total += Number(payout.total_amount) || 0;
      entry.count += 1;
      byCurrency.set(payout.currency, entry);
    }
    return [...byCurrency.entries()].map(([currency, value]) => ({
      currency,
      ...value,
    }));
  }

  private async overviewContracts(
    book: FinanceBookRow,
  ): Promise<NonNullable<BookOverview['contracts']>> {
    interface ContractSlice {
      id: string;
      contract_number: string | null;
      status: string;
      billing_mode: string | null;
      currency: string | null;
      client_hourly_rate: number | null;
    }
    if (book.kind === 'personal') {
      const { data, error } = await this.supabase
        .from('contract_positions')
        .select(
          'signed_at, contract:contracts(id, contract_number, status, billing_mode, currency, client_hourly_rate)',
        )
        .eq('user_id', book.owner_user_id);
      if (error) throw new Error(error.message);
      const out: NonNullable<BookOverview['contracts']> = [];
      for (const row of (data ?? []) as unknown as Array<{
        signed_at: string | null;
        contract: ContractSlice | null;
      }>) {
        if (!row.contract) continue;
        out.push({ ...row.contract, signed_at: row.signed_at });
      }
      return out;
    }

    const projectIds = await this.bookProjectIds(book);
    if (projectIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from('contracts')
      .select(
        'id, contract_number, status, billing_mode, currency, client_hourly_rate, positions:contract_positions(signed_at)',
      )
      .in('project_id', projectIds)
      .eq('relationship_kind', 'client_services');
    if (error) throw new Error(error.message);
    return (
      (data ?? []) as unknown as Array<
        ContractSlice & {
          positions: Array<{ signed_at: string | null }> | null;
        }
      >
    ).map(({ positions, ...contract }) => ({
      ...contract,
      signed_at:
        (positions ?? [])
          .map((position) => position.signed_at)
          .filter((value): value is string => Boolean(value))
          .sort()
          .pop() ?? null,
    }));
  }

  private async overviewInvoices(
    book: FinanceBookRow,
  ): Promise<NonNullable<BookOverview['invoices']>> {
    interface InvoiceSlice {
      id: string;
      status: string;
      total: number | string | null;
      currency: string | null;
      issued_at: string | null;
    }
    let rows: InvoiceSlice[] = [];
    if (book.kind === 'personal') {
      const { data, error } = await this.supabase
        .from('invoices')
        .select('id, status, total, currency, issued_at')
        .or(
          `issuer_user_id.eq.${book.owner_user_id},recipient_user_id.eq.${book.owner_user_id}`,
        );
      if (error) throw new Error(error.message);
      rows = (data ?? []) as InvoiceSlice[];
    } else {
      const projectIds = await this.bookProjectIds(book);
      if (projectIds.length === 0) return [];
      const { data, error } = await this.supabase
        .from('invoices')
        .select('id, status, total, currency, issued_at')
        .in('project_id', projectIds);
      if (error) throw new Error(error.message);
      rows = (data ?? []) as InvoiceSlice[];
    }
    return rows.map((invoice) => ({
      id: invoice.id,
      status: invoice.status,
      total: Number(invoice.total ?? 0),
      currency: invoice.currency,
      issued_at: invoice.issued_at,
    }));
  }

  /** The project ids a team/project book spans (F3: its own; F2: its children's). */
  private async bookProjectIds(book: FinanceBookRow): Promise<string[]> {
    if (book.kind === 'project') {
      return book.project_id ? [book.project_id] : [];
    }
    const { data, error } = await this.supabase
      .from('finance_books')
      .select('project_id')
      .eq('parent_book_id', book.id);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<{ project_id: string | null }>)
      .map((row) => row.project_id)
      .filter((id): id is string => Boolean(id));
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

  /**
   * The caller's money across every team they own or belong to. Needs no
   * personal book. Team owners and F2 owner/manager/accountant members see
   * the team's money in (billed invoices on linked projects) and money out
   * (payouts + expenses); everyone else sees only what the team paid them.
   * Hours are always the caller's own logs.
   */
  async getMySummary(callerId: string): Promise<MyFinanceSummary> {
    const [ownedRes, memberRes] = await Promise.all([
      this.supabase
        .from('teams')
        .select('id, name, owner_id')
        .eq('owner_id', callerId),
      this.supabase
        .from('team_members')
        .select('team_id, role')
        .eq('user_id', callerId),
    ]);
    if (ownedRes.error) throw new Error(ownedRes.error.message);
    if (memberRes.error) throw new Error(memberRes.error.message);

    interface TeamRow {
      id: string;
      name: string;
      owner_id: string;
    }
    const teamsById = new Map<string, TeamRow>();
    for (const team of (ownedRes.data ?? []) as TeamRow[]) {
      teamsById.set(team.id, team);
    }
    const memberRoleByTeam = new Map<string, string>();
    for (const row of (memberRes.data ?? []) as Array<{
      team_id: string;
      role: string;
    }>) {
      memberRoleByTeam.set(row.team_id, row.role);
    }
    const missing = [...memberRoleByTeam.keys()].filter(
      (id) => !teamsById.has(id),
    );
    if (missing.length > 0) {
      const { data, error } = await this.supabase
        .from('teams')
        .select('id, name, owner_id')
        .in('id', missing);
      if (error) throw new Error(error.message);
      for (const team of (data ?? []) as TeamRow[]) {
        teamsById.set(team.id, team);
      }
    }
    const teamIds = [...teamsById.keys()];

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthStartIso = monthStart.toISOString();

    const [booksRes, logsRes, paidToMeRes] = await Promise.all([
      teamIds.length > 0
        ? this.supabase
            .from('finance_books')
            .select('id, owner_team_id')
            .eq('kind', 'team')
            .in('owner_team_id', teamIds)
        : Promise.resolve({ data: [], error: null }),
      this.supabase
        .from('task_time_logs')
        .select('team_id, duration_seconds, status, started_at')
        .eq('member_user_id', callerId)
        .not('ended_at', 'is', null),
      teamIds.length > 0
        ? this.supabase
            .from('payouts')
            .select('team_id, currency, total_amount')
            .eq('member_user_id', callerId)
            .eq('status', 'recorded')
            .in('team_id', teamIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (booksRes.error) throw new Error(booksRes.error.message);
    if (logsRes.error) throw new Error(logsRes.error.message);
    if (paidToMeRes.error) throw new Error(paidToMeRes.error.message);

    const bookIdByTeam = new Map<string, string>();
    for (const book of (booksRes.data ?? []) as Array<{
      id: string;
      owner_team_id: string;
    }>) {
      bookIdByTeam.set(book.owner_team_id, book.id);
    }
    const financeRoleByBook = new Map<string, FinanceBookRole>();
    if (bookIdByTeam.size > 0) {
      const { data, error } = await this.supabase
        .from('finance_book_members')
        .select('book_id, finance_role')
        .eq('user_id', callerId)
        .in('book_id', [...bookIdByTeam.values()]);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as Array<{
        book_id: string;
        finance_role: FinanceBookRole;
      }>) {
        financeRoleByBook.set(row.book_id, row.finance_role);
      }
    }

    // Hours: the caller's own logs. Rejected time is excluded.
    const overall = {
      total_seconds: 0,
      month_seconds: 0,
      pending_seconds: 0,
      approved_seconds: 0,
      paid_seconds: 0,
    };
    const hoursByTeam = new Map<string, HoursBreakdown>();
    for (const log of (logsRes.data ?? []) as Array<{
      team_id: string | null;
      duration_seconds: number | null;
      status: string;
      started_at: string;
    }>) {
      if (log.status === 'rejected') continue;
      const seconds = log.duration_seconds ?? 0;
      const inMonth = log.started_at >= monthStartIso;
      overall.total_seconds += seconds;
      if (inMonth) overall.month_seconds += seconds;
      if (log.status === 'pending') overall.pending_seconds += seconds;
      if (log.status === 'approved') overall.approved_seconds += seconds;
      if (log.status === 'paid') overall.paid_seconds += seconds;
      if (!log.team_id) continue;
      const team = hoursByTeam.get(log.team_id) ?? {
        total_seconds: 0,
        month_seconds: 0,
        pending_seconds: 0,
      };
      team.total_seconds += seconds;
      if (inMonth) team.month_seconds += seconds;
      if (log.status === 'pending') team.pending_seconds += seconds;
      hoursByTeam.set(log.team_id, team);
    }

    const paidToMeByTeam = new Map<
      string,
      Array<{ currency: string; total_amount: number | string }>
    >();
    for (const payout of (paidToMeRes.data ?? []) as Array<{
      team_id: string;
      currency: string;
      total_amount: number | string;
    }>) {
      const list = paidToMeByTeam.get(payout.team_id) ?? [];
      list.push(payout);
      paidToMeByTeam.set(payout.team_id, list);
    }

    // Scope per team, then the team-scope money in one pass per source.
    const scoped = [...teamsById.values()].map((team) => {
      const isOwner = team.owner_id === callerId;
      const bookId = bookIdByTeam.get(team.id);
      let financeRole: FinanceBookRole | null = null;
      if (bookId) {
        financeRole = isOwner
          ? 'owner'
          : (financeRoleByBook.get(bookId) ?? null);
      }
      let teamRole: MyTeamRole = 'member';
      if (isOwner) teamRole = 'owner';
      else if (memberRoleByTeam.get(team.id) === 'admin') teamRole = 'admin';
      return {
        team,
        isOwner,
        teamRole,
        financeRole,
        scope: decideTeamScope({ isTeamOwner: isOwner, financeRole }),
      };
    });
    const teamScopeIds = scoped
      .filter((entry) => entry.scope === 'team')
      .map((entry) => entry.team.id);

    interface InvoiceRow {
      id: string;
      project_id: string;
      currency: string | null;
      total: number | string;
      status: string;
    }
    const projectIdsByTeam = new Map<string, string[]>();
    let invoices: InvoiceRow[] = [];
    let collected = new Map<string, number>();
    if (teamScopeIds.length > 0) {
      const { data: links, error: linksError } = await this.supabase
        .from('project_teams')
        .select('team_id, project_id')
        .in('team_id', teamScopeIds);
      if (linksError) throw new Error(linksError.message);
      for (const link of (links ?? []) as Array<{
        team_id: string;
        project_id: string;
      }>) {
        const list = projectIdsByTeam.get(link.team_id) ?? [];
        list.push(link.project_id);
        projectIdsByTeam.set(link.team_id, list);
      }
      const projectIds = [...new Set([...projectIdsByTeam.values()].flat())];
      if (projectIds.length > 0) {
        const { data, error } = await this.supabase
          .from('invoices')
          .select('id, project_id, currency, total, status')
          .in('project_id', projectIds)
          .in('status', BILLED_STATUSES);
        if (error) throw new Error(error.message);
        invoices = (data ?? []) as InvoiceRow[];
        collected = await collectedByInvoice(this.supabase, invoices);
      }
    }
    const moneyOutByTeam = await this.expenses.summarizeTeams(teamScopeIds);

    const teams: MyFinanceTeam[] = scoped
      .map((entry) => {
        const isTeamScope = entry.scope === 'team';
        const teamProjects = new Set(projectIdsByTeam.get(entry.team.id));
        return {
          team_id: entry.team.id,
          team_name: entry.team.name,
          is_owner: entry.isOwner,
          team_role: entry.teamRole,
          finance_role: entry.financeRole,
          scope: entry.scope,
          hours: hoursByTeam.get(entry.team.id) ?? {
            total_seconds: 0,
            month_seconds: 0,
            pending_seconds: 0,
          },
          money_in: isTeamScope
            ? summarizeMoneyIn(
                invoices.filter((inv) => teamProjects.has(inv.project_id)),
                collected,
              )
            : [],
          money_out: isTeamScope
            ? moneyOutFromExpenseSummary(
                moneyOutByTeam.get(entry.team.id) ?? [],
              )
            : [],
          paid_to_me: summarizePaidToMe(
            paidToMeByTeam.get(entry.team.id) ?? [],
          ),
        };
      })
      .sort((a, b) => a.team_name.localeCompare(b.team_name));

    // Totals count each invoice once even when its project is linked to two
    // of the caller's teams.
    const teamScopeProjects = new Set(
      teamScopeIds.flatMap((id) => projectIdsByTeam.get(id) ?? []),
    );
    const dedupedMoneyIn = summarizeMoneyIn(
      invoices.filter((inv) => teamScopeProjects.has(inv.project_id)),
      collected,
    );

    return {
      hours: overall,
      teams,
      totals: buildMyFinanceTotals(teams, dedupedMoneyIn),
    };
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

    // A flexible client engagement never carries a project on its contract;
    // it reaches one through an operational link (the "set up the project"
    // step after signing). That is the same signed client authority, so the
    // project qualifies — at the currency of the contract that activated it.
    const unlinked = [...attached].filter((id) => !byProject.has(id));
    if (unlinked.length > 0) {
      const { data: placed, error: placedError } = await this.supabase
        .from('engagement_project_links')
        .select(
          'project_id, engagement:engagements!inner(kind, status, contract:contracts!engagements_activated_by_contract_id_fkey(currency))',
        )
        .in('project_id', unlinked)
        .eq('status', 'active')
        .eq('basis', 'operational_assignment')
        .eq('engagement.kind', 'client_services')
        .eq('engagement.status', 'active');
      if (placedError) throw new Error(placedError.message);
      for (const link of (placed ?? []) as unknown as Array<{
        project_id: string;
        engagement: { contract: { currency: string } | null } | null;
      }>) {
        const currency = link.engagement?.contract?.currency;
        if (currency && !byProject.has(link.project_id)) {
          byProject.set(link.project_id, currency);
        }
      }
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
