import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import {
  type FinanceBookPermissions,
  type FinanceBookRole,
  resolveBookPermissions,
} from './finance-book-permissions';

export interface FinanceBookRow {
  id: string;
  kind: 'personal' | 'team' | 'project';
  owner_kind: 'user' | 'team';
  owner_user_id: string | null;
  owner_team_id: string | null;
  parent_book_id: string | null;
  project_id: string | null;
  currency: string;
  status: 'active' | 'archived';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResolvedBookAccess {
  book: FinanceBookRow;
  role: FinanceBookRole;
  permissions: FinanceBookPermissions;
  /** True when the role came from the parent F2 rather than a row on F3. */
  inherited: boolean;
}

/**
 * Who may do what on a finance book.
 *
 * The book-scoped sibling of `TeamFinanceAccessService` and, like it, the
 * actual security boundary — every caller runs on the service-role client, so
 * RLS never backstops these predicates.
 *
 * Access sources, in precedence order:
 * 1. Implicit ownership — a personal book's owner user; a team/project book's
 *    current team owner. Owners need no membership row, which keeps team
 *    ownership transfer automatic.
 * 2. An explicit `finance_book_members` row on the book itself.
 * 3. Read-time F2 inheritance — an `owner`/`manager` row on the parent team
 *    book carries the same role onto every child project book. Never
 *    materialized, so new F3s and re-parenting need no fan-out.
 *
 * Misses throw NotFound (never Forbidden), so a response cannot confirm a
 * book exists to someone outside it.
 */
@Injectable()
export class FinanceBookAccessService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async resolveAccess(
    callerId: string,
    bookId: string,
  ): Promise<ResolvedBookAccess | null> {
    const book = await this.fetchBook(bookId);
    if (!book) return null;

    // 1. Implicit ownership.
    if (book.kind === 'personal') {
      if (book.owner_user_id === callerId) {
        return this.resolved(book, 'owner', null, false);
      }
      return null; // Personal books are private — no membership, no inheritance.
    }
    if (
      book.owner_team_id &&
      (await this.isTeamOwner(callerId, book.owner_team_id))
    ) {
      return this.resolved(book, 'owner', null, false);
    }

    // 2. Direct membership row.
    const direct = await this.fetchMemberRow(callerId, book.id);
    if (direct) {
      return this.resolved(
        book,
        direct.finance_role,
        direct.capabilities,
        false,
      );
    }

    // 3. F2 -> F3 inheritance for owner/manager grants.
    if (book.kind === 'project' && book.parent_book_id) {
      const parent = await this.fetchMemberRow(callerId, book.parent_book_id);
      if (
        parent &&
        (parent.finance_role === 'owner' || parent.finance_role === 'manager')
      ) {
        return this.resolved(
          book,
          parent.finance_role,
          parent.capabilities,
          true,
        );
      }
    }
    return null;
  }

  /** Resolve access and require one capability, NotFound on any miss. */
  async assertBookCapability(
    callerId: string,
    bookId: string,
    capability: keyof FinanceBookPermissions,
  ): Promise<ResolvedBookAccess> {
    const access = await this.resolveAccess(callerId, bookId);
    if (!access || !access.permissions[capability]) {
      throw new NotFoundException('Finance book not found');
    }
    return access;
  }

  private async fetchBook(bookId: string): Promise<FinanceBookRow | null> {
    const { data, error } = await this.supabase
      .from('finance_books')
      .select('*')
      .eq('id', bookId)
      .maybeSingle<FinanceBookRow>();
    if (error) throw new Error(error.message);
    return data ?? null;
  }

  private async fetchMemberRow(
    callerId: string,
    bookId: string,
  ): Promise<{
    finance_role: FinanceBookRole;
    capabilities: Record<string, unknown> | null;
  } | null> {
    const { data, error } = await this.supabase
      .from('finance_book_members')
      .select('finance_role, capabilities')
      .eq('book_id', bookId)
      .eq('user_id', callerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (
      (data as {
        finance_role: FinanceBookRole;
        capabilities: Record<string, unknown> | null;
      }) ?? null
    );
  }

  private async isTeamOwner(
    callerId: string,
    teamId: string,
  ): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('id', teamId)
      .eq('owner_id', callerId);
    if (error) throw new Error(error.message);
    return Boolean(count);
  }

  private resolved(
    book: FinanceBookRow,
    role: FinanceBookRole,
    capabilities: Record<string, unknown> | null,
    inherited: boolean,
  ): ResolvedBookAccess {
    return {
      book,
      role,
      permissions: resolveBookPermissions(role, capabilities),
      inherited,
    };
  }
}
