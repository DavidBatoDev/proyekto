/**
 * Pure helpers behind the staff pages for plan limits and complimentary plans
 * (/admin/plans, /admin/workspaces).
 *
 * The limits editor keeps a draft of OVERRIDES only — the cells an admin has
 * touched — never a full copy of the matrix. Everything is diffed against the
 * latest server matrix, so reloading after a stale save keeps the admin's own
 * edits without silently reverting cells someone else changed meanwhile.
 *
 * API shapes mirror `GET/PUT /api/admin/plan-limits` (see
 * backend/src/modules/shared/entitlements/services/entitlements-admin.service.ts).
 */

import {
	DEFAULT_PLAN_LIMITS,
	formatCount,
	isPlanId,
	type LimitCell,
	type LimitKind,
	limitDefinition,
	PLAN_ORDER,
	type PlanId,
	planLabel,
} from "./planLimits";

// ── API shapes ──────────────────────────────────────────────────────────────

/** A stored cell as the editor sees it: the value plus who last changed it. */
export type AdminLimitCell = LimitCell & {
	/** Null only for a cell the database is missing (drift). */
	updated_at: string | null;
	updated_by: string | null;
};

export interface AdminLimitKeyMeta {
	key: string;
	kind: LimitKind;
	label: string;
	unit: string | null;
	group: string;
	sort_order: number;
	description: string | null;
	/** Enforced by the backend today; the rest are published on /pricing only. */
	enforced: boolean;
	/** The floor the API accepts for a numeric cell (members: 1). */
	min?: number | null;
}

export interface AdminPlanLimits {
	plans: PlanId[];
	keys: AdminLimitKeyMeta[];
	cells: Record<PlanId, Record<string, AdminLimitCell>>;
	/** Newest `updated_at` across the matrix; sent back as `base_version`. */
	version: string | null;
	drift: { missing_in_db: string[]; unknown_to_code: string[] };
}

/** One cell edit. Numeric kinds send `value` (null = unlimited), features `enabled`. */
export interface PlanLimitChange {
	plan: PlanId;
	key: string;
	value?: number | null;
	enabled?: boolean;
	per_seat?: boolean;
	display_label?: string | null;
}

export interface UpdatePlanLimitsInput {
	changes: PlanLimitChange[];
	note?: string;
	base_version: string | null;
}

/** What the editor has changed, by plan then key. Untouched cells are absent. */
export type PlanLimitsDraft = Partial<
	Record<PlanId, Record<string, LimitCell>>
>;

/** A plan → key → cell map; admin cells qualify, their extra fields are ignored. */
export type LimitCellsByPlan = Readonly<
	Partial<Record<PlanId, Readonly<Partial<Record<string, LimitCell>>>>>
>;

/** Matches the DB CHECK on `plan_limits.int_value`. */
export const MAX_LIMIT_VALUE = 1_000_000_000;
/** Matches the DB CHECK on `plan_limits.display_label`. */
export const MAX_DISPLAY_LABEL = 40;
/** Matches the admin DTOs' note length. */
export const MAX_ADMIN_NOTE = 1000;
/** The 409 code a save gets when someone else saved after the editor loaded. */
export const PLAN_LIMITS_STALE = "plan_limits_stale";

// ── Cells ───────────────────────────────────────────────────────────────────

/** Blank and whitespace-only labels mean "no label", as the API reads them. */
export function normalizeDisplayLabel(
	label: string | null | undefined,
): string | null {
	const trimmed = typeof label === "string" ? label.trim() : "";
	return trimmed ? trimmed : null;
}

/** Equal as far as the editable fields go (meta like `updated_at` is ignored). */
export function sameCell(
	a: LimitCell | null | undefined,
	b: LimitCell | null | undefined,
): boolean {
	if (!a || !b) return a === b;
	if (a.kind !== b.kind) return false;
	if (
		normalizeDisplayLabel(a.display_label) !==
		normalizeDisplayLabel(b.display_label)
	) {
		return false;
	}
	if (a.kind === "feature" || b.kind === "feature") {
		return (
			a.kind === "feature" && b.kind === "feature" && a.enabled === b.enabled
		);
	}
	// NaN (a cleared input) never equals anything, so it always reads as dirty.
	return a.value === b.value && a.per_seat === b.per_seat;
}

/** Only the editable fields, so a draft never carries server metadata. */
function editableCell(cell: LimitCell): LimitCell {
	return cell.kind === "feature"
		? {
				kind: "feature",
				enabled: cell.enabled,
				display_label: cell.display_label,
			}
		: {
				kind: cell.kind,
				value: cell.value,
				per_seat: cell.per_seat,
				display_label: cell.display_label,
			};
}

/** The cell the editor shows: the admin's override, else the stored one. */
export function draftCell(
	draft: PlanLimitsDraft,
	server: LimitCellsByPlan,
	plan: PlanId,
	key: string,
): LimitCell | undefined {
	return draft[plan]?.[key] ?? server[plan]?.[key];
}

/**
 * Record an edit. Setting a cell back to its stored value drops the override,
 * so the unsaved count only ever counts real differences.
 */
export function withDraftCell(
	draft: PlanLimitsDraft,
	server: LimitCellsByPlan,
	plan: PlanId,
	key: string,
	cell: LimitCell,
): PlanLimitsDraft {
	const planDraft = { ...(draft[plan] ?? {}) };
	if (sameCell(cell, server[plan]?.[key])) delete planDraft[key];
	else planDraft[key] = editableCell(cell);
	const next: PlanLimitsDraft = { ...draft };
	if (Object.keys(planDraft).length === 0) delete next[plan];
	else next[plan] = planDraft;
	return next;
}

/**
 * The PUT body's `changes`: one entry per cell that differs from the server,
 * carrying that cell's full editable state. Plans in PLAN_ORDER, keys in the
 * order they were edited.
 */
export function dirtyChanges(
	draft: PlanLimitsDraft,
	server: LimitCellsByPlan,
): PlanLimitChange[] {
	const changes: PlanLimitChange[] = [];
	for (const plan of PLAN_ORDER) {
		for (const [key, cell] of Object.entries(draft[plan] ?? {})) {
			if (sameCell(cell, server[plan]?.[key])) continue;
			const display_label = normalizeDisplayLabel(cell.display_label);
			if (cell.kind === "feature") {
				changes.push({ plan, key, enabled: cell.enabled, display_label });
			} else if (cell.kind === "quota") {
				changes.push({
					plan,
					key,
					value: cell.value,
					per_seat: cell.per_seat,
					display_label,
				});
			} else {
				changes.push({ plan, key, value: cell.value, display_label });
			}
		}
	}
	return changes;
}

/**
 * The lowest value a numeric cell may hold: the server's floor, else the
 * catalogue's, never below 1 for days or members (an owner has to fit).
 */
export function minimumFor(
	key: string,
	kind: LimitKind,
	serverMin?: number | null,
): number {
	const base =
		typeof serverMin === "number"
			? serverMin
			: (limitDefinition(key)?.min ?? 0);
	const floor = kind === "days" || key === "members" ? 1 : 0;
	return Math.max(base, floor);
}

/** A readable problem with one cell, or null when the API would accept it. */
export function validateCell(cell: LimitCell, min = 0): string | null {
	const label = cell.display_label ?? "";
	if (label.trim().length > MAX_DISPLAY_LABEL) {
		return `Labels are ${MAX_DISPLAY_LABEL} characters at most.`;
	}
	if (cell.kind === "feature" || cell.value === null) return null;
	if (!Number.isFinite(cell.value) || !Number.isInteger(cell.value)) {
		return "Enter a whole number, or tick Unlimited.";
	}
	if (cell.value < min) {
		return cell.kind === "days"
			? `At least ${min} ${min === 1 ? "day" : "days"}, or Unlimited.`
			: `At least ${formatCount(min)}, or Unlimited.`;
	}
	if (cell.value > MAX_LIMIT_VALUE) {
		return `At most ${formatCount(MAX_LIMIT_VALUE)}.`;
	}
	return null;
}

/**
 * The value to restore when "Unlimited" is unticked: the stored number, else
 * the seed's, else the floor (at least 1, so a count never starts at zero).
 */
export function limitedFallback(
	plan: PlanId,
	key: string,
	serverCell: LimitCell | null | undefined,
	min: number,
): number {
	if (
		serverCell &&
		serverCell.kind !== "feature" &&
		typeof serverCell.value === "number"
	) {
		return serverCell.value;
	}
	const seed = (DEFAULT_PLAN_LIMITS[plan] as Record<string, LimitCell>)[key];
	if (seed && seed.kind !== "feature" && typeof seed.value === "number") {
		return seed.value;
	}
	return Math.max(min, 1);
}

// ── Review ──────────────────────────────────────────────────────────────────

/** "Unlimited", "2,000 / seat", "On", with a pricing label in quotes. */
export function describeCell(cell: LimitCell | null | undefined): string {
	if (!cell) return "Not set";
	let base: string;
	if (cell.kind === "feature") {
		base = cell.enabled ? "On" : "Off";
	} else if (cell.value === null) {
		base = "Unlimited";
	} else {
		base = Number.isFinite(cell.value) ? formatCount(cell.value) : "Invalid";
		if (cell.kind === "days") base += cell.value === 1 ? " day" : " days";
	}
	if (cell.kind === "quota" && cell.per_seat) base += " / seat";
	const label = normalizeDisplayLabel(cell.display_label);
	return label ? `${base} ("${label}")` : base;
}

/** True when `after` grants less than `before`: a lower cap, or a feature off. */
export function isTighter(
	before: LimitCell | null | undefined,
	after: LimitCell | null | undefined,
): boolean {
	if (!before || !after || before.kind !== after.kind) return false;
	if (before.kind === "feature" || after.kind === "feature") {
		return (
			before.kind === "feature" &&
			after.kind === "feature" &&
			before.enabled &&
			!after.enabled
		);
	}
	if (after.value === null) return false;
	return before.value === null || after.value < before.value;
}

interface KeyLabel {
	key: string;
	label: string;
	enforced?: boolean;
}

export interface PlanLimitDiffLine {
	plan: PlanId;
	key: string;
	label: string;
	before: string;
	after: string;
	/** "Free · Projects: 2 → 3". */
	text: string;
	tightened: boolean;
	enforced: boolean;
}

/** One line per changed cell, in the same order as `dirtyChanges`. */
export function diffPlanLimits(
	server: LimitCellsByPlan,
	draft: PlanLimitsDraft,
	keys: readonly KeyLabel[] = [],
): PlanLimitDiffLine[] {
	const metaByKey = new Map(keys.map((meta) => [meta.key, meta]));
	const lines: PlanLimitDiffLine[] = [];
	for (const plan of PLAN_ORDER) {
		for (const [key, after] of Object.entries(draft[plan] ?? {})) {
			const beforeCell = server[plan]?.[key];
			if (sameCell(after, beforeCell)) continue;
			const meta = metaByKey.get(key);
			const label = meta?.label ?? limitDefinition(key)?.label ?? key;
			const before = describeCell(beforeCell);
			const afterText = describeCell(after);
			lines.push({
				plan,
				key,
				label,
				before,
				after: afterText,
				text: `${planLabel(plan)} · ${label}: ${before} → ${afterText}`,
				tightened: isTighter(beforeCell, after),
				enforced: meta?.enforced ?? limitDefinition(key)?.enforced ?? false,
			});
		}
	}
	return lines;
}

/**
 * A cheaper plan more generous than the next plan up — warned, never blocked,
 * because staff may mean it. Same wording and rule as the backend's save
 * warnings. Pass `onlyKeys` to check just the keys being changed.
 */
export function findTierInversions(
	cells: LimitCellsByPlan,
	keys: readonly KeyLabel[],
	onlyKeys?: readonly string[],
): string[] {
	const wanted = onlyKeys ? new Set(onlyKeys) : null;
	const warnings: string[] = [];
	for (const { key, label } of keys) {
		if (wanted && !wanted.has(key)) continue;
		for (let i = 0; i < PLAN_ORDER.length - 1; i += 1) {
			const lower = PLAN_ORDER[i];
			const higher = PLAN_ORDER[i + 1];
			const a = cells[lower]?.[key];
			const b = cells[higher]?.[key];
			if (!a || !b) continue;
			let inverted = false;
			if (a.kind === "feature" && b.kind === "feature") {
				inverted = a.enabled && !b.enabled;
			} else if (a.kind !== "feature" && b.kind !== "feature") {
				// A per-workspace quota and a per-seat one are not comparable.
				if (a.per_seat !== b.per_seat) continue;
				const av = a.value ?? Number.POSITIVE_INFINITY;
				const bv = b.value ?? Number.POSITIVE_INFINITY;
				inverted = av > bv;
			}
			if (inverted) {
				warnings.push(
					`${planLabel(lower)} is more generous than ${planLabel(higher)} for ${label}.`,
				);
			}
		}
	}
	return warnings;
}

/** The server matrix with the draft laid over it, for inversion checks. */
export function mergeDraft(
	server: LimitCellsByPlan,
	draft: PlanLimitsDraft,
): Partial<Record<PlanId, Record<string, LimitCell>>> {
	const out: Partial<Record<PlanId, Record<string, LimitCell>>> = {};
	for (const plan of PLAN_ORDER) {
		out[plan] = {
			...(server[plan] as Record<string, LimitCell> | undefined),
			...draft[plan],
		};
	}
	return out;
}

// ── Errors ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codeFromBody(body: unknown): string | null {
	if (!isRecord(body)) return null;
	for (const candidate of [body.error, body.message, body]) {
		if (isRecord(candidate) && typeof candidate.code === "string") {
			return candidate.code;
		}
	}
	return null;
}

/**
 * The machine code on an admin API failure: a service error's own `code`, an
 * axios response body's `error.code`, or either under `.cause`.
 */
export function readAdminErrorCode(err: unknown, depth = 0): string | null {
	if (depth > 4 || !isRecord(err)) return null;
	if (isRecord(err.response)) {
		const code = codeFromBody(err.response.data);
		if (code) return code;
	}
	// Axios stamps its own transport codes ("ERR_BAD_REQUEST") on `code`.
	if (typeof err.code === "string" && !err.code.startsWith("ERR_")) {
		return err.code;
	}
	return readAdminErrorCode(err.cause, depth + 1);
}

export function isPlanLimitsStaleError(err: unknown): boolean {
	return readAdminErrorCode(err) === PLAN_LIMITS_STALE;
}

// ── Complimentary plans ─────────────────────────────────────────────────────

export type CompPlan = Exclude<PlanId, "free">;
export const COMP_PLANS: readonly CompPlan[] = [
	"pro",
	"business",
	"enterprise",
];

/** Subscription statuses that still grant the paid plan (SQL `workspace_plan_state`). */
const PAYING_STATUSES = new Set(["active", "trialing", "past_due"]);

/** The plan a workspace falls back to when its comp is removed. */
export function compFallbackPlan(subscription: {
	plan: string;
	status: string | null;
}): PlanId {
	return subscription.status &&
		PAYING_STATUSES.has(subscription.status) &&
		isPlanId(subscription.plan)
		? subscription.plan
		: "free";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A local calendar date as the `<input type="date">` value, "2026-12-31". */
export function toDateInputValue(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** An ISO timestamp as a date-input value in the viewer's zone; "" for none. */
export function isoToDateInput(iso: string | null | undefined): string {
	if (!iso) return "";
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "" : toDateInputValue(date);
}

/**
 * A date-input value as the comp's `until`: the END of that local day, so a
 * comp "until Dec 31" still holds on Dec 31. "" means no end date (null).
 */
export function compUntilToIso(value: string): string | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
	if (!match) return null;
	const [, y, m, d] = match;
	const end = new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 59, 999);
	return Number.isNaN(end.getTime()) ? null : end.toISOString();
}

/** Readable copy for the warnings a comp save returns. */
export function compWarningCopy(code: string): string {
	if (code === "workspace_has_live_subscription") {
		return "This workspace also has a live paid subscription. Comping doesn't cancel it: they keep being billed until an owner cancels.";
	}
	return code;
}
