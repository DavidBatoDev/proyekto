import {
  WORKSPACE_PLANS,
  type WorkspacePlan,
} from '../../execution/workspaces/dto/workspaces.dto';

/**
 * The code half of the plan-limit registry, and the shared types every
 * entitlements consumer speaks.
 *
 * The registry is split by which side owns each fact:
 *   - the DATABASE (plan_limit_keys + plan_limits, seeded by
 *     20260922120000_workspace_plan_limits.sql) owns the label, unit, group,
 *     sort order and every plan's value, so an admin can change a limit
 *     without a deploy;
 *   - this file owns what only the code can know: whether a key is enforced
 *     anywhere, what it is counted against, and the admin editor's floor.
 *
 * entitlement-keys.migration-parity.spec.ts keeps the two in step: every key
 * here must be seeded with the same kind and one row per plan. At runtime a
 * code key the database lacks fails open, and a database key this file does
 * not know passes through as display-only (see buildMatrix).
 */

export type PlanId = WorkspacePlan;
export type CompPlan = Exclude<PlanId, 'free'>;
export type PlanSource = 'complimentary' | 'subscription' | 'default';
export type LimitKind = 'count' | 'quota' | 'days' | 'feature';

/** Cheapest first. Mirrors public.plan_rank(). */
export const PLAN_IDS: readonly PlanId[] = WORKSPACE_PLANS;

export const PLAN_RANK: Record<PlanId, number> = {
  free: 0,
  pro: 1,
  business: 2,
  enterprise: 3,
};

export const PLAN_LABELS: Record<PlanId, string> = {
  free: 'Free',
  pro: 'Pro',
  business: 'Business',
  enterprise: 'Enterprise',
};

export function isPlanId(value: unknown): value is PlanId {
  return (
    typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value)
  );
}

export interface EntitlementKeyDef {
  kind: LimitKind;
  /** True when some write path actually checks this key. Display-only otherwise. */
  enforced: boolean;
  /** What a count or quota is measured against. */
  scope?: 'workspace' | 'roadmap';
  /** The smallest value the admin editor accepts (members: an owner must fit). */
  min?: number;
  /** Feature labels only: verb agreement in "X are available on Pro and above". */
  plural?: boolean;
}

export const ENTITLEMENT_KEYS = {
  members: { kind: 'count', scope: 'workspace', enforced: true, min: 1 },
  projects: { kind: 'count', scope: 'workspace', enforced: true },
  teams: { kind: 'count', scope: 'workspace', enforced: true },
  roadmap_nodes_per_roadmap: {
    kind: 'count',
    scope: 'roadmap',
    enforced: true,
  },
  ai_messages_monthly: { kind: 'quota', scope: 'workspace', enforced: false },
  deliverables: { kind: 'feature', enforced: true, plural: true },
  deliverable_review: { kind: 'feature', enforced: true },
  change_requests: { kind: 'feature', enforced: true, plural: true },
  risks: { kind: 'feature', enforced: true },
  decisions: { kind: 'feature', enforced: true },
  custom_register_fields: { kind: 'feature', enforced: false, plural: true },
  time_tracking: { kind: 'feature', enforced: true, plural: true },
  private_teams_guests: { kind: 'feature', enforced: false, plural: true },
  roles_permissions: { kind: 'feature', enforced: false, plural: true },
  activity_retention_days: { kind: 'days', enforced: true },
  activity_export: { kind: 'feature', enforced: false },
  mcp_server: { kind: 'feature', enforced: true },
  saml_scim: { kind: 'feature', enforced: false, plural: true },
} as const satisfies Record<string, EntitlementKeyDef>;

export type EntitlementKey = keyof typeof ENTITLEMENT_KEYS;

/** Workspace-scoped counts: the ones workspace_usage_counts can answer. */
export type CountKey = 'members' | 'projects' | 'teams';

export type FeatureKey =
  | 'deliverables'
  | 'deliverable_review'
  | 'change_requests'
  | 'risks'
  | 'decisions'
  | 'custom_register_fields'
  | 'time_tracking'
  | 'private_teams_guests'
  | 'roles_permissions'
  | 'activity_export'
  | 'mcp_server'
  | 'saml_scim';

/** The numeric keys getLimit answers. */
export type NumericLimitKey =
  | CountKey
  | 'roadmap_nodes_per_roadmap'
  | 'activity_retention_days';

// Compile-time guards: the hand-written unions above must match the registry.
// A key added to one and not the other fails the build here, not at runtime.
type KeysOfKind<K extends LimitKind> = {
  [P in EntitlementKey]: (typeof ENTITLEMENT_KEYS)[P]['kind'] extends K
    ? P
    : never;
}[EntitlementKey];
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const FEATURE_KEYS_MATCH: Exact<FeatureKey, KeysOfKind<'feature'>> = true;
const COUNT_KEYS_ARE_COUNTS: CountKey extends KeysOfKind<'count'>
  ? true
  : false = true;
void FEATURE_KEYS_MATCH;
void COUNT_KEYS_ARE_COUNTS;

export function isEntitlementKey(key: string): key is EntitlementKey {
  return Object.hasOwn(ENTITLEMENT_KEYS, key);
}

/** NULL `value` means unlimited. `display_label` is marketing copy; enforcement ignores it. */
export type LimitCell =
  | {
      kind: 'count' | 'quota' | 'days';
      value: number | null;
      per_seat: boolean;
      display_label: string | null;
    }
  | { kind: 'feature'; enabled: boolean; display_label: string | null };

export interface KeyMeta {
  key: string;
  kind: LimitKind;
  label: string;
  unit: string | null;
  group: string;
  sort_order: number;
  description: string | null;
  enforced: boolean;
}

export interface LimitMatrix {
  plans: PlanId[];
  keys: KeyMeta[];
  cells: Record<PlanId, Record<string, LimitCell>>;
  /** max(plan_limits.updated_at); the admin editor's optimistic-concurrency token. */
  version: string | null;
  drift: { missing_in_db: string[]; unknown_to_code: string[] };
}

/**
 * Who an entitlement check is evaluated against. `workspaceId: null` without
 * `exempt` is an unhomed resource (a project whose workspace was deleted, a
 * roadmap whose owner owns no workspace): it gets Free limits.
 */
export interface EntitlementScope {
  workspaceId: string | null;
  exempt: boolean;
}

/**
 * A string is a workspace id. `null` is exempt: it is what
 * resolveWorkspaceForWrite returns for a guest, who has no workspace.
 */
export type EntitlementRef = string | null | EntitlementScope;

/** Which action tripped a limit; the web picks its copy and call to action from it. */
export type PlanLimitContext =
  | 'invite'
  | 'accept'
  | 'create'
  | 'full_state'
  | 'link'
  | 'enable'
  | 'write';

export interface WorkspacePlanState {
  workspace_id: string;
  workspace_name: string | null;
  workspace_slug: string | null;
  effective_plan: PlanId;
  plan_source: PlanSource;
  /** What the provider bills, or 'free' with no subscription row. */
  subscription_plan: PlanId;
  subscription_status: string | null;
  has_provider_subscription: boolean;
  complimentary: {
    plan: CompPlan;
    since: string | null;
    until: string | null;
    active: boolean;
  } | null;
}
