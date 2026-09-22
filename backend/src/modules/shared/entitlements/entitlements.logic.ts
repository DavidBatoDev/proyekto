import {
  ENTITLEMENT_KEYS,
  isEntitlementKey,
  isPlanId,
  PLAN_IDS,
  PLAN_LABELS,
  PLAN_RANK,
  type CompPlan,
  type CountKey,
  type EntitlementKeyDef,
  type KeyMeta,
  type LimitCell,
  type LimitKind,
  type LimitMatrix,
  type PlanId,
  type PlanLimitContext,
  type PlanSource,
  type WorkspacePlanState,
} from './entitlement-keys';
import type { PlanLimitPayload } from './plan-limit.exception';
import type {
  PlanLimitKeyRow,
  PlanLimitRow,
  WorkspacePlanStateRow,
} from './repositories/entitlements.repository.interface';

/**
 * Pure entitlement rules: no Nest, no I/O, so every decision the service makes
 * can be pinned by a unit test without a container.
 */

const LIMIT_KINDS: readonly LimitKind[] = ['count', 'quota', 'days', 'feature'];
const PLANS_BY_RANK: readonly PlanId[] = [...PLAN_IDS].sort(
  (a, b) => PLAN_RANK[a] - PLAN_RANK[b],
);
const TOP_PLAN: PlanId = PLANS_BY_RANK[PLANS_BY_RANK.length - 1];

function isLimitKind(value: string): value is LimitKind {
  return (LIMIT_KINDS as readonly string[]).includes(value);
}

/** "roadmap_nodes_per_roadmap" -> "Roadmap nodes per roadmap". Fallback copy only. */
export function humanizeKey(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function planLabel(plan: PlanId): string {
  return PLAN_LABELS[plan] ?? humanizeKey(plan);
}

/**
 * The enforceable number in a cell. Null means no limit applies: unlimited, a
 * feature cell, or no cell at all (drift fails open).
 */
export function numericLimit(
  cell: LimitCell | null | undefined,
): number | null {
  if (!cell || cell.kind === 'feature') return null;
  return typeof cell.value === 'number' ? cell.value : null;
}

/** Whether a feature is on. A missing or mistyped cell fails open. */
export function featureEnabled(cell: LimitCell | null | undefined): boolean {
  if (!cell || cell.kind !== 'feature') return true;
  return cell.enabled !== false;
}

/** The grandfather rule: data over a limit stays, it just cannot grow. */
export function violatesGrandfatheredLimit(
  limit: number | null,
  prev: number,
  next: number,
): boolean {
  return limit !== null && next > limit && next > prev;
}

function failOpenCell(kind: LimitKind): LimitCell {
  return kind === 'feature'
    ? { kind: 'feature', enabled: true, display_label: null }
    : { kind, value: null, per_seat: false, display_label: null };
}

function toCell(row: PlanLimitRow, kind: LimitKind): LimitCell {
  const display_label = row.display_label ?? null;
  if (kind === 'feature') {
    // The CHECK forbids a NULL bool on a feature; if one ever slips through,
    // fail open rather than switch a paid feature off.
    return { kind, enabled: row.bool_value !== false, display_label };
  }
  return {
    kind,
    value: typeof row.int_value === 'number' ? row.int_value : null,
    per_seat: row.per_seat === true,
    display_label,
  };
}

/** Later of two timestamps; equal milliseconds fall back to the string, which keeps microseconds. */
function laterTimestamp(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return b;
  if (Number.isNaN(tb)) return a;
  if (ta !== tb) return ta > tb ? a : b;
  return a >= b ? a : b;
}

/**
 * Joins the two limit tables into the matrix, and reports where they disagree
 * with the code registry.
 *
 * - A code key with no key row, or whose kind differs, is left out of `keys`
 *   and `cells` and listed in `drift.missing_in_db`. Reading its cell then gets
 *   undefined, which numericLimit/featureEnabled treat as unlimited/enabled:
 *   a half-applied migration never blocks anyone.
 * - A key row missing a plan's row gets a fail-open cell for that plan, and a
 *   code key in that state is also listed as missing.
 * - A key the code does not know is kept for display with `enforced: false`
 *   and listed in `drift.unknown_to_code`.
 * - `version` is the newest `updated_at` exactly as the database wrote it.
 *   The admin editor sends it back as its stale-write guard, so it must not be
 *   rounded to milliseconds.
 */
export function buildMatrix(
  keyRows: PlanLimitKeyRow[],
  limitRows: PlanLimitRow[],
): LimitMatrix {
  const plans = [...PLANS_BY_RANK];
  const cells = Object.fromEntries(plans.map((plan) => [plan, {}])) as Record<
    PlanId,
    Record<string, LimitCell>
  >;
  const rowByCell = new Map<string, PlanLimitRow>();
  let version: string | null = null;
  for (const row of limitRows) {
    version = laterTimestamp(version, row.updated_at ?? null);
    if (isPlanId(row.plan)) rowByCell.set(`${row.plan}:${row.limit_key}`, row);
  }

  const missing = new Set<string>();
  const unknown: string[] = [];
  const keys: KeyMeta[] = [];
  const seen = new Set<string>();

  const sortedKeyRows = [...keyRows].sort(
    (a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key),
  );
  for (const row of sortedKeyRows) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    const code = isEntitlementKey(row.key) ? ENTITLEMENT_KEYS[row.key] : null;
    if (code && code.kind !== row.kind) {
      missing.add(row.key);
      continue;
    }
    if (!code) unknown.push(row.key);
    const kind: LimitKind = code
      ? code.kind
      : isLimitKind(row.kind)
        ? row.kind
        : 'feature';

    keys.push({
      key: row.key,
      kind,
      label: row.label,
      unit: row.unit ?? null,
      group: row.group_key,
      sort_order: row.sort_order,
      description: row.description ?? null,
      enforced: code?.enforced ?? false,
    });

    for (const plan of plans) {
      const limitRow = rowByCell.get(`${plan}:${row.key}`);
      if (!limitRow || limitRow.kind !== kind) {
        if (code) missing.add(row.key);
        cells[plan][row.key] = failOpenCell(kind);
        continue;
      }
      cells[plan][row.key] = toCell(limitRow, kind);
    }
  }

  for (const key of Object.keys(ENTITLEMENT_KEYS)) {
    if (!seen.has(key)) missing.add(key);
  }

  return {
    plans,
    keys,
    cells,
    version,
    drift: { missing_in_db: [...missing], unknown_to_code: unknown },
  };
}

/**
 * The cheapest plan ranked above `current` that would allow the action, read
 * from the live matrix so an admin edit changes the answer. Null means no
 * plan does (the UI says "Contact sales").
 *
 * `needed` is the count the action requires. Without it, a numeric key asks
 * for any plan more generous than the current one.
 */
export function computeUpgradePlan(
  matrix: Pick<LimitMatrix, 'cells'>,
  current: PlanId,
  key: string,
  needed?: number,
): PlanId | null {
  const currentValue = numericLimit(matrix.cells[current]?.[key]);
  for (const plan of PLANS_BY_RANK) {
    if (PLAN_RANK[plan] <= PLAN_RANK[current]) continue;
    const cell = matrix.cells[plan]?.[key];
    if (!cell) continue;
    if (cell.kind === 'feature') {
      if (cell.enabled) return plan;
      continue;
    }
    if (cell.value === null) return plan;
    if (needed !== undefined) {
      if (cell.value >= needed) return plan;
    } else if (currentValue !== null && cell.value > currentValue) {
      return plan;
    }
  }
  return null;
}

/** The cheapest plan, Free included, whose cell turns a feature on. */
export function featureAvailableOn(
  matrix: Pick<LimitMatrix, 'cells'>,
  key: string,
): PlanId | null {
  for (const plan of PLANS_BY_RANK) {
    const cell = matrix.cells[plan]?.[key];
    if (cell?.kind === 'feature' && cell.enabled) return plan;
  }
  return null;
}

/** Whether every plan ranked at or above `from` includes the feature. */
function featureIncludedFrom(
  matrix: Pick<LimitMatrix, 'cells'>,
  key: string,
  from: PlanId,
): boolean {
  return PLANS_BY_RANK.filter((plan) => PLAN_RANK[plan] >= PLAN_RANK[from])
    .map((plan) => matrix.cells[plan]?.[key])
    .every((cell) => cell?.kind === 'feature' && cell.enabled);
}

export type MeterState = 'unlimited' | 'ok' | 'near' | 'at' | 'over';

/** `over` is grandfathered data: allowed to stay, not to grow. */
export function meterState(used: number, limit: number | null): MeterState {
  if (limit === null) return 'unlimited';
  if (used > limit) return 'over';
  if (used === limit) return 'at';
  if (used >= 0.8 * limit) return 'near';
  return 'ok';
}

/** The workspace-scoped counts above their plan's limit (grandfathered), in key order. */
export function overLimitKeys(
  usage: Partial<Record<CountKey, number>>,
  limits: Record<string, LimitCell> | undefined,
): CountKey[] {
  const keys: CountKey[] = ['members', 'projects', 'teams'];
  return keys.filter((key) => {
    const limit = numericLimit(limits?.[key]);
    const used = usage[key];
    return limit !== null && typeof used === 'number' && used > limit;
  });
}

export interface PublicPlans {
  plans: PlanId[];
  keys: Array<Omit<KeyMeta, 'enforced'>>;
  limits: Record<PlanId, Record<string, LimitCell>>;
  version: string | null;
}

/** GET /api/plans: the matrix without what only staff should see. */
export function toPublicPlans(matrix: LimitMatrix): PublicPlans {
  return {
    plans: [...matrix.plans],
    keys: matrix.keys.map(
      ({ key, kind, label, unit, group, sort_order, description }) => ({
        key,
        kind,
        label,
        unit,
        group,
        sort_order,
        description,
      }),
    ),
    limits: matrix.cells,
    version: matrix.version,
  };
}

export function defaultPlanState(workspaceId: string): WorkspacePlanState {
  return {
    workspace_id: workspaceId,
    workspace_name: null,
    workspace_slug: null,
    effective_plan: 'free',
    plan_source: 'default',
    subscription_plan: 'free',
    subscription_status: null,
    has_provider_subscription: false,
    complimentary: null,
  };
}

function isPlanSource(value: unknown): value is PlanSource {
  return (
    value === 'complimentary' || value === 'subscription' || value === 'default'
  );
}

function isCompPlan(value: unknown): value is CompPlan {
  return isPlanId(value) && value !== 'free';
}

/**
 * Maps a workspace_plan_state row. The effective plan is decided in SQL and
 * only read here; an unrecognized value degrades to Free rather than guessing.
 */
export function toWorkspacePlanState(
  row: WorkspacePlanStateRow,
): WorkspacePlanState {
  const compPlan =
    row.is_discounted_free === true && isCompPlan(row.discounted_plan)
      ? row.discounted_plan
      : null;
  return {
    workspace_id: row.workspace_id,
    workspace_name: row.workspace_name ?? null,
    workspace_slug: row.workspace_slug ?? null,
    effective_plan: isPlanId(row.effective_plan) ? row.effective_plan : 'free',
    plan_source: isPlanSource(row.plan_source) ? row.plan_source : 'default',
    subscription_plan: isPlanId(row.subscription_plan)
      ? row.subscription_plan
      : 'free',
    subscription_status: row.subscription_status ?? null,
    has_provider_subscription: row.has_provider_subscription === true,
    complimentary: compPlan
      ? {
          plan: compPlan,
          since: row.discounted_at ?? null,
          until: row.discounted_until ?? null,
          active: row.comp_active === true,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function singularUnit(unit: string): string {
  return unit.length > 1 && unit.endsWith('s') ? unit.slice(0, -1) : unit;
}

function unitFor(unit: string, n: number | null): string {
  return n === 1 ? singularUnit(unit) : unit;
}

function featureIsPlural(key: string, label: string): boolean {
  if (isEntitlementKey(key)) {
    const def: EntitlementKeyDef = ENTITLEMENT_KEYS[key];
    return def.plural === true;
  }
  return /s$/.test(label.trim());
}

export interface PlanLimitMessageInput {
  kind: 'count' | 'feature';
  limitKey: string;
  label: string;
  /** plan_limit_keys.unit, e.g. "projects". Falls back to the label. */
  unit?: string | null;
  limit: number | null;
  used: number | null;
  /** The count the write would produce; roadmap-node messages quote it. */
  next?: number | null;
  plan: PlanId;
  upgradePlan: PlanId | null;
  context: PlanLimitContext;
  workspaceName?: string | null;
  /** Members at invite time: the count includes pending invites. */
  countsPendingInvites?: boolean;
  /** Features: false when a plan above upgradePlan turns it back off. */
  includedAbove?: boolean;
}

/**
 * Plain copy for a plan-limit rejection. It must read correctly for someone
 * who is not a member (an invitee accepting), so it names the plan and the
 * limit and tells the reader who can fix it.
 */
export function buildPlanLimitMessage(input: PlanLimitMessageInput): string {
  const plan = planLabel(input.plan);
  const upgrade = input.upgradePlan ? planLabel(input.upgradePlan) : null;

  if (input.kind === 'feature') {
    const verb = featureIsPlural(input.limitKey, input.label) ? 'are' : 'is';
    if (!input.upgradePlan || !upgrade) {
      return `${input.label} ${verb} not included in the ${plan} plan.`;
    }
    const andAbove =
      input.upgradePlan !== TOP_PLAN && input.includedAbove !== false
        ? ' and above'
        : '';
    return `${input.label} ${verb} available on ${upgrade}${andAbove}.`;
  }

  const unit = (input.unit ?? '').trim() || input.label.toLowerCase();
  const limit = input.limit ?? 0;
  const used = input.used ?? 0;

  if (input.limitKey === 'roadmap_nodes_per_roadmap') {
    const next = input.next ?? used;
    if (input.context === 'link') {
      const fix = upgrade
        ? `Remove ${unit} or upgrade that workspace to ${upgrade}, then link it again.`
        : `Remove ${unit}, then link it again.`;
      return `This roadmap has ${next} ${unitFor(unit, next)}; the destination workspace's ${plan} plan allows ${limit} per roadmap. ${fix}`;
    }
    const fix = upgrade
      ? `Remove ${unit} or upgrade to ${upgrade}.`
      : `Remove ${unit} to continue.`;
    return `This change would bring the roadmap to ${next} ${unitFor(unit, next)}; the ${plan} plan allows ${limit} per roadmap. ${fix}`;
  }

  if (input.context === 'accept') {
    const who = input.workspaceName?.trim() || 'This workspace';
    return `${who} has reached the ${limit}-${singularUnit(unit)} limit of its ${plan} plan. Ask a workspace owner to upgrade, then accept this invite again.`;
  }

  const pending = input.countsPendingInvites
    ? ', counting pending invites'
    : '';
  const verb = input.context === 'invite' ? 'invite' : 'add';
  const cta = upgrade
    ? `Upgrade to ${upgrade} to ${verb} more.`
    : 'Contact us to raise this limit.';
  return `Your ${plan} plan includes ${limit} ${unitFor(unit, limit)} and this workspace has ${used}${pending}. ${cta}`;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export interface PlanLimitSubject {
  plan: PlanId;
  workspaceId: string | null;
  workspaceSlug: string | null;
  workspaceName: string | null;
}

function keyMeta(matrix: LimitMatrix, key: string): KeyMeta | undefined {
  return matrix.keys.find((meta) => meta.key === key);
}

/** The body for a count that would go over its limit. */
export function buildCountLimitPayload(
  matrix: LimitMatrix,
  subject: PlanLimitSubject,
  input: {
    key: string;
    limit: number;
    used: number;
    /** The count after the write: used + adding, or the new node total. */
    next: number;
    context: PlanLimitContext;
    countsPendingInvites?: boolean;
  },
): PlanLimitPayload {
  const meta = keyMeta(matrix, input.key);
  const label = meta?.label ?? humanizeKey(input.key);
  const upgradePlan = computeUpgradePlan(
    matrix,
    subject.plan,
    input.key,
    input.next,
  );
  return {
    code: 'plan_limit',
    kind: 'count',
    limit_key: input.key,
    label,
    limit: input.limit,
    used: input.used,
    plan: subject.plan,
    upgrade_plan: upgradePlan,
    workspace_id: subject.workspaceId,
    workspace_slug: subject.workspaceSlug,
    context: input.context,
    message: buildPlanLimitMessage({
      kind: 'count',
      limitKey: input.key,
      label,
      unit: meta?.unit ?? null,
      limit: input.limit,
      used: input.used,
      next: input.next,
      plan: subject.plan,
      upgradePlan,
      context: input.context,
      workspaceName: subject.workspaceName,
      countsPendingInvites: input.countsPendingInvites,
    }),
  };
}

/** The body for a feature the plan does not include. */
export function buildFeatureLimitPayload(
  matrix: LimitMatrix,
  subject: PlanLimitSubject,
  input: { key: string; context: PlanLimitContext },
): PlanLimitPayload {
  const meta = keyMeta(matrix, input.key);
  const label = meta?.label ?? humanizeKey(input.key);
  const upgradePlan = computeUpgradePlan(matrix, subject.plan, input.key);
  return {
    code: 'plan_limit',
    kind: 'feature',
    limit_key: input.key,
    label,
    limit: null,
    used: null,
    plan: subject.plan,
    upgrade_plan: upgradePlan,
    workspace_id: subject.workspaceId,
    workspace_slug: subject.workspaceSlug,
    context: input.context,
    message: buildPlanLimitMessage({
      kind: 'feature',
      limitKey: input.key,
      label,
      limit: null,
      used: null,
      plan: subject.plan,
      upgradePlan,
      context: input.context,
      workspaceName: subject.workspaceName,
      includedAbove: upgradePlan
        ? featureIncludedFrom(matrix, input.key, upgradePlan)
        : undefined,
    }),
  };
}

/** Shape check for a matrix read back from Redis; anything else is reloaded. */
export function isLimitMatrix(value: unknown): value is LimitMatrix {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LimitMatrix>;
  return (
    Array.isArray(candidate.plans) &&
    Array.isArray(candidate.keys) &&
    !!candidate.cells &&
    typeof candidate.cells === 'object' &&
    !!candidate.drift &&
    Array.isArray(candidate.drift.missing_in_db)
  );
}
