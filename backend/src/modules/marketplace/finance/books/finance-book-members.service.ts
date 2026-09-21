import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { FinanceBookAccessService } from './finance-book-access.service';
import type { FinanceBookRole } from './finance-book-permissions';

export interface MemberProfileSummary {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
}

export interface FinanceBookMemberView {
  id: string | null;
  book_id: string;
  user_id: string | null;
  invited_email: string | null;
  finance_role: FinanceBookRole;
  capabilities: Record<string, unknown> | null;
  /** True when the grant lives on the parent F2 (or is implicit ownership). */
  inherited: boolean;
  /** 'direct' | 'parent' | 'team_owner' — where the grant comes from. */
  source: 'direct' | 'parent' | 'team_owner';
  granted_by: string | null;
  created_at: string | null;
  user: MemberProfileSummary | null;
}

const MEMBER_SELECT = `
  id, book_id, user_id, invited_email, finance_role, capabilities,
  granted_by, created_at,
  user:profiles!finance_book_members_user_id_fkey(id, display_name, avatar_url, email)
`;

/** Roles a member row may carry. Owner is implicit and never grantable. */
const GRANTABLE_ROLES: FinanceBookRole[] = [
  'manager',
  'accountant',
  'viewer_client',
  'viewer',
];

/**
 * Membership administration on a finance book. Like every finance service it
 * runs on the service-role client, so the `assertBookCapability` calls here
 * ARE the security boundary. Misses throw NotFound, never Forbidden.
 *
 * Owner is never a grantable role: ownership is implicit from the book
 * (personal owner user, team owner) so it survives team ownership transfer
 * without any row surgery.
 */
@Injectable()
export class FinanceBookMembersService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly access: FinanceBookAccessService,
  ) {}

  /** Everyone with 'view' sees the roster, including inherited F2 grants. */
  async listMembers(
    callerId: string,
    bookId: string,
  ): Promise<FinanceBookMemberView[]> {
    const access = await this.access.assertBookCapability(
      callerId,
      bookId,
      'view',
    );
    const { book } = access;

    const out: FinanceBookMemberView[] = [];

    // Implicit owner: the team owner (team/project books) or the user (F1).
    const implicitOwnerId =
      book.kind === 'personal' ? book.owner_user_id : null;
    if (book.owner_team_id) {
      const { data: team, error } = await this.supabase
        .from('teams')
        .select('owner_id')
        .eq('id', book.owner_team_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const ownerId = (team as { owner_id?: string } | null)?.owner_id ?? null;
      if (ownerId) {
        out.push(await this.implicitOwnerView(book.id, ownerId));
      }
    } else if (implicitOwnerId) {
      out.push(await this.implicitOwnerView(book.id, implicitOwnerId));
    }

    const direct = await this.fetchMemberRows(book.id);
    for (const row of direct) {
      out.push({ ...row, inherited: false, source: 'direct' });
    }

    // Read-time F2 -> F3 inheritance: parent owner/manager rows apply here.
    if (book.kind === 'project' && book.parent_book_id) {
      const seen = new Set(
        out.map((m) => m.user_id).filter((id): id is string => Boolean(id)),
      );
      const parentRows = await this.fetchMemberRows(book.parent_book_id);
      for (const row of parentRows) {
        if (row.finance_role !== 'owner' && row.finance_role !== 'manager') {
          continue;
        }
        if (row.user_id && seen.has(row.user_id)) continue;
        out.push({
          ...row,
          book_id: book.id,
          inherited: true,
          source: 'parent',
        });
      }
    }
    return out;
  }

  /** Add a known user directly (no invite). Requires 'manage_members'. */
  async addMember(
    callerId: string,
    bookId: string,
    userId: string,
    financeRole: FinanceBookRole,
    capabilities?: Record<string, unknown>,
  ): Promise<FinanceBookMemberView> {
    await this.access.assertBookCapability(callerId, bookId, 'manage_members');
    this.assertGrantableRole(financeRole);

    const { data, error } = await this.supabase
      .from('finance_book_members')
      .insert({
        book_id: bookId,
        user_id: userId,
        finance_role: financeRole,
        capabilities: capabilities ?? {},
        granted_by: callerId,
      })
      .select(MEMBER_SELECT)
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new ConflictException(
          'That person is already a member of this book',
        );
      }
      throw new Error(error.message);
    }
    return {
      ...(data as unknown as Omit<
        FinanceBookMemberView,
        'inherited' | 'source'
      >),
      inherited: false,
      source: 'direct',
    };
  }

  /** Change a member's role and/or capability overrides. */
  async updateMember(
    callerId: string,
    bookId: string,
    memberId: string,
    patch: {
      finance_role?: FinanceBookRole;
      capabilities?: Record<string, unknown>;
    },
  ): Promise<FinanceBookMemberView> {
    await this.access.assertBookCapability(callerId, bookId, 'manage_members');
    if (patch.finance_role) this.assertGrantableRole(patch.finance_role);

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.finance_role) update.finance_role = patch.finance_role;
    if (patch.capabilities !== undefined) {
      update.capabilities = patch.capabilities;
    }

    const { data, error } = await this.supabase
      .from('finance_book_members')
      .update(update)
      .eq('id', memberId)
      .eq('book_id', bookId)
      .select(MEMBER_SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Finance book member not found');
    return {
      ...(data as unknown as Omit<
        FinanceBookMemberView,
        'inherited' | 'source'
      >),
      inherited: false,
      source: 'direct',
    };
  }

  async removeMember(
    callerId: string,
    bookId: string,
    memberId: string,
  ): Promise<{ removed: true }> {
    await this.access.assertBookCapability(callerId, bookId, 'manage_members');
    const { data, error } = await this.supabase
      .from('finance_book_members')
      .delete()
      .eq('id', memberId)
      .eq('book_id', bookId)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Finance book member not found');
    return { removed: true };
  }

  private assertGrantableRole(role: FinanceBookRole): void {
    if (!GRANTABLE_ROLES.includes(role)) {
      throw new BadRequestException(
        'Ownership is implicit from the book — the owner role cannot be granted',
      );
    }
  }

  private async fetchMemberRows(
    bookId: string,
  ): Promise<Array<Omit<FinanceBookMemberView, 'inherited' | 'source'>>> {
    const { data, error } = await this.supabase
      .from('finance_book_members')
      .select(MEMBER_SELECT)
      .eq('book_id', bookId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Array<
      Omit<FinanceBookMemberView, 'inherited' | 'source'>
    >;
  }

  private async implicitOwnerView(
    bookId: string,
    ownerId: string,
  ): Promise<FinanceBookMemberView> {
    const { data } = await this.supabase
      .from('profiles')
      .select('id, display_name, avatar_url, email')
      .eq('id', ownerId)
      .maybeSingle();
    return {
      id: null,
      book_id: bookId,
      user_id: ownerId,
      invited_email: null,
      finance_role: 'owner',
      capabilities: null,
      inherited: true,
      source: 'team_owner',
      granted_by: null,
      created_at: null,
      user: (data as MemberProfileSummary | null) ?? null,
    };
  }
}
