/**
 * The plan-limit catalogue: which limits exist, what each plan allows, and how
 * to read a cell.
 *
 * The numbers live in the database (`plan_limits`, editable by a super admin)
 * and reach the web through `GET /api/plans` and `GET /api/workspaces/:id/usage`.
 * `DEFAULT_PLAN_LIMITS` is the seed of that table, copied here so /pricing has
 * something honest to render on the first frame and during an API outage. It
 * must stay identical to the seed in
 * supabase/migrations/20260922120000_workspace_plan_limits.sql — a test pins
 * the literal so a drift shows up as a failing diff rather than a pricing page
 * that quietly disagrees with enforcement.
 *
 * The key names are canonical across the DB, the backend and here. A server
 * response is never trusted blindly: `normalizePlanLimits` validates every cell
 * and falls back to the default cell for anything malformed, so a bad payload
 * degrades to the published matrix instead of a blank page.
 */

export type PlanId = "free" | "pro" | "business" | "enterprise";

/** Lowest to highest. Rank is the index, matching SQL `plan_rank()`. */
export const PLAN_ORDER: readonly PlanId[] = [
	"free",
	"pro",
	"business",
	"enterprise",
];

/** Why a workspace is on its effective plan (SQL `workspace_plan_state`). */
export type PlanSource = "complimentary" | "subscription" | "default";

const PLAN_LABELS: Record<PlanId, string> = {
	free: "Free",
	pro: "Pro",
	business: "Business",
	enterprise: "Enterprise",
};

export function isPlanId(value: unknown): value is PlanId {
	return typeof value === "string" && value in PLAN_LABELS;
}

/** 0 for free … 3 for enterprise; -1 for anything that is not a plan. */
export function planRank(plan: string | null | undefined): number {
	return isPlanId(plan) ? PLAN_ORDER.indexOf(plan) : -1;
}

/**
 * "Pro" for `pro`. Anything that is not a plan id comes back unchanged, so the
 * copy helpers can take either an id or an already-formatted name.
 */
export function planLabel(plan: PlanId | string): string {
	return isPlanId(plan) ? PLAN_LABELS[plan] : plan;
}

export const LIMIT_KEYS = [
	"members",
	"projects",
	"teams",
	"roadmap_nodes_per_roadmap",
	"ai_messages_monthly",
	"deliverables",
	"deliverable_review",
	"change_requests",
	"risks",
	"decisions",
	"custom_register_fields",
	"time_tracking",
	"private_teams_guests",
	"roles_permissions",
	"activity_retention_days",
	"activity_export",
	"mcp_server",
	"saml_scim",
] as const;

export type LimitKey = (typeof LIMIT_KEYS)[number];

/** The workspace-scoped counts a create can be blocked on. */
export type CountKey = "members" | "projects" | "teams";
export type WorkspaceCountKey = CountKey;

export type NumericLimitKey =
	| CountKey
	| "roadmap_nodes_per_roadmap"
	| "ai_messages_monthly"
	| "activity_retention_days";

export type FeatureKey = Exclude<LimitKey, NumericLimitKey>;

export type LimitKind = "count" | "quota" | "days" | "feature";
export type LimitGroup = "usage" | "ai" | "governance" | "team" | "platform";

/** `value: null` means unlimited. `per_seat` only ever holds on a quota. */
export interface NumericLimitCell {
	kind: "count" | "quota" | "days";
	value: number | null;
	per_seat: boolean;
	display_label: string | null;
}

export interface FeatureLimitCell {
	kind: "feature";
	enabled: boolean;
	display_label: string | null;
}

/** The JSON shape of one (plan, key) cell, identical on every tier. */
export type LimitCell = NumericLimitCell | FeatureLimitCell;

export type PlanLimits = Record<LimitKey, LimitCell>;

/**
 * Any per-plan cell map: the normalized `PlanLimits`, a usage payload's
 * `limits`, or an admin grid row carrying extra fields per cell.
 */
export type LimitCellMap = Readonly<Partial<Record<string, LimitCell>>>;

export interface LimitDefinition {
	key: LimitKey;
	label: string;
	group: LimitGroup;
	kind: LimitKind;
	/** Enforced by the backend today; the rest are published on /pricing only. */
	enforced: boolean;
	/** Null for features, which are on or off rather than counted. */
	unit: { singular: string; plural: string } | null;
	/** The lowest value a numeric cell may hold (the admin API enforces the same). */
	min?: number;
}

const unit = (singular: string, plural: string) => ({ singular, plural });

export const LIMIT_DEFINITIONS: readonly LimitDefinition[] = [
	{
		key: "members",
		label: "Members",
		group: "usage",
		kind: "count",
		enforced: true,
		unit: unit("member", "members"),
		min: 1,
	},
	{
		key: "projects",
		label: "Projects",
		group: "usage",
		kind: "count",
		enforced: true,
		unit: unit("project", "projects"),
		min: 0,
	},
	{
		key: "teams",
		label: "Teams",
		group: "usage",
		kind: "count",
		enforced: true,
		unit: unit("team", "teams"),
		min: 0,
	},
	{
		key: "roadmap_nodes_per_roadmap",
		label: "Roadmap nodes per roadmap",
		group: "usage",
		kind: "count",
		enforced: true,
		unit: unit("node", "nodes"),
		min: 0,
	},
	{
		key: "ai_messages_monthly",
		label: "AI messages",
		group: "ai",
		kind: "quota",
		// Published, not metered: nothing counts AI messages yet.
		enforced: false,
		unit: unit("message", "messages"),
		min: 0,
	},
	{
		key: "deliverables",
		label: "Deliverables",
		group: "governance",
		kind: "feature",
		enforced: true,
		unit: null,
	},
	{
		key: "deliverable_review",
		label: "Deliverable review and acceptance",
		group: "governance",
		kind: "feature",
		enforced: true,
		unit: null,
	},
	{
		key: "change_requests",
		label: "Change requests",
		group: "governance",
		kind: "feature",
		enforced: true,
		unit: null,
	},
	{
		key: "risks",
		label: "Risks and issues register",
		group: "governance",
		kind: "feature",
		enforced: true,
		unit: null,
	},
	{
		key: "decisions",
		label: "Decision log",
		group: "governance",
		kind: "feature",
		enforced: true,
		unit: null,
	},
	{
		key: "custom_register_fields",
		label: "Custom register fields",
		group: "governance",
		kind: "feature",
		enforced: false,
		unit: null,
	},
	{
		key: "time_tracking",
		label: "Time tracking and timesheets",
		group: "team",
		kind: "feature",
		enforced: true,
		unit: null,
	},
	{
		key: "private_teams_guests",
		label: "Private teams and guests",
		group: "team",
		kind: "feature",
		enforced: false,
		unit: null,
	},
	{
		key: "roles_permissions",
		label: "Roles and permissions",
		group: "team",
		kind: "feature",
		enforced: false,
		unit: null,
	},
	{
		key: "activity_retention_days",
		label: "Activity log retention",
		group: "team",
		kind: "days",
		enforced: true,
		unit: unit("day", "days"),
		min: 1,
	},
	{
		key: "activity_export",
		label: "Activity export",
		group: "team",
		kind: "feature",
		enforced: false,
		unit: null,
	},
	{
		key: "mcp_server",
		label: "MCP server",
		group: "platform",
		kind: "feature",
		enforced: true,
		unit: null,
	},
	{
		key: "saml_scim",
		label: "SAML and SCIM",
		group: "platform",
		kind: "feature",
		enforced: false,
		unit: null,
	},
];

const DEFINITION_BY_KEY = new Map<string, LimitDefinition>(
	LIMIT_DEFINITIONS.map((definition) => [definition.key, definition]),
);

export function isLimitKey(value: unknown): value is LimitKey {
	return typeof value === "string" && DEFINITION_BY_KEY.has(value);
}

export function limitDefinition(key: string): LimitDefinition | undefined {
	return DEFINITION_BY_KEY.get(key);
}

export function isFeatureKey(value: unknown): value is FeatureKey {
	return limitDefinition(value as string)?.kind === "feature";
}

export const ENFORCED_LIMIT_KEYS: readonly LimitKey[] =
	LIMIT_DEFINITIONS.filter((definition) => definition.enforced).map(
		(definition) => definition.key,
	);

// ── Seed ────────────────────────────────────────────────────────────────────

const count = (
	value: number | null,
	display_label: string | null = null,
): NumericLimitCell => ({
	kind: "count",
	value,
	per_seat: false,
	display_label,
});
const quota = (
	value: number | null,
	per_seat: boolean,
	display_label: string | null = null,
): NumericLimitCell => ({ kind: "quota", value, per_seat, display_label });
const days = (value: number | null): NumericLimitCell => ({
	kind: "days",
	value,
	per_seat: false,
	display_label: null,
});
const feature = (
	enabled: boolean,
	display_label: string | null = null,
): FeatureLimitCell => ({ kind: "feature", enabled, display_label });

function deepFreeze<T extends Record<string, Record<string, object>>>(
	matrix: T,
): T {
	for (const cells of Object.values(matrix)) {
		for (const cell of Object.values(cells)) Object.freeze(cell);
		Object.freeze(cells);
	}
	return Object.freeze(matrix);
}

/** The seed. Identical to the migration; frozen so nothing edits it in place. */
export const DEFAULT_PLAN_LIMITS: Record<PlanId, PlanLimits> = deepFreeze({
	free: {
		members: count(10),
		projects: count(2),
		teams: count(2),
		roadmap_nodes_per_roadmap: count(250),
		ai_messages_monthly: quota(50, false),
		deliverables: feature(false),
		deliverable_review: feature(false),
		change_requests: feature(false),
		risks: feature(false),
		decisions: feature(false),
		custom_register_fields: feature(false),
		time_tracking: feature(false),
		private_teams_guests: feature(false),
		roles_permissions: feature(false),
		activity_retention_days: days(7),
		activity_export: feature(false),
		mcp_server: feature(false),
		saml_scim: feature(false),
	},
	pro: {
		members: count(null),
		projects: count(10),
		teams: count(3),
		roadmap_nodes_per_roadmap: count(null),
		ai_messages_monthly: quota(500, true),
		deliverables: feature(true),
		deliverable_review: feature(true),
		change_requests: feature(true),
		risks: feature(true),
		decisions: feature(true),
		custom_register_fields: feature(false),
		time_tracking: feature(true),
		private_teams_guests: feature(false),
		roles_permissions: feature(false),
		activity_retention_days: days(90),
		activity_export: feature(false),
		mcp_server: feature(true),
		saml_scim: feature(false),
	},
	business: {
		members: count(null),
		projects: count(null),
		teams: count(null),
		roadmap_nodes_per_roadmap: count(null),
		ai_messages_monthly: quota(2000, true),
		deliverables: feature(true),
		deliverable_review: feature(true),
		change_requests: feature(true),
		risks: feature(true),
		decisions: feature(true),
		custom_register_fields: feature(false),
		time_tracking: feature(true),
		private_teams_guests: feature(true),
		roles_permissions: feature(true),
		activity_retention_days: days(null),
		activity_export: feature(false),
		mcp_server: feature(true),
		saml_scim: feature(false),
	},
	enterprise: {
		members: count(null),
		projects: count(null),
		teams: count(null),
		roadmap_nodes_per_roadmap: count(null),
		ai_messages_monthly: quota(null, false, "Negotiated"),
		deliverables: feature(true),
		deliverable_review: feature(true),
		change_requests: feature(true),
		risks: feature(true),
		decisions: feature(true),
		custom_register_fields: feature(true),
		time_tracking: feature(true),
		private_teams_guests: feature(true),
		roles_permissions: feature(true, "Granular"),
		activity_retention_days: days(null),
		activity_export: feature(true),
		mcp_server: feature(true, "Higher limits"),
		saml_scim: feature(true),
	},
});

// ── Normalization ───────────────────────────────────────────────────────────

/** Matches the DB CHECK on `int_value`. */
const MAX_LIMIT_VALUE = 1_000_000_000;
/** Matches the DB CHECK on `display_label`. */
const MAX_DISPLAY_LABEL = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDisplayLabel(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed && trimmed.length <= MAX_DISPLAY_LABEL ? trimmed : null;
}

/**
 * One cell, validated against its key's definition. Anything malformed — a
 * wrong kind, a string number, a negative, a fraction, NaN — takes the whole
 * fallback cell rather than a half-merged one.
 */
export function normalizeLimitCell(
	key: LimitKey,
	raw: unknown,
	fallback: LimitCell,
): LimitCell {
	const definition = DEFINITION_BY_KEY.get(key);
	if (!definition || !isRecord(raw)) return { ...fallback };
	// A cell may omit `kind`; one that states a different kind is rejected.
	if (raw.kind !== undefined && raw.kind !== definition.kind) {
		return { ...fallback };
	}

	if (definition.kind === "feature") {
		if (typeof raw.enabled !== "boolean") return { ...fallback };
		return {
			kind: "feature",
			enabled: raw.enabled,
			display_label: normalizeDisplayLabel(raw.display_label),
		};
	}

	const value = raw.value;
	const validValue =
		value === null ||
		(typeof value === "number" &&
			Number.isInteger(value) &&
			value >= (definition.min ?? 0) &&
			value <= MAX_LIMIT_VALUE);
	if (!validValue) return { ...fallback };

	const fallbackPerSeat = fallback.kind !== "feature" && fallback.per_seat;
	return {
		kind: definition.kind,
		value: value as number | null,
		per_seat:
			definition.kind === "quota" &&
			(typeof raw.per_seat === "boolean" ? raw.per_seat : fallbackPerSeat),
		display_label: normalizeDisplayLabel(raw.display_label),
	};
}

/** One plan's cells, merged key by key onto `fallback`. Unknown keys are dropped. */
export function normalizeLimits(
	raw: unknown,
	fallback: PlanLimits,
): PlanLimits {
	const source = isRecord(raw) ? raw : {};
	const out = {} as PlanLimits;
	for (const key of LIMIT_KEYS) {
		out[key] = normalizeLimitCell(key, source[key], fallback[key]);
	}
	return out;
}

/** Every plan, each merged onto its seed. Unknown plans are dropped. */
export function normalizePlanLimits(raw: unknown): Record<PlanId, PlanLimits> {
	const source = isRecord(raw) ? raw : {};
	const out = {} as Record<PlanId, PlanLimits>;
	for (const plan of PLAN_ORDER) {
		out[plan] = normalizeLimits(source[plan], DEFAULT_PLAN_LIMITS[plan]);
	}
	return out;
}

// ── Reading cells ───────────────────────────────────────────────────────────

function pickCell(
	source: LimitCell | LimitCellMap | null | undefined,
	key: string | undefined,
): LimitCell | undefined {
	if (!source) return undefined;
	if (key === undefined) return source as LimitCell;
	return (source as LimitCellMap)[key];
}

/**
 * The numeric value of a cell; `null` means unlimited. A feature cell or a
 * missing one also reads as `null`, which is the fail-open answer: nothing the
 * web cannot read is ever treated as a cap.
 */
export function cellValue(cell: LimitCell | null | undefined): number | null;
export function cellValue(
	limits: LimitCellMap | null | undefined,
	key: string,
): number | null;
export function cellValue(
	source: LimitCell | LimitCellMap | null | undefined,
	key?: string,
): number | null {
	const cell = pickCell(source, key);
	if (!cell || cell.kind === "feature") return null;
	return typeof cell.value === "number" ? cell.value : null;
}

/**
 * Whether a cell grants something: a feature that is on, or a numeric limit
 * that is unlimited or above zero. A missing cell reads as enabled (fail open).
 */
export function isEnabled(cell: LimitCell | null | undefined): boolean;
export function isEnabled(
	limits: LimitCellMap | null | undefined,
	key: string,
): boolean;
export function isEnabled(
	source: LimitCell | LimitCellMap | null | undefined,
	key?: string,
): boolean {
	const cell = pickCell(source, key);
	if (!cell) return true;
	if (cell.kind === "feature") return cell.enabled;
	return cell.value === null || cell.value > 0;
}

export function isUnlimited(cell: LimitCell | null | undefined): boolean {
	return !!cell && cell.kind !== "feature" && cell.value === null;
}

/** "2,000". Pinned to en-US so tests and SSR-less renders agree everywhere. */
export function formatCount(n: number): string {
	return n.toLocaleString("en-US");
}

/**
 * The lowest plan above `current` that loosens `key`: a feature switched on, or
 * a numeric limit that is unlimited or — when `needed` is given — at least
 * `needed`, otherwise simply higher than today's. `null` when no plan does,
 * which the UI reads as "contact sales". Mirrors the backend's
 * `computeUpgradePlan`, and like it reads the live matrix, so an admin edit
 * changes the answer.
 */
export function nextPlanWith(
	key: LimitKey | string,
	current: PlanId,
	all: Readonly<Partial<Record<PlanId, LimitCellMap>>>,
	needed?: number,
): PlanId | null {
	const currentCell = all[current]?.[key];
	const currentValue = cellValue(currentCell);
	// Already on, or already unlimited: no plan loosens it further.
	if (currentCell?.kind === "feature" && currentCell.enabled) return null;
	if (isUnlimited(currentCell)) return null;
	for (const plan of PLAN_ORDER.slice(planRank(current) + 1)) {
		const cell = all[plan]?.[key];
		if (!cell) continue;
		if (cell.kind === "feature") {
			if (cell.enabled) return plan;
			continue;
		}
		if (cell.value === null) return plan;
		if (needed !== undefined) {
			if (cell.value >= needed) return plan;
		} else if (
			currentCell &&
			currentCell.kind !== "feature" &&
			currentValue !== null &&
			cell.value > currentValue
		) {
			return plan;
		}
	}
	return null;
}
