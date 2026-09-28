/**
 * Recognising the backend's plan-limit 403 wherever it surfaces.
 *
 * Backend shape (PlanLimitException, passed through HttpExceptionFilter):
 *   { "error": { "code": "plan_limit", "kind": "count" | "feature",
 *                "limit_key": "projects", "label": "Projects",
 *                "limit": 2, "used": 2, "plan": "free", "upgrade_plan": "pro",
 *                "workspace_id": "…", "workspace_slug": "acme",
 *                "context": "create", "message": "…", "status": 403, "path": "…" } }
 *
 * The filter nests the payload under `error`, which is why this reads
 * `body.error` FIRST — `parseMissingPermissionError` in permissionErrors.ts
 * only looks at `body` and `body.message` and so never matches that envelope.
 * Kept in its own module rather than beside it because permissionErrors pulls
 * in the component permission catalogue, and this is imported by services.
 *
 * Errors lose their shape on the way to components (services re-wrap them,
 * `RoadmapServiceError` keeps the original under `originalError`), so the
 * parser walks `.cause` and `.originalError` a few levels deep. Services that
 * want the code to survive their own wrapping use `toServiceError`.
 *
 * The notifier half is how a create blocked anywhere raises exactly one
 * upgrade prompt: the axios interceptor and the fetch-based services call
 * `notifyPlanLimit`, a bridge component registered with `setPlanLimitNotifier`
 * shows the toast, and `wasPlanLimitJustNotified` lets the toast layer drop
 * the generic "Create failed" error the component raises a moment later.
 */

import { extractApiErrorMessage } from "./permissionErrors";
import { isPlanId, limitDefinition, type PlanId } from "./planLimits";
import { planLimitToastCopy } from "./usageCopy";

export type PlanLimitContext =
	| "invite"
	| "accept"
	| "create"
	| "full_state"
	| "link"
	| "enable"
	| "write";

const CONTEXTS: ReadonlySet<string> = new Set<PlanLimitContext>([
	"invite",
	"accept",
	"create",
	"full_state",
	"link",
	"enable",
	"write",
]);

export interface PlanLimitInfo {
	limitKey: string;
	kind: "count" | "feature";
	label: string;
	/** Null for feature gates, and for an unlimited cell (never blocks). */
	limit: number | null;
	used: number | null;
	plan: PlanId;
	upgradePlan: PlanId | null;
	/** Which workspace's billing page an upgrade link should open. */
	workspaceId: string | null;
	workspaceSlug: string | null;
	context: PlanLimitContext | null;
	/** Server-written and readable by non-members; empty when it sent none. */
	message: string;
}

export class PlanLimitError extends Error {
	readonly code = "plan_limit" as const;
	readonly status = 403;
	readonly info: PlanLimitInfo;

	constructor(info: PlanLimitInfo, options?: { cause?: unknown }) {
		super(info.message || planLimitToastCopy(info, null).message, options);
		this.name = "PlanLimitError";
		this.info = info;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | null =>
	typeof value === "string" && value ? value : null;

const num = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

function toInfo(payload: Record<string, unknown>): PlanLimitInfo | null {
	const limitKey = str(payload.limit_key);
	if (!limitKey) return null;
	const definition = limitDefinition(limitKey);
	const kind =
		payload.kind === "count" || payload.kind === "feature"
			? payload.kind
			: definition?.kind === "feature"
				? "feature"
				: "count";
	return {
		limitKey,
		kind,
		label: str(payload.label) ?? definition?.label ?? limitKey,
		limit: num(payload.limit),
		used: num(payload.used),
		plan: isPlanId(payload.plan) ? payload.plan : "free",
		upgradePlan: isPlanId(payload.upgrade_plan) ? payload.upgrade_plan : null,
		workspaceId: str(payload.workspace_id),
		workspaceSlug: str(payload.workspace_slug),
		context:
			typeof payload.context === "string" && CONTEXTS.has(payload.context)
				? (payload.context as PlanLimitContext)
				: null,
		message: str(payload.message) ?? "",
	};
}

function safeParseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

/**
 * Read a response body. Checks, in order, `body.error` (the filter's
 * envelope), `body.message` as an object (a raw NestJS HttpException), then
 * the body itself. A status other than 403 is never a plan limit.
 */
export function parsePlanLimitBody(
	body: unknown,
	status?: number | null,
): PlanLimitInfo | null {
	if (typeof status === "number" && status !== 403) return null;
	const parsed = typeof body === "string" ? safeParseJson(body) : body;
	if (!isRecord(parsed)) return null;
	const candidates = [parsed.error, parsed.message, parsed];
	for (const candidate of candidates) {
		if (isRecord(candidate) && candidate.code === "plan_limit") {
			return toInfo(candidate);
		}
	}
	return null;
}

const MAX_DEPTH = 4;

/**
 * Pull plan-limit info out of an error of unknown shape: a `PlanLimitError`,
 * an axios-like `{ response: { status, data } }`, or either of those wrapped
 * under `.cause` / `.originalError` up to four levels down.
 */
export function parsePlanLimitError(err: unknown): PlanLimitInfo | null {
	return walk(err, 0);
}

function walk(err: unknown, depth: number): PlanLimitInfo | null {
	if (depth > MAX_DEPTH || !isRecord(err)) return null;
	if (err instanceof PlanLimitError) return err.info;

	const response = err.response;
	if (isRecord(response)) {
		const info = parsePlanLimitBody(
			response.data,
			typeof response.status === "number" ? response.status : null,
		);
		if (info) return info;
	}

	return walk(err.cause, depth + 1) ?? walk(err.originalError, depth + 1);
}

export function isPlanLimitError(err: unknown): boolean {
	return parsePlanLimitError(err) !== null;
}

/**
 * What a service should throw from its catch block. A plan limit comes back as
 * a `PlanLimitError` so the code survives to the component; anything else is
 * the server's readable message (or `fallback`) with the original as `cause`.
 */
export function toServiceError(err: unknown, fallback: string): Error {
	if (err instanceof PlanLimitError) return err;
	const info = parsePlanLimitError(err);
	if (info) return new PlanLimitError(info, { cause: err });
	const data = isRecord(err)
		? (err as { response?: { data?: unknown } }).response?.data
		: undefined;
	return new Error(extractApiErrorMessage(data, fallback), { cause: err });
}

// ── Notifier ────────────────────────────────────────────────────────────────

type PlanLimitNotifier = (info: PlanLimitInfo) => void;

/** One prompt per workspace + limit within this window. */
const DEDUPE_MS = 4000;

let notifier: PlanLimitNotifier | null = null;
let lastNotifiedAt: number | null = null;
const lastShownAt = new Map<string, number>();

/** The bridge registers on mount and passes `null` on unmount. */
export function setPlanLimitNotifier(fn: PlanLimitNotifier | null): void {
	notifier = fn;
}

/**
 * Raise the upgrade prompt for a blocked write. A repeat for the same
 * workspace and limit inside four seconds is swallowed — a batch of invites
 * fails once per row — but still stamps `lastNotifiedAt`, so each repeat's
 * generic error toast is suppressed too. Nothing is stamped while no notifier
 * is registered: with no prompt on screen, the error toast is all there is.
 */
export function notifyPlanLimit(info: PlanLimitInfo, now = Date.now()): void {
	if (!notifier) return;
	lastNotifiedAt = now;
	const key = `${info.workspaceId ?? ""}:${info.limitKey}`;
	const previous = lastShownAt.get(key);
	if (
		previous !== undefined &&
		now - previous >= 0 &&
		now - previous < DEDUPE_MS
	) {
		return;
	}
	for (const [staleKey, at] of lastShownAt) {
		if (now - at >= DEDUPE_MS) lastShownAt.delete(staleKey);
	}
	lastShownAt.set(key, now);
	try {
		notifier(info);
	} catch (error) {
		console.error("Plan limit notifier failed:", error);
	}
}

/** True within `windowMs` of the last plan-limit notification. */
export function wasPlanLimitJustNotified(
	now = Date.now(),
	windowMs = 1500,
): boolean {
	if (lastNotifiedAt === null) return false;
	const elapsed = now - lastNotifiedAt;
	return elapsed >= 0 && elapsed < windowMs;
}

/** Tests only: forget every stamp and the registered notifier. */
export function resetPlanLimitNotifications(): void {
	notifier = null;
	lastNotifiedAt = null;
	lastShownAt.clear();
}
