/**
 * A workspace's plan, limits and usage, read for the UI.
 *
 * The server is the authority on every limit: it re-checks each write and
 * answers a blocked one with a `plan_limit` 403. What this module computes is
 * only ever used to warn early — a meter, a disabled button, a note — so every
 * question it cannot answer (usage still loading, the endpoint down, a key it
 * does not know) FAILS OPEN. Blocking a create the server would have allowed
 * is the one mistake this layer must never make.
 */

import {
	type CountKey,
	cellValue,
	DEFAULT_PLAN_LIMITS,
	type FeatureKey,
	isEnabled,
	isPlanId,
	type LimitCell,
	limitDefinition,
	normalizeLimits,
	type PlanId,
	type PlanSource,
	planLabel,
} from "./planLimits";

// ── The usage payload (GET /api/workspaces/:id/usage) ───────────────────────

export interface RoadmapNodeUsage {
	roadmap_id: string;
	/** Null unless the viewer can open the roadmap — membership is not access. */
	name: string | null;
	project_id: string | null;
	project_title: string | null;
	nodes: number;
}

export interface WorkspaceUsageFeature {
	key: string;
	label: string;
	group: string;
	enabled: boolean;
	enforced: boolean;
	available_on: PlanId | null;
}

export interface WorkspaceUsage {
	workspace_id: string;
	plan: {
		effective: PlanId;
		source: PlanSource;
		complimentary: {
			plan: Exclude<PlanId, "free">;
			since: string | null;
			until: string | null;
		} | null;
	};
	/** Only sent to owners and admins; null for everyone else. */
	subscription: { plan: PlanId; status: string | null } | null;
	/** The effective plan's cells. */
	limits: Record<string, LimitCell>;
	usage: {
		members: number;
		pending_invites: number;
		projects: number;
		teams: number;
	};
	/** The server always sends `true`: pending invites hold a member spot. */
	counts_pending_invites: boolean;
	roadmaps: {
		largest: RoadmapNodeUsage | null;
		near_limit: RoadmapNodeUsage[];
	};
	features: WorkspaceUsageFeature[];
	retention_days: number | null;
	upgrade_plan: PlanId | null;
	generated_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | null =>
	typeof value === "string" && value ? value : null;

const toCount = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: 0;

const planOrNull = (value: unknown): PlanId | null =>
	isPlanId(value) ? value : null;

function normalizeRoadmap(raw: unknown): RoadmapNodeUsage | null {
	if (!isRecord(raw)) return null;
	const roadmapId = str(raw.roadmap_id);
	if (!roadmapId) return null;
	return {
		roadmap_id: roadmapId,
		name: str(raw.name),
		project_id: str(raw.project_id),
		project_title: str(raw.project_title),
		nodes: toCount(raw.nodes),
	};
}

/**
 * Validate a usage payload field by field. Malformed pieces fall back to
 * something harmless (the effective plan's seed cells, zero counts), and a
 * body with no `usage` object at all is rejected so the caller reports the
 * endpoint as unavailable rather than rendering invented zeros.
 */
export function normalizeWorkspaceUsage(
	raw: unknown,
	workspaceId: string,
): WorkspaceUsage {
	if (!isRecord(raw) || !isRecord(raw.usage)) {
		throw new Error("Workspace usage response was malformed.");
	}
	const plan = isRecord(raw.plan) ? raw.plan : {};
	const effective = planOrNull(plan.effective) ?? "free";
	const source: PlanSource =
		plan.source === "complimentary" || plan.source === "subscription"
			? plan.source
			: "default";
	const comp = isRecord(plan.complimentary) ? plan.complimentary : null;
	const compPlan = comp ? planOrNull(comp.plan) : null;
	const subscription = isRecord(raw.subscription) ? raw.subscription : null;
	const subscriptionPlan = subscription ? planOrNull(subscription.plan) : null;
	const limits = normalizeLimits(raw.limits, DEFAULT_PLAN_LIMITS[effective]);
	const roadmaps = isRecord(raw.roadmaps) ? raw.roadmaps : {};

	const features: WorkspaceUsageFeature[] = [];
	if (Array.isArray(raw.features)) {
		for (const item of raw.features) {
			if (!isRecord(item)) continue;
			const key = str(item.key);
			if (!key) continue;
			const definition = limitDefinition(key);
			features.push({
				key,
				label: str(item.label) ?? definition?.label ?? key,
				group: str(item.group) ?? definition?.group ?? "platform",
				enabled:
					typeof item.enabled === "boolean"
						? item.enabled
						: isEnabled(limits, key),
				enforced:
					typeof item.enforced === "boolean"
						? item.enforced
						: (definition?.enforced ?? false),
				available_on: planOrNull(item.available_on),
			});
		}
	}

	const retention = raw.retention_days;
	return {
		workspace_id: str(raw.workspace_id) ?? workspaceId,
		plan: {
			effective,
			source,
			complimentary:
				comp && compPlan && compPlan !== "free"
					? {
							plan: compPlan,
							since: str(comp.since),
							until: str(comp.until),
						}
					: null,
		},
		subscription: subscriptionPlan
			? {
					plan: subscriptionPlan,
					status: str(subscription?.status),
				}
			: null,
		limits,
		usage: {
			members: toCount(raw.usage.members),
			pending_invites: toCount(raw.usage.pending_invites),
			projects: toCount(raw.usage.projects),
			teams: toCount(raw.usage.teams),
		},
		counts_pending_invites: raw.counts_pending_invites !== false,
		roadmaps: {
			largest: normalizeRoadmap(roadmaps.largest),
			near_limit: Array.isArray(roadmaps.near_limit)
				? roadmaps.near_limit
						.map(normalizeRoadmap)
						.filter((item): item is RoadmapNodeUsage => item !== null)
				: [],
		},
		features,
		retention_days:
			retention === null
				? null
				: typeof retention === "number" &&
						Number.isInteger(retention) &&
						retention >= 1
					? retention
					: cellValue(limits, "activity_retention_days"),
		upgrade_plan: planOrNull(raw.upgrade_plan),
		generated_at: str(raw.generated_at) ?? "",
	};
}

// ── Meters ──────────────────────────────────────────────────────────────────

/**
 * `warning` from 80%; `limit` exactly at it; `over` past it, which happens
 * when a workspace was grandfathered in above a limit (a downgrade, or an
 * admin tightening the matrix) — it keeps everything and cannot grow.
 */
export type MeterTone = "ok" | "warning" | "limit" | "over" | "unlimited";

export interface MeterState {
	used: number;
	/** Null = unlimited. */
	limit: number | null;
	/** 0–100, clamped. 0 when unlimited. */
	percent: number;
	/** Null when unlimited; never negative. */
	remaining: number | null;
	overBy: number;
	tone: MeterTone;
}

const WARNING_RATIO = 0.8;

export function computeMeter(used: number, limit: number | null): MeterState {
	const safeUsed = Number.isFinite(used) && used > 0 ? used : 0;
	if (limit === null || !Number.isFinite(limit)) {
		return {
			used: safeUsed,
			limit: null,
			percent: 0,
			remaining: null,
			overBy: 0,
			tone: "unlimited",
		};
	}
	const safeLimit = Math.max(0, limit);
	const remaining = Math.max(0, safeLimit - safeUsed);
	const overBy = Math.max(0, safeUsed - safeLimit);
	// A zero limit is "at the limit" even with nothing used: nothing can be added.
	const ratio = safeLimit === 0 ? 1 : safeUsed / safeLimit;
	const tone: MeterTone =
		overBy > 0
			? "over"
			: safeUsed >= safeLimit
				? "limit"
				: ratio >= WARNING_RATIO
					? "warning"
					: "ok";
	return {
		used: safeUsed,
		limit: safeLimit,
		percent: Math.min(100, Math.round(ratio * 100)),
		remaining,
		overBy,
		tone,
	};
}

// ── Entitlements ────────────────────────────────────────────────────────────

/**
 * How much of a count is spent. Members include pending invites when the
 * server says they count — an invite holds its spot until it is answered.
 */
export function usedFor(usage: WorkspaceUsage, key: CountKey): number {
	const counts = usage.usage;
	if (key === "members") {
		return (
			counts.members +
			(usage.counts_pending_invites ? counts.pending_invites : 0)
		);
	}
	return counts[key];
}

export type EntitlementsStatus = "loading" | "ready" | "unavailable";

export interface WorkspaceEntitlements {
	status: EntitlementsStatus;
	usage: WorkspaceUsage | null;
	plan: PlanId | null;
	planName: string | null;
	planSource: PlanSource | null;
	isComplimentary: boolean;
	limits: Record<string, LimitCell> | null;
	upgradePlan: PlanId | null;
	/** Null until usage is known. */
	usedFor(key: CountKey): number | null;
	/** Null until usage is known. */
	meter(key: CountKey): MeterState | null;
	/** Null when unlimited or not yet known. */
	remaining(key: CountKey): number | null;
	/** Fails open: true whenever usage is unknown. */
	canCreate(key: CountKey, count?: number): boolean;
	/** Fails open: true whenever usage is unknown. */
	hasFeature(key: FeatureKey | string): boolean;
}

export function buildEntitlements(
	usage: WorkspaceUsage | null | undefined,
	status: EntitlementsStatus,
): WorkspaceEntitlements {
	const known = usage ?? null;
	const resolvedStatus: EntitlementsStatus = known
		? status === "loading"
			? "ready"
			: status
		: status === "ready"
			? "unavailable"
			: status;
	// Only a ready payload drives a decision; anything else fails open.
	const ready = resolvedStatus === "ready" ? known : null;

	const meter = (key: CountKey): MeterState | null =>
		ready
			? computeMeter(usedFor(ready, key), cellValue(ready.limits, key))
			: null;

	return {
		status: resolvedStatus,
		usage: known,
		plan: known?.plan.effective ?? null,
		planName: known ? planLabel(known.plan.effective) : null,
		planSource: known?.plan.source ?? null,
		isComplimentary: known?.plan.source === "complimentary",
		limits: known?.limits ?? null,
		upgradePlan: known?.upgrade_plan ?? null,
		usedFor: (key) => (ready ? usedFor(ready, key) : null),
		meter,
		remaining: (key) => meter(key)?.remaining ?? null,
		canCreate: (key, count = 1) => {
			if (!ready || count <= 0) return true;
			const limit = cellValue(ready.limits, key);
			if (limit === null) return true;
			return usedFor(ready, key) + count <= limit;
		},
		hasFeature: (key) => (ready ? isEnabled(ready.limits, key) : true),
	};
}
