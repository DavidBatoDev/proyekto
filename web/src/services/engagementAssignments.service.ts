/**
 * The engagement-assignment API: who works on which project under which
 * agreement (`engagement_assignments`, backend
 * `marketplace/engagements/engagement-assignments.service.ts`).
 *
 * - `GET /api/engagements/:id/assignments`: every assignment under the
 *   engagement, any status. Parties only (a 404 otherwise). The worker is
 *   named only to provider-side parties (L22): a client hirer reads
 *   `worker_user_id: null` and `worker_label: "Delivery team"`.
 * - `POST /api/engagements/:id/assignments`: a talent engagement's hirer
 *   assigns the talent; a client engagement's consultant assigns themselves.
 *   Several qualifying client agreements answer 422
 *   `ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED` with `client_engagements`
 *   (L8); `access_needed: true` means the worker still has no project access
 *   (L25).
 * - `POST /api/engagements/:id/assignments/:aid/end`: a running timer under
 *   it stops at the end (L37).
 *
 * Errors are `TimeApiError`s (the same envelope parser as `/api/time`), so
 * `code`, `status` and `extras` are read the same way everywhere; display
 * copy lives in `components/engagements/assignmentCopy.ts`.
 */

import apiClient from "@/api/axios";
import {
	isTimeApiError,
	toTimeApiError,
	unwrapTimeResponse,
} from "@/services/time.service";

export type EngagementAssignmentStatus = "active" | "ended" | "cancelled";

/** One assignment as a party of the engagement may see it (L22). */
export interface EngagementAssignment {
	id: string;
	/** The engagement the view was read through (the route's `:id`). */
	engagement_id: string;
	/** Null once the project was deleted. */
	project_id: string | null;
	project_title_snapshot: string;
	/** Null for a non-provider-side viewer (L22). */
	worker_user_id: string | null;
	/** The worker's name, "Delivery team" (masked) or "Unknown". */
	worker_label: string;
	client_engagement_id: string | null;
	/** Null for a non-provider-side viewer. */
	talent_engagement_id: string | null;
	team_id: string | null;
	role_title: string | null;
	status: EngagementAssignmentStatus | (string & {});
	started_at: string;
	ended_at: string | null;
}

/** `POST …/assignments`: the new row plus whether the worker still needs project access. */
export interface CreatedEngagementAssignment extends EngagementAssignment {
	access_needed: boolean;
}

/** `CreateAssignmentDto`. Only these keys are ever sent (`forbidNonWhitelisted`). */
export interface CreateEngagementAssignmentInput {
	project_id: string;
	/** Optional confirmation; must equal the worker the engagement implies. */
	worker_user_id?: string;
	/** Talent engagements only: which client agreement the work is for (L8). */
	client_engagement_id?: string;
	role_title?: string;
	/** Defaults to the team the seat signed for (L35). */
	team_id?: string;
	/** ISO instant; defaults to now on the server. */
	started_at?: string;
}

/** `EndAssignmentDto`. */
export interface EndEngagementAssignmentInput {
	/** ISO instant; defaults to now on the server. */
	ended_at?: string;
	reason?: string;
}

/** One candidate of `ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED` (the client hirer's name). */
export interface ClientEngagementChoice {
	id: string;
	label: string;
}

/** `CreateAssignmentDto.role_title` `@MaxLength(120)`. */
export const ASSIGNMENT_ROLE_TITLE_MAX = 120;
/** `EndAssignmentDto.reason` `@MaxLength(500)`. */
export const ASSIGNMENT_END_REASON_MAX = 500;
/** What a non-provider-side party reads instead of the worker (backend `MASKED_WORKER_LABEL`). */
export const MASKED_WORKER_LABEL = "Delivery team";

/**
 * Query keys. The list sits under `["engagement", id]`, so invalidating the
 * engagement detail refreshes its assignments too.
 */
export const engagementAssignmentKeys = {
	list: (engagementId: string) =>
		["engagement", engagementId, "assignments"] as const,
	/** The caller's projects, for placing a flexible engagement (user-scoped). */
	placeableProjects: (userId: string | null) =>
		[
			"engagement-assignments",
			"placeable-projects",
			userId ?? "anonymous",
		] as const,
};

function base(engagementId: string): string {
	return `/api/engagements/${encodeURIComponent(engagementId)}/assignments`;
}

function trimmed(value: string | null | undefined, max: number): string | null {
	const text = value?.trim();
	if (!text) return null;
	return Array.from(text).slice(0, max).join("");
}

/** The create body, DTO keys only; blanks and undefined are dropped. */
export function createAssignmentBody(
	input: CreateEngagementAssignmentInput,
): Record<string, string> {
	const body: Record<string, string> = { project_id: input.project_id };
	if (input.worker_user_id) body.worker_user_id = input.worker_user_id;
	if (input.client_engagement_id) {
		body.client_engagement_id = input.client_engagement_id;
	}
	const role = trimmed(input.role_title, ASSIGNMENT_ROLE_TITLE_MAX);
	if (role) body.role_title = role;
	if (input.team_id) body.team_id = input.team_id;
	if (input.started_at) body.started_at = input.started_at;
	return body;
}

/** The end body, DTO keys only. An empty body ends it now. */
export function endAssignmentBody(
	input: EndEngagementAssignmentInput = {},
): Record<string, string> {
	const body: Record<string, string> = {};
	if (input.ended_at) body.ended_at = input.ended_at;
	const reason = trimmed(input.reason, ASSIGNMENT_END_REASON_MAX);
	if (reason) body.reason = reason;
	return body;
}

async function call<T>(request: () => Promise<{ data: unknown }>): Promise<T> {
	try {
		const response = await request();
		return unwrapTimeResponse<T>(response?.data);
	} catch (error) {
		throw toTimeApiError(error);
	}
}

export const engagementAssignmentsService = {
	/** `GET /api/engagements/:id/assignments`, oldest first (the server's order). */
	async list(engagementId: string): Promise<EngagementAssignment[]> {
		const rows = await call<EngagementAssignment[] | null>(() =>
			apiClient.get(base(engagementId)),
		);
		return Array.isArray(rows) ? rows : [];
	},

	/** `POST /api/engagements/:id/assignments`. */
	create(
		engagementId: string,
		input: CreateEngagementAssignmentInput,
	): Promise<CreatedEngagementAssignment> {
		return call<CreatedEngagementAssignment>(() =>
			apiClient.post(base(engagementId), createAssignmentBody(input)),
		);
	},

	/** `POST /api/engagements/:id/assignments/:aid/end`. */
	end(
		engagementId: string,
		assignmentId: string,
		input: EndEngagementAssignmentInput = {},
	): Promise<EngagementAssignment> {
		return call<EngagementAssignment>(() =>
			apiClient.post(
				`${base(engagementId)}/${encodeURIComponent(assignmentId)}/end`,
				endAssignmentBody(input),
			),
		);
	},
};

/**
 * The client agreements to choose from when the server answered
 * `ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED` (L8); null for any other error.
 * Malformed items are skipped, duplicates collapse, and a missing label reads
 * "Client agreement".
 */
export function clientEngagementChoices(
	error: unknown,
): ClientEngagementChoice[] | null {
	const err = toTimeApiError(error);
	if (!isTimeApiError(err, "ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED")) {
		return null;
	}
	const raw = (err.extras as { client_engagements?: unknown })
		.client_engagements;
	const seen = new Set<string>();
	const choices: ClientEngagementChoice[] = [];
	for (const item of Array.isArray(raw) ? raw : []) {
		if (typeof item !== "object" || item === null) continue;
		const { id, label } = item as { id?: unknown; label?: unknown };
		if (typeof id !== "string" || !id || seen.has(id)) continue;
		seen.add(id);
		choices.push({
			id,
			label:
				typeof label === "string" && label.trim()
					? label.trim()
					: "Client agreement",
		});
	}
	return choices;
}
