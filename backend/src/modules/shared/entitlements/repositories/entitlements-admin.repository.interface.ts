import type { AdminWorkspaceFilter } from '../dto/entitlements.dto';
import type { CompPlan } from '../entitlement-keys';

/**
 * Staff reads and writes behind EntitlementsAdminService. Every function named
 * here lives in 20260922120000_workspace_plan_limits.sql and is SECURITY
 * INVOKER, service_role only, so this repository runs on the admin client and
 * the controllers' AdminGuard / SuperAdminGuard are the authorization.
 *
 * Implementations throw EntitlementsAdminQueryError, which keeps the SQLSTATE
 * next to the message. The admin RPCs raise bare tokens (plan_limits_stale,
 * workspace_not_found, ...) as the message, and the service maps them to HTTP
 * by that text.
 */

export const ENTITLEMENTS_ADMIN_REPOSITORY = Symbol(
  'ENTITLEMENTS_ADMIN_REPOSITORY',
);

export class EntitlementsAdminQueryError extends Error {
  constructor(
    message: string,
    /** The Postgres SQLSTATE when PostgREST reported one (22023, 23514, P0001...). */
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'EntitlementsAdminQueryError';
  }
}

/** One full cell as admin_update_plan_limits expects it. NULL int_value = unlimited. */
export interface PlanLimitCellWrite {
  plan: string;
  limit_key: string;
  int_value: number | null;
  bool_value: boolean | null;
  per_seat: boolean;
  display_label: string | null;
}

/** A row of admin_list_workspaces(text, text, int, int). */
export interface AdminWorkspaceListRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  owner_id: string | null;
  owner_email: string | null;
  members: number;
  pending_invites: number;
  projects: number;
  teams: number;
  subscription_plan: string | null;
  subscription_status: string | null;
  has_provider_subscription: boolean;
  is_discounted_free: boolean;
  discounted_plan: string | null;
  discounted_at: string | null;
  discounted_until: string | null;
  effective_plan: string | null;
  plan_source: string | null;
  total_count: number;
}

/** The parts of one workspace the list function would give, minus plan and usage. */
export interface AdminWorkspaceHeader {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  /** The earliest owner membership, the same rule the list uses. */
  owner_id: string | null;
  owner_email: string | null;
}

/** A row of platform_admin_audit_log. */
export interface AdminAuditEntry {
  id: string;
  action: string;
  actor_id: string | null;
  note: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
}

export interface AdminWorkspaceListParams {
  /** Already LIKE-escaped by the caller; null for no search. */
  search: string | null;
  filter: AdminWorkspaceFilter;
  limit: number;
  offset: number;
}

export interface EntitlementsAdminRepository {
  /** admin_update_plan_limits. Returns the rows updated. */
  updatePlanLimits(
    changes: PlanLimitCellWrite[],
    actorId: string,
    note: string | null,
    baseVersion: string | null,
  ): Promise<number>;

  listWorkspaces(
    params: AdminWorkspaceListParams,
  ): Promise<AdminWorkspaceListRow[]>;

  /** Null when the workspace does not exist. */
  findWorkspaceHeader(
    workspaceId: string,
  ): Promise<AdminWorkspaceHeader | null>;

  /** Newest first. */
  listWorkspaceAudit(
    workspaceId: string,
    limit: number,
  ): Promise<AdminAuditEntry[]>;

  /** admin_set_workspace_comp. Returns whether anything changed. */
  setWorkspaceComp(
    workspaceId: string,
    plan: CompPlan,
    until: string | null,
    note: string,
    actorId: string,
  ): Promise<boolean>;

  /** admin_clear_workspace_comp. Returns whether anything changed. */
  clearWorkspaceComp(
    workspaceId: string,
    note: string | null,
    actorId: string,
  ): Promise<boolean>;
}
