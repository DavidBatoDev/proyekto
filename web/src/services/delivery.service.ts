import apiClient from "@/api/axios";
import type { ProfileSummary } from "@/services/teams.service";

/**
 * Delivery governance: Deliverables, Change Requests, Risks & Issues, and
 * Decisions.
 *
 * All four sit behind one `access.delivery` gate. Responses come through the
 * backend's ResponseInterceptor envelope, so every call unwraps `.data.data`.
 *
 * There is no money in any of these shapes on purpose — the project workspace
 * is execution only, and cost lives in contracts and invoices under finance.
 */

export type DeliverableStatus =
	| "not_started"
	| "in_progress"
	| "in_review"
	| "approved"
	| "changes_requested";

interface NamedNode {
	id: string;
	title: string;
	status: string;
}

export interface DeliverableLink {
	id: string;
	feature_id: string | null;
	task_id: string | null;
	milestone_id: string | null;
	position: number;
	/** Parents embedded upward, so the Epic → Feature → Task trail renders. */
	task?: (NamedNode & { feature?: NamedNode & { epic?: NamedNode } }) | null;
	feature?: (NamedNode & { epic?: NamedNode | null }) | null;
	milestone?: (NamedNode & { target_date: string | null }) | null;
}

export type EvidenceCategory =
	| "github"
	| "figma"
	| "deployment"
	| "docs"
	| "demo"
	| "other";

export interface DeliverableAttachment {
	id: string;
	kind: "file" | "link";
	category: EvidenceCategory;
	label: string | null;
	url: string;
	mime_type: string | null;
	size_bytes: number | null;
	created_at: string;
}

export interface DeliverableCriterion {
	id: string;
	deliverable_id: string;
	label: string;
	is_met: boolean;
	met_by: string | null;
	met_at: string | null;
	position: number;
}

export interface DeliverableReviewer {
	id: string;
	deliverable_id: string;
	reviewer_id: string;
	decision: "pending" | "approved" | "changes_requested";
	note: string | null;
	decided_at: string | null;
	reviewer?: ProfileSummary | null;
}

/** Completion traced back to real roadmap tasks, computed server-side. */
export interface DeliverableProgress {
	tasks_total: number;
	tasks_done: number;
	/** 0-100, or null when nothing is linked or checklisted yet. */
	percent: number | null;
	criteria_total: number;
	criteria_met: number;
}

export interface Deliverable {
	id: string;
	project_id: string;
	roadmap_id: string | null;
	title: string;
	description: string | null;
	acceptance_criteria: string | null;
	status: DeliverableStatus;
	owner_id: string | null;
	due_date: string | null;
	position: number;
	submitted_by: string | null;
	submitted_at: string | null;
	reviewed_by: string | null;
	reviewed_at: string | null;
	review_note: string | null;
	created_at: string;
	updated_at: string;
	links?: DeliverableLink[];
	attachments?: DeliverableAttachment[];
	criteria?: DeliverableCriterion[];
	reviewers?: DeliverableReviewer[];
	progress?: DeliverableProgress;
}

export type ChangeRequestStatus =
	| "draft"
	| "submitted"
	| "approved"
	| "rejected"
	| "changes_requested"
	| "withdrawn"
	| "applied";

/**
 * What a change request affects.
 *
 * Deliberately NOT interchangeable with `DeliverableLink`: this junction has
 * `epic_id` and `deliverable_id` but no `milestone_id`, so the link picker has to
 * be told which kinds are allowed rather than assuming.
 */
export interface ChangeRequestLink {
	id: string;
	epic_id: string | null;
	feature_id: string | null;
	task_id: string | null;
	deliverable_id: string | null;
	position: number;
	/** Parents embedded upward, so the Epic → Feature → Task trail renders. */
	epic?: NamedNode | null;
	feature?: (NamedNode & { epic?: NamedNode | null }) | null;
	task?: (NamedNode & { feature?: NamedNode & { epic?: NamedNode } }) | null;
	deliverable?: NamedNode | null;
}

/** The roadmap commit that carried an approved change onto the roadmap. */
export interface AppliedChange {
	change_id: string;
	committed_at: string | null;
	operations_count: number | null;
	semantic_change_count: number | null;
}

export interface ChangeRequest {
	id: string;
	project_id: string;
	roadmap_id: string | null;
	reference: number;
	title: string;
	description: string | null;
	requested_by: string | null;
	impact_scope: string | null;
	/** Signed day delta. Negative pulls the schedule in. Never a cost. */
	impact_timeline_days: number | null;
	target_date_before: string | null;
	target_date_after: string | null;
	status: ChangeRequestStatus;
	decided_by: string | null;
	decided_at: string | null;
	decision_note: string | null;
	applied_change_id: string | null;
	applied_by: string | null;
	applied_at: string | null;
	created_at: string;
	updated_at: string;
	links?: ChangeRequestLink[];
	applied_change?: AppliedChange | null;
}

export type RiskKind = "risk" | "issue";
export type RiskSeverity = "low" | "medium" | "high" | "critical";
export type RiskStatus =
	| "open"
	| "mitigating"
	| "monitoring"
	| "resolved"
	| "accepted"
	| "closed";

export interface RiskEntry {
	id: string;
	project_id: string;
	kind: RiskKind;
	title: string;
	description: string | null;
	severity: RiskSeverity;
	likelihood: "low" | "medium" | "high" | null;
	status: RiskStatus;
	impact: string | null;
	mitigation: string | null;
	owner_id: string | null;
	due_date: string | null;
	resolved_at: string | null;
	visibility: "internal" | "shared";
	source_kind: "manual" | "blocked_task" | "at_risk_milestone";
	created_at: string;
	updated_at: string;
}

export interface RiskListResult {
	items: RiskEntry[];
	/** False when internal rows were filtered out server-side. */
	can_view_internal: boolean;
}

export interface RiskCandidates {
	blocked_tasks: Array<{ id: string; title: string; status: string }>;
	at_risk_milestones: Array<{
		id: string;
		title: string;
		status: string;
		target_date: string | null;
	}>;
}

export type DecisionStatus = "proposed" | "final" | "superseded";

/** Token keys, never hex — resolved by CATEGORY_ACCENT / CATEGORY_ICON in web. */
export type CategoryColor =
	| "slate"
	| "blue"
	| "violet"
	| "teal"
	| "amber"
	| "rose"
	| "emerald"
	| "indigo";
export type CategoryIcon =
	| "tag"
	| "cpu"
	| "palette"
	| "crosshair"
	| "briefcase"
	| "workflow"
	| "shield"
	| "database";

export interface DecisionCategory {
	id: string;
	project_id: string;
	name: string;
	color: CategoryColor;
	icon: CategoryIcon;
	position: number;
	created_at: string;
	updated_at: string;
}

/**
 * What a decision bears on. Exactly one target is non-null.
 *
 * This junction carries every target — unlike `DeliverableLink` (no epic) and
 * `ChangeRequestLink` (no milestone), which are deliberately narrower.
 */
export interface DecisionLink {
	id: string;
	epic_id: string | null;
	feature_id: string | null;
	task_id: string | null;
	milestone_id: string | null;
	deliverable_id: string | null;
	position: number;
	epic?: { id: string; title: string; status: string } | null;
	feature?: {
		id: string;
		title: string;
		status: string;
		epic?: { id: string; title: string } | null;
	} | null;
	task?: {
		id: string;
		title: string;
		status: string;
		feature?: {
			id: string;
			title: string;
			epic?: { id: string; title: string } | null;
		} | null;
	} | null;
	milestone?: {
		id: string;
		title: string;
		status: string;
		target_date: string | null;
	} | null;
	deliverable?: { id: string; title: string; status: string } | null;
}

export interface DecisionOption {
	id: string;
	decision_id: string;
	title: string;
	detail: string | null;
	/** At most one per decision — the database enforces it with a partial index. */
	is_selected: boolean;
	position: number;
}

export interface Decision {
	id: string;
	project_id: string;
	/** Per-project number, rendered DEC-024. Null only on an optimistic row. */
	reference: number | null;
	title: string;
	context: string | null;
	decision: string;
	rationale: string | null;
	/** Superseded by `options`; still rendered when an older row carries prose. */
	alternatives_considered: string | null;
	category_id: string | null;
	decided_by: string | null;
	decided_on: string;
	status: DecisionStatus;
	supersedes_decision_id: string | null;
	version: number;
	visibility: "internal" | "shared";
	created_at: string;
	updated_at: string;
	category?: DecisionCategory | null;
	links?: DecisionLink[];
	options?: DecisionOption[];
}

const base = (projectId: string) => `/api/projects/${projectId}`;

async function unwrap<T>(promise: Promise<{ data: { data: T } }>): Promise<T> {
	const res = await promise;
	return res.data.data;
}

export const deliverablesService = {
	list(projectId: string, status?: DeliverableStatus) {
		const query = status ? `?status=${status}` : "";
		return unwrap<Deliverable[]>(
			apiClient.get(`${base(projectId)}/deliverables${query}`),
		);
	},
	get(projectId: string, id: string) {
		return unwrap<Deliverable>(
			apiClient.get(`${base(projectId)}/deliverables/${id}`),
		);
	},
	create(
		projectId: string,
		body: {
			title: string;
			description?: string;
			acceptance_criteria?: string;
			owner_id?: string;
			due_date?: string;
			roadmap_id?: string;
			criteria?: string[];
			reviewer_ids?: string[];
			links?: Array<{
				feature_id?: string;
				task_id?: string;
				milestone_id?: string;
			}>;
		},
	) {
		return unwrap<Deliverable>(
			apiClient.post(`${base(projectId)}/deliverables`, body),
		);
	},
	addLink(
		projectId: string,
		id: string,
		target: { feature_id?: string; task_id?: string; milestone_id?: string },
	) {
		return unwrap<Deliverable>(
			apiClient.post(`${base(projectId)}/deliverables/${id}/links`, target),
		);
	},
	removeLink(projectId: string, id: string, linkId: string) {
		return unwrap<Deliverable>(
			apiClient.delete(`${base(projectId)}/deliverables/${id}/links/${linkId}`),
		);
	},
	addCriterion(projectId: string, id: string, label: string) {
		return unwrap<Deliverable>(
			apiClient.post(`${base(projectId)}/deliverables/${id}/criteria`, {
				label,
			}),
		);
	},
	updateCriterion(
		projectId: string,
		id: string,
		criterionId: string,
		body: { label?: string; is_met?: boolean },
	) {
		return unwrap<Deliverable>(
			apiClient.patch(
				`${base(projectId)}/deliverables/${id}/criteria/${criterionId}`,
				body,
			),
		);
	},
	removeCriterion(projectId: string, id: string, criterionId: string) {
		return unwrap<Deliverable>(
			apiClient.delete(
				`${base(projectId)}/deliverables/${id}/criteria/${criterionId}`,
			),
		);
	},
	addReviewer(projectId: string, id: string, reviewerId: string) {
		return unwrap<Deliverable>(
			apiClient.post(`${base(projectId)}/deliverables/${id}/reviewers`, {
				reviewer_id: reviewerId,
			}),
		);
	},
	removeReviewer(projectId: string, id: string, reviewerId: string) {
		return unwrap<Deliverable>(
			apiClient.delete(
				`${base(projectId)}/deliverables/${id}/reviewers/${reviewerId}`,
			),
		);
	},
	addEvidence(
		projectId: string,
		id: string,
		body: {
			kind: "file" | "link";
			url: string;
			category?: EvidenceCategory;
			label?: string;
		},
	) {
		return unwrap<Deliverable>(
			apiClient.post(`${base(projectId)}/deliverables/${id}/attachments`, body),
		);
	},
	removeEvidence(projectId: string, id: string, attachmentId: string) {
		return unwrap<Deliverable>(
			apiClient.delete(
				`${base(projectId)}/deliverables/${id}/attachments/${attachmentId}`,
			),
		);
	},
	update(
		projectId: string,
		id: string,
		body: Partial<{
			title: string;
			description: string;
			acceptance_criteria: string;
			owner_id: string | null;
			due_date: string | null;
			status: "not_started" | "in_progress";
		}>,
	) {
		return unwrap<Deliverable>(
			apiClient.patch(`${base(projectId)}/deliverables/${id}`, body),
		);
	},
	/** Hand it to the reviewer. Separate from update so the stamps can't be skipped. */
	submit(projectId: string, id: string) {
		return unwrap<Deliverable>(
			apiClient.post(`${base(projectId)}/deliverables/${id}/submit`, {}),
		);
	},
	review(
		projectId: string,
		id: string,
		body: { decision: "approved" | "changes_requested"; review_note?: string },
	) {
		return unwrap<Deliverable>(
			apiClient.post(`${base(projectId)}/deliverables/${id}/review`, body),
		);
	},
	remove(projectId: string, id: string) {
		return unwrap<{ id: string; deleted: boolean }>(
			apiClient.delete(`${base(projectId)}/deliverables/${id}`),
		);
	},
};

/** Coarse status groupings the list page's filter chips request. */
export type ChangeRequestView =
	| "all"
	| "open"
	| "awaiting_decision"
	| "decided"
	| "closed";

export interface ChangeRequestLinkTarget {
	epic_id?: string;
	feature_id?: string;
	task_id?: string;
	deliverable_id?: string;
}

export const changeRequestsService = {
	list(
		projectId: string,
		params: { status?: ChangeRequestStatus; view?: ChangeRequestView } = {},
	) {
		const query = new URLSearchParams();
		if (params.status) query.set("status", params.status);
		// The backend ignores `view` when `status` is present, so sending both is
		// harmless — but not sending a redundant "all" keeps the cache key honest.
		else if (params.view && params.view !== "all")
			query.set("view", params.view);
		const suffix = query.toString() ? `?${query.toString()}` : "";
		return unwrap<ChangeRequest[]>(
			apiClient.get(`${base(projectId)}/change-requests${suffix}`),
		);
	},
	get(projectId: string, id: string) {
		return unwrap<ChangeRequest>(
			apiClient.get(`${base(projectId)}/change-requests/${id}`),
		);
	},
	create(
		projectId: string,
		body: {
			title: string;
			description?: string;
			impact_scope?: string;
			impact_timeline_days?: number;
			target_date_before?: string;
			target_date_after?: string;
			roadmap_id?: string;
			links?: ChangeRequestLinkTarget[];
			submit?: boolean;
		},
	) {
		return unwrap<ChangeRequest>(
			apiClient.post(`${base(projectId)}/change-requests`, body),
		);
	},
	update(
		projectId: string,
		id: string,
		body: Partial<{
			title: string;
			description: string;
			impact_scope: string;
			impact_timeline_days: number | null;
			target_date_before: string | null;
			target_date_after: string | null;
			roadmap_id: string | null;
		}>,
	) {
		return unwrap<ChangeRequest>(
			apiClient.patch(`${base(projectId)}/change-requests/${id}`, body),
		);
	},
	addLink(projectId: string, id: string, target: ChangeRequestLinkTarget) {
		return unwrap<ChangeRequest>(
			apiClient.post(`${base(projectId)}/change-requests/${id}/links`, target),
		);
	},
	removeLink(projectId: string, id: string, linkId: string) {
		return unwrap<ChangeRequest>(
			apiClient.delete(
				`${base(projectId)}/change-requests/${id}/links/${linkId}`,
			),
		);
	},
	submit(projectId: string, id: string) {
		return unwrap<ChangeRequest>(
			apiClient.post(`${base(projectId)}/change-requests/${id}/submit`, {}),
		);
	},
	withdraw(projectId: string, id: string) {
		return unwrap<ChangeRequest>(
			apiClient.post(`${base(projectId)}/change-requests/${id}/withdraw`, {}),
		);
	},
	decide(
		projectId: string,
		id: string,
		body: {
			decision: "approved" | "rejected" | "changes_requested";
			decision_note?: string;
		},
	) {
		return unwrap<ChangeRequest>(
			apiClient.post(`${base(projectId)}/change-requests/${id}/decision`, body),
		);
	},
	/**
	 * Record that an approved change reached the roadmap.
	 *
	 * The caller supplies a `change_id` from a roadmap commit that already
	 * happened — approving never writes the roadmap, because a request approved
	 * days ago carries a stale revision token.
	 */
	markApplied(projectId: string, id: string, appliedChangeId: string) {
		return unwrap<ChangeRequest>(
			apiClient.post(`${base(projectId)}/change-requests/${id}/applied`, {
				applied_change_id: appliedChangeId,
			}),
		);
	},
	remove(projectId: string, id: string) {
		return unwrap<{ id: string; deleted: boolean }>(
			apiClient.delete(`${base(projectId)}/change-requests/${id}`),
		);
	},
};

export const risksService = {
	list(
		projectId: string,
		params: { kind?: RiskKind; status?: RiskStatus } = {},
	) {
		const query = new URLSearchParams();
		if (params.kind) query.set("kind", params.kind);
		if (params.status) query.set("status", params.status);
		const suffix = query.toString() ? `?${query.toString()}` : "";
		return unwrap<RiskListResult>(
			apiClient.get(`${base(projectId)}/risks${suffix}`),
		);
	},
	/** Blocked tasks and at-risk milestones not yet promoted into the register. */
	candidates(projectId: string) {
		return unwrap<RiskCandidates>(
			apiClient.get(`${base(projectId)}/risks/candidates`),
		);
	},
	create(
		projectId: string,
		body: {
			kind: RiskKind;
			title: string;
			description?: string;
			severity?: RiskSeverity;
			likelihood?: "low" | "medium" | "high";
			impact?: string;
			mitigation?: string;
			owner_id?: string;
			due_date?: string;
			visibility?: "internal" | "shared";
			source_kind?: "manual" | "blocked_task" | "at_risk_milestone";
		},
	) {
		return unwrap<RiskEntry>(apiClient.post(`${base(projectId)}/risks`, body));
	},
	update(
		projectId: string,
		id: string,
		body: Partial<{
			title: string;
			description: string;
			severity: RiskSeverity;
			likelihood: "low" | "medium" | "high";
			status: RiskStatus;
			impact: string;
			mitigation: string;
			owner_id: string | null;
			due_date: string | null;
			visibility: "internal" | "shared";
		}>,
	) {
		return unwrap<RiskEntry>(
			apiClient.patch(`${base(projectId)}/risks/${id}`, body),
		);
	},
	remove(projectId: string, id: string) {
		return unwrap<{ id: string; deleted: boolean }>(
			apiClient.delete(`${base(projectId)}/risks/${id}`),
		);
	},
};

/** A roadmap or delivery target a decision can point at. */
export interface DecisionLinkTarget {
	epic_id?: string;
	feature_id?: string;
	task_id?: string;
	milestone_id?: string;
	deliverable_id?: string;
}

export interface CreateDecisionBody {
	title: string;
	decision: string;
	context?: string;
	rationale?: string;
	decided_on?: string;
	category_id?: string;
	status?: "proposed" | "final";
	supersedes_decision_id?: string;
	visibility?: "internal" | "shared";
	links?: DecisionLinkTarget[];
	options?: Array<{ title: string; detail?: string; is_selected?: boolean }>;
}

/**
 * Every write returns the full hydrated `Decision`, which is what lets the
 * mutations patch the cache and reconcile from the response instead of
 * refetching the list after each click.
 */
export const decisionsService = {
	list(projectId: string, params?: { status?: string; category_id?: string }) {
		const query = new URLSearchParams();
		if (params?.status) query.set("status", params.status);
		if (params?.category_id) query.set("category_id", params.category_id);
		const suffix = query.toString() ? `?${query}` : "";
		return unwrap<Decision[]>(
			apiClient.get(`${base(projectId)}/decisions${suffix}`),
		);
	},
	get(projectId: string, id: string) {
		return unwrap<Decision>(
			apiClient.get(`${base(projectId)}/decisions/${id}`),
		);
	},
	create(projectId: string, body: CreateDecisionBody) {
		return unwrap<Decision>(
			apiClient.post(`${base(projectId)}/decisions`, body),
		);
	},
	update(
		projectId: string,
		id: string,
		body: Partial<{
			title: string;
			decision: string;
			context: string;
			rationale: string;
			alternatives_considered: string;
			decided_on: string;
			visibility: "internal" | "shared";
			category_id: string | null;
		}>,
	) {
		return unwrap<Decision>(
			apiClient.patch(`${base(projectId)}/decisions/${id}`, body),
		);
	},
	/** proposed -> final. Separate from `update` so the stamps can't be skipped. */
	finalize(projectId: string, id: string) {
		return unwrap<Decision>(
			apiClient.post(`${base(projectId)}/decisions/${id}/finalize`, {}),
		);
	},
	addLink(projectId: string, id: string, target: DecisionLinkTarget) {
		return unwrap<Decision>(
			apiClient.post(`${base(projectId)}/decisions/${id}/links`, target),
		);
	},
	removeLink(projectId: string, id: string, linkId: string) {
		return unwrap<Decision>(
			apiClient.delete(`${base(projectId)}/decisions/${id}/links/${linkId}`),
		);
	},
	addOption(
		projectId: string,
		id: string,
		body: { title: string; detail?: string; is_selected?: boolean },
	) {
		return unwrap<Decision>(
			apiClient.post(`${base(projectId)}/decisions/${id}/options`, body),
		);
	},
	updateOption(
		projectId: string,
		id: string,
		optionId: string,
		body: Partial<{ title: string; detail: string; is_selected: boolean }>,
	) {
		return unwrap<Decision>(
			apiClient.patch(
				`${base(projectId)}/decisions/${id}/options/${optionId}`,
				body,
			),
		);
	},
	removeOption(projectId: string, id: string, optionId: string) {
		return unwrap<Decision>(
			apiClient.delete(
				`${base(projectId)}/decisions/${id}/options/${optionId}`,
			),
		);
	},
	remove(projectId: string, id: string) {
		return unwrap<{ id: string; deleted: boolean }>(
			apiClient.delete(`${base(projectId)}/decisions/${id}`),
		);
	},
};

export const decisionCategoriesService = {
	list(projectId: string) {
		return unwrap<DecisionCategory[]>(
			apiClient.get(`${base(projectId)}/decision-categories`),
		);
	},
	create(
		projectId: string,
		body: { name: string; color?: CategoryColor; icon?: CategoryIcon },
	) {
		return unwrap<DecisionCategory>(
			apiClient.post(`${base(projectId)}/decision-categories`, body),
		);
	},
	update(
		projectId: string,
		id: string,
		body: Partial<{ name: string; color: CategoryColor; icon: CategoryIcon }>,
	) {
		return unwrap<DecisionCategory>(
			apiClient.patch(`${base(projectId)}/decision-categories/${id}`, body),
		);
	},
	/** `orphaned` is how many decisions fell back to "Uncategorised". */
	remove(projectId: string, id: string) {
		return unwrap<{ id: string; deleted: boolean; orphaned: number }>(
			apiClient.delete(`${base(projectId)}/decision-categories/${id}`),
		);
	},
};
