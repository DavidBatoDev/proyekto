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
} from '../books/finance-book-access.service';
import { canReadExpenses } from '../books/finance-book-permissions';
import { endOfDay, today } from '../receivables';
import type {
  CreateFinanceExpenseDto,
  ListFinanceExpensesQueryDto,
  UpdateFinanceExpenseDto,
} from './dto/finance-expenses.dto';
import {
  type DateWindow,
  type ExpenseRecurrence,
  type ExpenseSummary,
  expenseOverlapsWindow,
  type FinanceExpense,
  type RollupPayout,
  summarizeExpenses,
} from './expense-rollup';

export interface FinanceExpenseList {
  expenses: FinanceExpense[];
  can_manage: boolean;
  summary: ExpenseSummary;
}

export interface TeamExpenseAccess {
  team_id: string;
  /** The team's F2 book, when one exists. */
  book: FinanceBookRow | null;
  can_read: boolean;
  can_manage: boolean;
}

const EXPENSE_COLUMNS =
  'id, team_id, book_id, project_id, category, description, vendor, amount, currency, incurred_on, recurrence, recurrence_ends_on, document_id, created_by, created_at, updated_at, voided_at, voided_by';

/**
 * Team expenses: money out that is not a member payout.
 *
 * Authorization is the caller's role on the team's F2 book, resolved by
 * `FinanceBookAccessService` (which already treats the team owner as book
 * owner without a membership row). Reads need `manage_expenses || view_costs`,
 * writes `manage_expenses`. A team with no F2 is open to its owner only.
 * Every miss is a NotFound so the response never confirms a team exists.
 * Runs on the service-role client — these checks ARE the boundary.
 */
@Injectable()
export class FinanceExpensesService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly access: FinanceBookAccessService,
  ) {}

  async resolveTeamAccess(
    callerId: string,
    teamId: string,
  ): Promise<TeamExpenseAccess | null> {
    const { data: team, error: teamError } = await this.supabase
      .from('teams')
      .select('id, owner_id')
      .eq('id', teamId)
      .maybeSingle<{ id: string; owner_id: string }>();
    if (teamError) throw new Error(teamError.message);
    if (!team) return null;

    const { data: book, error: bookError } = await this.supabase
      .from('finance_books')
      .select('*')
      .eq('kind', 'team')
      .eq('owner_team_id', teamId)
      .maybeSingle<FinanceBookRow>();
    if (bookError) throw new Error(bookError.message);

    // An archived book is read + export only, even for its owner.
    const writable = !book || book.status !== 'archived';

    if (team.owner_id === callerId) {
      return {
        team_id: teamId,
        book: book ?? null,
        can_read: true,
        can_manage: writable,
      };
    }
    if (!book) return null;

    const resolved = await this.access.resolveAccess(callerId, book.id);
    if (!resolved || !canReadExpenses(resolved.permissions)) return null;
    return {
      team_id: teamId,
      book,
      can_read: true,
      can_manage: writable && resolved.permissions.manage_expenses,
    };
  }

  async list(
    callerId: string,
    teamId: string,
    query: ListFinanceExpensesQueryDto,
  ): Promise<FinanceExpenseList> {
    const access = await this.assertAccess(callerId, teamId, 'read');
    const window: DateWindow = {
      from: query.from ?? null,
      to: query.to ?? null,
    };
    if (window.from && window.to && window.from > window.to) {
      throw new BadRequestException('from must be on or before to');
    }
    const includeVoided =
      query.include_voided === 'true' || query.include_voided === '1';

    let expenseQuery = this.supabase
      .from('finance_expenses')
      .select(EXPENSE_COLUMNS)
      .eq('team_id', teamId)
      .order('incurred_on', { ascending: false })
      .order('created_at', { ascending: false });
    if (query.project_id) {
      expenseQuery = expenseQuery.eq('project_id', query.project_id);
    }
    if (window.to) expenseQuery = expenseQuery.lte('incurred_on', window.to);
    const { data, error } = await expenseQuery;
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as FinanceExpense[]).map(normalizeExpense);

    // Payouts are team-level (no project), so a project-filtered summary is
    // expenses only.
    const payouts = query.project_id
      ? []
      : await this.fetchPayouts([teamId], window);

    const summary = summarizeExpenses(
      rows,
      payouts.map((p) => p.payout),
      window,
      today(),
    );
    const expenses = rows.filter(
      (row) =>
        (includeVoided || !row.voided_at) && expenseOverlapsWindow(row, window),
    );
    return { expenses, can_manage: access.can_manage, summary };
  }

  async create(
    callerId: string,
    teamId: string,
    body: CreateFinanceExpenseDto,
  ): Promise<FinanceExpense> {
    const access = await this.assertAccess(callerId, teamId, 'manage');
    const recurrence: ExpenseRecurrence = body.recurrence ?? 'none';
    const endsOn =
      recurrence === 'none' ? null : (body.recurrence_ends_on ?? null);
    if (recurrence === 'none' && body.recurrence_ends_on) {
      throw new BadRequestException(
        'recurrence_ends_on requires a monthly or yearly recurrence',
      );
    }
    assertEndsAfterStart(body.incurred_on, endsOn);
    const description = body.description.trim();
    if (!description) {
      throw new BadRequestException('description must not be empty');
    }
    if (body.project_id) {
      await this.assertProjectOnTeam(teamId, body.project_id);
    }

    const { data, error } = await this.supabase
      .from('finance_expenses')
      .insert({
        team_id: teamId,
        book_id: access.book?.id ?? null,
        project_id: body.project_id ?? null,
        category: body.category,
        description,
        vendor: cleanOptional(body.vendor),
        amount: body.amount,
        currency: body.currency.toUpperCase(),
        incurred_on: body.incurred_on,
        recurrence,
        recurrence_ends_on: endsOn,
        document_id: body.document_id ?? null,
        created_by: callerId,
      })
      .select(EXPENSE_COLUMNS)
      .single<FinanceExpense>();
    if (error) throw new Error(error.message);
    return normalizeExpense(data);
  }

  async update(
    callerId: string,
    expenseId: string,
    body: UpdateFinanceExpenseDto,
  ): Promise<FinanceExpense> {
    const existing = await this.fetchExpense(expenseId);
    if (!existing) throw new NotFoundException('Expense not found');
    await this.assertAccess(callerId, existing.team_id, 'manage', 'Expense');
    if (existing.voided_at) {
      throw new ConflictException('A voided expense cannot be edited');
    }

    const patch: Record<string, unknown> = {};
    if (body.category !== undefined) patch.category = body.category;
    if (body.description !== undefined) {
      const description = body.description.trim();
      if (!description) {
        throw new BadRequestException('description must not be empty');
      }
      patch.description = description;
    }
    if (body.vendor !== undefined) patch.vendor = cleanOptional(body.vendor);
    if (body.amount !== undefined) patch.amount = body.amount;
    if (body.currency !== undefined) {
      patch.currency = body.currency.toUpperCase();
    }
    if (body.incurred_on !== undefined) patch.incurred_on = body.incurred_on;
    if (body.recurrence !== undefined) patch.recurrence = body.recurrence;
    if (body.recurrence_ends_on !== undefined) {
      patch.recurrence_ends_on = body.recurrence_ends_on;
    }
    if (body.document_id !== undefined) patch.document_id = body.document_id;
    if (body.project_id !== undefined) {
      if (body.project_id) {
        await this.assertProjectOnTeam(existing.team_id, body.project_id);
      }
      patch.project_id = body.project_id;
    }

    const recurrence: ExpenseRecurrence =
      body.recurrence ?? existing.recurrence;
    const incurredOn = body.incurred_on ?? existing.incurred_on;
    let endsOn: string | null =
      body.recurrence_ends_on !== undefined
        ? body.recurrence_ends_on
        : existing.recurrence_ends_on;
    if (recurrence === 'none') {
      if (body.recurrence_ends_on) {
        throw new BadRequestException(
          'recurrence_ends_on requires a monthly or yearly recurrence',
        );
      }
      // Switching to one-off drops a stale end date.
      endsOn = null;
      if (existing.recurrence_ends_on !== null) patch.recurrence_ends_on = null;
    }
    assertEndsAfterStart(incurredOn, endsOn);

    if (Object.keys(patch).length === 0) return existing;

    const { data, error } = await this.supabase
      .from('finance_expenses')
      .update(patch)
      .eq('id', expenseId)
      .is('voided_at', null)
      .select(EXPENSE_COLUMNS)
      .maybeSingle<FinanceExpense>();
    if (error) throw new Error(error.message);
    if (!data) throw new ConflictException('A voided expense cannot be edited');
    return normalizeExpense(data);
  }

  async void(callerId: string, expenseId: string): Promise<FinanceExpense> {
    const existing = await this.fetchExpense(expenseId);
    if (!existing) throw new NotFoundException('Expense not found');
    await this.assertAccess(callerId, existing.team_id, 'manage', 'Expense');
    if (existing.voided_at) {
      throw new ConflictException('Expense is already void');
    }

    const { data, error } = await this.supabase
      .from('finance_expenses')
      .update({ voided_at: new Date().toISOString(), voided_by: callerId })
      .eq('id', expenseId)
      .is('voided_at', null)
      .select(EXPENSE_COLUMNS)
      .maybeSingle<FinanceExpense>();
    if (error) throw new Error(error.message);
    if (!data) throw new ConflictException('Expense is already void');
    return normalizeExpense(data);
  }

  /**
   * Money-out rollups for many teams at once, for the "my finance" summary.
   * NO authorization — callers must already have decided the caller may see
   * each team's costs.
   */
  async summarizeTeams(
    teamIds: string[],
    window: DateWindow = {},
  ): Promise<Map<string, ExpenseSummary>> {
    const out = new Map<string, ExpenseSummary>();
    const unique = [...new Set(teamIds)].filter(Boolean);
    if (unique.length === 0) return out;

    let expenseQuery = this.supabase
      .from('finance_expenses')
      .select(
        'team_id, category, amount, currency, incurred_on, recurrence, recurrence_ends_on, voided_at',
      )
      .in('team_id', unique)
      .is('voided_at', null);
    if (window.to) expenseQuery = expenseQuery.lte('incurred_on', window.to);
    const [expenseResult, payouts] = await Promise.all([
      expenseQuery,
      this.fetchPayouts(unique, window),
    ]);
    if (expenseResult.error) throw new Error(expenseResult.error.message);
    const expenses = (expenseResult.data ?? []) as Array<
      Pick<
        FinanceExpense,
        | 'team_id'
        | 'category'
        | 'amount'
        | 'currency'
        | 'incurred_on'
        | 'recurrence'
        | 'recurrence_ends_on'
        | 'voided_at'
      >
    >;

    const asOf = today();
    for (const teamId of unique) {
      out.set(
        teamId,
        summarizeExpenses(
          expenses
            .filter((row) => row.team_id === teamId)
            .map((row) => ({ ...row, amount: Number(row.amount) })),
          payouts.filter((p) => p.team_id === teamId).map((p) => p.payout),
          window,
          asOf,
        ),
      );
    }
    return out;
  }

  private async assertAccess(
    callerId: string,
    teamId: string,
    action: 'read' | 'manage',
    noun = 'Team finance',
  ): Promise<TeamExpenseAccess> {
    const access = await this.resolveTeamAccess(callerId, teamId);
    if (!access || (action === 'manage' && !access.can_manage)) {
      throw new NotFoundException(`${noun} not found`);
    }
    return access;
  }

  private async fetchExpense(
    expenseId: string,
  ): Promise<FinanceExpense | null> {
    const { data, error } = await this.supabase
      .from('finance_expenses')
      .select(EXPENSE_COLUMNS)
      .eq('id', expenseId)
      .maybeSingle<FinanceExpense>();
    if (error) throw new Error(error.message);
    return data ? normalizeExpense(data) : null;
  }

  /** Non-void payouts for the teams, windowed by their paid date. */
  private async fetchPayouts(
    teamIds: string[],
    window: DateWindow,
  ): Promise<Array<{ team_id: string; payout: RollupPayout }>> {
    let query = this.supabase
      .from('payouts')
      .select('team_id, currency, total_amount, paid_at')
      .in('team_id', teamIds)
      .eq('status', 'recorded');
    if (window.from) query = query.gte('paid_at', `${window.from}T00:00:00Z`);
    if (window.to) query = query.lte('paid_at', endOfDay(window.to));
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (
      (data ?? []) as Array<{
        team_id: string;
        currency: string;
        total_amount: number | string;
        paid_at: string;
      }>
    ).map((row) => ({
      team_id: row.team_id,
      payout: {
        currency: row.currency,
        total_amount: row.total_amount,
        paid_at: row.paid_at,
      },
    }));
  }

  private async assertProjectOnTeam(
    teamId: string,
    projectId: string,
  ): Promise<void> {
    const { count, error } = await this.supabase
      .from('project_teams')
      .select('project_id', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('project_id', projectId);
    if (error) throw new Error(error.message);
    if (!count) {
      throw new BadRequestException('Project is not linked to this team');
    }
  }
}

function normalizeExpense(row: FinanceExpense): FinanceExpense {
  // numeric(14,2) comes back from PostgREST as a string.
  return { ...row, amount: Number(row.amount) };
}

function cleanOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function assertEndsAfterStart(incurredOn: string, endsOn: string | null): void {
  if (endsOn && endsOn < incurredOn) {
    throw new BadRequestException(
      'recurrence_ends_on must be on or after incurred_on',
    );
  }
}
