import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import type { CompPlan } from '../entitlement-keys';
import {
  EntitlementsAdminQueryError,
  type AdminAuditEntry,
  type AdminWorkspaceHeader,
  type AdminWorkspaceListParams,
  type AdminWorkspaceListRow,
  type EntitlementsAdminRepository,
  type PlanLimitCellWrite,
} from './entitlements-admin.repository.interface';

type QueryError = { message: string; code?: string | null } | null;

function fail(error: NonNullable<QueryError>): never {
  throw new EntitlementsAdminQueryError(error.message, error.code ?? null);
}

function toInt(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Supabase types a to-one embed as an array; either shape can arrive. */
function firstEmbedded<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

@Injectable()
export class SupabaseEntitlementsAdminRepository implements EntitlementsAdminRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async updatePlanLimits(
    changes: PlanLimitCellWrite[],
    actorId: string,
    note: string | null,
    baseVersion: string | null,
  ): Promise<number> {
    const { data, error } = (await this.db.rpc('admin_update_plan_limits', {
      p_changes: changes,
      p_actor: actorId,
      p_note: note,
      p_base_version: baseVersion,
    })) as { data: unknown; error: QueryError };
    if (error) fail(error);
    return toInt(data);
  }

  async listWorkspaces(
    params: AdminWorkspaceListParams,
  ): Promise<AdminWorkspaceListRow[]> {
    // No defaults on the SQL side: all four arguments, every time.
    const { data, error } = (await this.db.rpc('admin_list_workspaces', {
      p_search: params.search,
      p_filter: params.filter,
      p_limit: params.limit,
      p_offset: params.offset,
    })) as { data: unknown; error: QueryError };
    if (error) fail(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      name: str(row.name) ?? '',
      slug: str(row.slug) ?? '',
      created_at: str(row.created_at) ?? '',
      owner_id: str(row.owner_id),
      owner_email: str(row.owner_email),
      members: toInt(row.members),
      pending_invites: toInt(row.pending_invites),
      projects: toInt(row.projects),
      teams: toInt(row.teams),
      subscription_plan: str(row.subscription_plan),
      subscription_status: str(row.subscription_status),
      has_provider_subscription: row.has_provider_subscription === true,
      is_discounted_free: row.is_discounted_free === true,
      discounted_plan: str(row.discounted_plan),
      discounted_at: str(row.discounted_at),
      discounted_until: str(row.discounted_until),
      effective_plan: str(row.effective_plan),
      plan_source: str(row.plan_source),
      total_count: toInt(row.total_count),
    }));
  }

  async findWorkspaceHeader(
    workspaceId: string,
  ): Promise<AdminWorkspaceHeader | null> {
    const { data, error } = (await this.db
      .from('workspaces')
      .select('id, name, slug, created_at')
      .eq('id', workspaceId)
      .maybeSingle()) as { data: unknown; error: QueryError };
    if (error) fail(error);
    if (!data) return null;
    const row = data as Record<string, unknown>;

    // Earliest owner membership, as admin_list_workspaces picks it.
    const { data: owners, error: ownerError } = (await this.db
      .from('workspace_members')
      .select(
        'user_id, joined_at, profile:profiles!workspace_members_user_id_fkey(email)',
      )
      .eq('workspace_id', workspaceId)
      .eq('role', 'owner')
      .order('joined_at', { ascending: true })
      .order('user_id', { ascending: true })
      .limit(1)) as { data: unknown; error: QueryError };
    if (ownerError) fail(ownerError);
    const owner = ((owners ?? []) as Array<Record<string, unknown>>)[0];
    const profile = firstEmbedded(
      owner?.profile as
        | { email?: string | null }
        | Array<{ email?: string | null }>
        | null
        | undefined,
    );

    return {
      id: String(row.id),
      name: str(row.name) ?? '',
      slug: str(row.slug) ?? '',
      created_at: str(row.created_at) ?? '',
      owner_id: owner ? str(owner.user_id) : null,
      owner_email: str(profile?.email),
    };
  }

  async listWorkspaceAudit(
    workspaceId: string,
    limit: number,
  ): Promise<AdminAuditEntry[]> {
    const { data, error } = (await this.db
      .from('platform_admin_audit_log')
      .select('id, action, actor_id, note, before, after, created_at')
      .eq('target_type', 'workspace')
      .eq('target_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit)) as { data: unknown; error: QueryError };
    if (error) fail(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      action: str(row.action) ?? '',
      actor_id: str(row.actor_id),
      note: str(row.note),
      before: row.before ?? null,
      after: row.after ?? null,
      created_at: str(row.created_at) ?? '',
    }));
  }

  async setWorkspaceComp(
    workspaceId: string,
    plan: CompPlan,
    until: string | null,
    note: string,
    actorId: string,
  ): Promise<boolean> {
    const { data, error } = (await this.db.rpc('admin_set_workspace_comp', {
      p_workspace_id: workspaceId,
      p_plan: plan,
      p_until: until,
      p_note: note,
      p_actor: actorId,
    })) as { data: unknown; error: QueryError };
    if (error) fail(error);
    return data === true;
  }

  async clearWorkspaceComp(
    workspaceId: string,
    note: string | null,
    actorId: string,
  ): Promise<boolean> {
    const { data, error } = (await this.db.rpc('admin_clear_workspace_comp', {
      p_workspace_id: workspaceId,
      p_note: note,
      p_actor: actorId,
    })) as { data: unknown; error: QueryError };
    if (error) fail(error);
    return data === true;
  }
}
