import type {
	ChangeRequest,
	ChangeRequestStatus,
} from "@/services/delivery.service";

/**
 * Optimistic cache updates for change requests.
 *
 * Pure `ChangeRequest → ChangeRequest` functions with no React and no query
 * client, so the rules are unit-testable on their own — the same split as
 * `deliverableCache.ts`.
 *
 * The status machine encoded here MUST stay in step with the backend's
 * `change-requests.service.ts` (its `OPEN_STATUSES` and per-verb guards) and,
 * below that, the CHECK constraints in
 * `20260816101000_project_change_requests.sql` which force a decision stamp on
 * the three decided states and an `applied_change_id` on `applied`. Patching a
 * status the server would refuse makes the row flicker to a wrong value and then
 * snap back, which reads as a bug even though the write correctly failed.
 */

/** Matches the `temp-` convention used across the app's optimistic paths. */
const TEMP_PREFIX = "temp-";

export function isOptimisticId(id: string): boolean {
	return id.startsWith(TEMP_PREFIX);
}

function tempId(): string {
	return `${TEMP_PREFIX}cr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Statuses a request can still be edited, submitted, or re-linked from.
 * Mirrors backend `OPEN_STATUSES`.
 */
export const OPEN_STATUSES: readonly ChangeRequestStatus[] = [
	"draft",
	"changes_requested",
];

export function isOpen(request: ChangeRequest): boolean {
	return OPEN_STATUSES.includes(request.status);
}

/** Only a submitted request can be decided. Mirrors backend `decide`. */
export function canDecide(request: ChangeRequest): boolean {
	return request.status === "submitted";
}

/** Approval unlocks recording the roadmap commit. Mirrors backend `markApplied`. */
export function canMarkApplied(request: ChangeRequest): boolean {
	return request.status === "approved";
}

export function canWithdraw(request: ChangeRequest): boolean {
	return request.status !== "applied" && request.status !== "withdrawn";
}

// ─── List membership ────────────────────────────────────────────────────────

/** Replace by id, or prepend when it's new — the list is newest-first. */
export function upsertChangeRequest(
	list: ChangeRequest[],
	request: ChangeRequest,
): ChangeRequest[] {
	const index = list.findIndex((r) => r.id === request.id);
	if (index === -1) return [request, ...list];
	return list.map((r) => (r.id === request.id ? request : r));
}

/** Also used to swap a `temp-` row for the real one the server returned. */
export function replaceChangeRequest(
	list: ChangeRequest[],
	previousId: string,
	request: ChangeRequest,
): ChangeRequest[] {
	const index = list.findIndex((r) => r.id === previousId);
	if (index === -1) return upsertChangeRequest(list, request);
	return list.map((r) => (r.id === previousId ? request : r));
}

export function removeChangeRequest(
	list: ChangeRequest[],
	id: string,
): ChangeRequest[] {
	return list.filter((r) => r.id !== id);
}

// ─── Status patches ─────────────────────────────────────────────────────────

const stamp = () => new Date().toISOString();

export function withSubmitted(request: ChangeRequest): ChangeRequest {
	return { ...request, status: "submitted", updated_at: stamp() };
}

export function withWithdrawn(request: ChangeRequest): ChangeRequest {
	return { ...request, status: "withdrawn", updated_at: stamp() };
}

/**
 * The decision stamp is written alongside the status, not left for the server.
 *
 * The DB CHECK requires `decided_by` and `decided_at` on all three decided
 * states, so a patch that moved only `status` would render a decided card with
 * no attribution for one round trip — visibly different from the row that
 * arrives a moment later.
 */
export function withDecision(
	request: ChangeRequest,
	decision: "approved" | "rejected" | "changes_requested",
	note: string | undefined,
	deciderId: string | null,
): ChangeRequest {
	return {
		...request,
		status: decision,
		decided_by: deciderId,
		decided_at: stamp(),
		decision_note: note ?? null,
		updated_at: stamp(),
	};
}

/**
 * Applied is deliberately NOT patched optimistically beyond the stamps the
 * caller already has: `applied_change` embeds commit metadata (operation counts)
 * that only the server can supply, so it is left absent until the response
 * lands rather than faked with zeroes.
 */
export function withApplied(
	request: ChangeRequest,
	appliedChangeId: string,
	actorId: string | null,
): ChangeRequest {
	return {
		...request,
		status: "applied",
		applied_change_id: appliedChangeId,
		applied_by: actorId,
		applied_at: stamp(),
		updated_at: stamp(),
	};
}

export function withLinkRemoved(
	request: ChangeRequest,
	linkId: string,
): ChangeRequest {
	return {
		...request,
		links: (request.links ?? []).filter((link) => link.id !== linkId),
		updated_at: stamp(),
	};
}

/**
 * The row rendered between clicking Raise and the server replying.
 *
 * `reference` is 0 because the human number is allocated server-side from
 * `max(reference) + 1`; the UI renders 0 as an em dash rather than inventing
 * "CR-001" and then correcting it to CR-014 a moment later.
 */
export function optimisticChangeRequest(
	projectId: string,
	body: {
		title: string;
		description?: string;
		impact_scope?: string;
		impact_timeline_days?: number;
		target_date_before?: string;
		target_date_after?: string;
		roadmap_id?: string;
		submit?: boolean;
	},
	requesterId: string | null,
): ChangeRequest {
	const now = stamp();
	return {
		id: tempId(),
		project_id: projectId,
		roadmap_id: body.roadmap_id ?? null,
		reference: 0,
		title: body.title,
		description: body.description ?? null,
		requested_by: requesterId,
		impact_scope: body.impact_scope ?? null,
		impact_timeline_days: body.impact_timeline_days ?? null,
		target_date_before: body.target_date_before ?? null,
		target_date_after: body.target_date_after ?? null,
		status: body.submit ? "submitted" : "draft",
		decided_by: null,
		decided_at: null,
		decision_note: null,
		applied_change_id: null,
		applied_by: null,
		applied_at: null,
		created_at: now,
		updated_at: now,
		links: [],
		applied_change: null,
	};
}
