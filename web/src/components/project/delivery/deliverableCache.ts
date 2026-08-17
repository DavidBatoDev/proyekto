import type {
	Deliverable,
	DeliverableAttachment,
	DeliverableCriterion,
	DeliverableLink,
	DeliverableProgress,
	DeliverableReviewer,
	EvidenceCategory,
} from "@/services/delivery.service";
import type { ProfileSummary } from "@/services/teams.service";

/**
 * Optimistic cache updates for deliverables.
 *
 * Pure `Deliverable → Deliverable` functions with no React and no query client,
 * so the rules are unit-testable on their own — the same split as
 * `routes/_execution/project/$projectId/work-items/workItemsOptimistic.ts`.
 *
 * Two of these rules also exist server-side and MUST stay in step:
 *   - `resolveReviewOutcome` ⇄ backend `deliverable-review.ts`
 *   - `recomputeProgress`    ⇄ backend `deliverable-progress.ts` (computeProgress)
 * `deliverableCache.test.ts` mirrors the backend spec cases so a divergence
 * shows up as a failing test rather than as a status that flickers to the wrong
 * value and then corrects itself.
 */

/** Matches roadmapStore's `temp-` convention, so `isOptimisticNodeId` agrees. */
const TEMP_PREFIX = "temp-";

export function isOptimisticId(id: string): boolean {
	return id.startsWith(TEMP_PREFIX);
}

function tempId(kind: string): string {
	return `${TEMP_PREFIX}${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── List membership ────────────────────────────────────────────────────────

/** Replace by id, or append when it's new. Order is otherwise untouched. */
export function upsertDeliverable(
	list: Deliverable[],
	deliverable: Deliverable,
): Deliverable[] {
	const index = list.findIndex((d) => d.id === deliverable.id);
	if (index === -1) return [...list, deliverable];
	return list.map((d) => (d.id === deliverable.id ? deliverable : d));
}

/** Also used to swap a `temp-` row for the real one the server returned. */
export function replaceDeliverable(
	list: Deliverable[],
	previousId: string,
	deliverable: Deliverable,
): Deliverable[] {
	const index = list.findIndex((d) => d.id === previousId);
	if (index === -1) return upsertDeliverable(list, deliverable);
	return list.map((d) => (d.id === previousId ? deliverable : d));
}

export function removeDeliverable(
	list: Deliverable[],
	id: string,
): Deliverable[] {
	return list.filter((d) => d.id !== id);
}

// ─── Progress ───────────────────────────────────────────────────────────────

/**
 * Mirrors the backend's `computeProgress` fallback: linked work is the measure,
 * criteria are the fallback, null when there is nothing to measure.
 *
 * Only the criteria half is recomputed here. `tasks_total` / `tasks_done` come
 * from expanding features and milestones through the roadmap, which the client
 * cannot do, so those are carried through untouched and corrected by the
 * server's response.
 */
export function recomputeProgress(deliverable: Deliverable): Deliverable {
	const criteria = deliverable.criteria ?? [];
	const criteriaTotal = criteria.length;
	const criteriaMet = criteria.filter((c) => c.is_met).length;
	const tasksTotal = deliverable.progress?.tasks_total ?? 0;
	const tasksDone = deliverable.progress?.tasks_done ?? 0;

	let percent: number | null = null;
	if (tasksTotal > 0) {
		percent = Math.round((tasksDone / tasksTotal) * 100);
	} else if (criteriaTotal > 0) {
		percent = Math.round((criteriaMet / criteriaTotal) * 100);
	}

	const progress: DeliverableProgress = {
		tasks_total: tasksTotal,
		tasks_done: tasksDone,
		percent,
		criteria_total: criteriaTotal,
		criteria_met: criteriaMet,
	};

	return { ...deliverable, progress };
}

// ─── Criteria ───────────────────────────────────────────────────────────────

export function withCriterionAdded(
	deliverable: Deliverable,
	label: string,
): Deliverable {
	const criteria = deliverable.criteria ?? [];
	const criterion: DeliverableCriterion = {
		id: tempId("criterion"),
		deliverable_id: deliverable.id,
		label,
		is_met: false,
		met_by: null,
		met_at: null,
		position: criteria.length,
	};
	return recomputeProgress({
		...deliverable,
		criteria: [...criteria, criterion],
	});
}

export function withCriterionToggled(
	deliverable: Deliverable,
	criterionId: string,
	isMet: boolean,
	userId: string | null,
): Deliverable {
	const criteria = (deliverable.criteria ?? []).map((criterion) =>
		criterion.id === criterionId
			? {
					...criterion,
					is_met: isMet,
					// The DB CHECK is symmetric — a ticked criterion carries who and
					// when, an unticked one carries neither.
					met_by: isMet ? userId : null,
					met_at: isMet ? new Date().toISOString() : null,
				}
			: criterion,
	);
	return recomputeProgress({ ...deliverable, criteria });
}

export function withCriterionRemoved(
	deliverable: Deliverable,
	criterionId: string,
): Deliverable {
	return recomputeProgress({
		...deliverable,
		criteria: (deliverable.criteria ?? []).filter((c) => c.id !== criterionId),
	});
}

// ─── Reviewers ──────────────────────────────────────────────────────────────

export function withReviewerAdded(
	deliverable: Deliverable,
	reviewerId: string,
	profile: ProfileSummary | null,
): Deliverable {
	const reviewers = deliverable.reviewers ?? [];
	if (reviewers.some((r) => r.reviewer_id === reviewerId)) return deliverable;

	const reviewer: DeliverableReviewer = {
		id: tempId("reviewer"),
		deliverable_id: deliverable.id,
		reviewer_id: reviewerId,
		decision: "pending",
		note: null,
		decided_at: null,
		reviewer: profile,
	};
	return { ...deliverable, reviewers: [...reviewers, reviewer] };
}

export function withReviewerRemoved(
	deliverable: Deliverable,
	reviewerId: string,
): Deliverable {
	return {
		...deliverable,
		reviewers: (deliverable.reviewers ?? []).filter(
			(r) => r.reviewer_id !== reviewerId,
		),
	};
}

// ─── Review state machine (mirrors backend deliverable-review.ts) ────────────

export type ReviewDecision = "approved" | "changes_requested";

/**
 * One objection outweighs any number of approvals; acceptance needs every
 * named reviewer. Kept byte-for-byte equivalent to the backend rule.
 */
export function resolveReviewOutcome(
	reviewers: Array<{ decision: DeliverableReviewer["decision"] }>,
): Deliverable["status"] {
	const total = reviewers.length;
	const approvals = reviewers.filter((r) => r.decision === "approved").length;
	const bounced = reviewers.some((r) => r.decision === "changes_requested");

	if (bounced) return "changes_requested";
	if (total > 0 && approvals === total) return "approved";
	return "in_review";
}

export function withSubmitted(
	deliverable: Deliverable,
	userId: string | null,
): Deliverable {
	const now = new Date().toISOString();
	return {
		...deliverable,
		status: "in_review",
		submitted_by: userId,
		submitted_at: now,
		// A resubmission must not inherit stale approvals — the server clears
		// these too, so showing them would be a lie for a whole round trip.
		reviewers: (deliverable.reviewers ?? []).map((reviewer) => ({
			...reviewer,
			decision: "pending" as const,
			note: null,
			decided_at: null,
		})),
	};
}

export function withReviewDecision(
	deliverable: Deliverable,
	userId: string | null,
	decision: ReviewDecision,
	note?: string,
): Deliverable {
	const now = new Date().toISOString();
	const reviewers = deliverable.reviewers ?? [];

	// Nobody named: whoever holds `deliverables.approve` decides it outright,
	// which is the server's fallback path.
	if (reviewers.length === 0) {
		return {
			...deliverable,
			status: decision,
			reviewed_by: userId,
			reviewed_at: now,
			review_note: note ?? null,
		};
	}

	const next = reviewers.map((reviewer) =>
		reviewer.reviewer_id === userId
			? { ...reviewer, decision, note: note ?? null, decided_at: now }
			: reviewer,
	);
	const status = resolveReviewOutcome(next);

	return {
		...deliverable,
		reviewers: next,
		status,
		// The stamps only land when the deliverable itself moves; the DB CHECK
		// requires both whenever status is approved or changes_requested.
		reviewed_by: status === "in_review" ? deliverable.reviewed_by : userId,
		reviewed_at: status === "in_review" ? deliverable.reviewed_at : now,
		review_note:
			status === "changes_requested" ? (note ?? null) : deliverable.review_note,
	};
}

// ─── Evidence and links ─────────────────────────────────────────────────────

export function withEvidenceAdded(
	deliverable: Deliverable,
	body: { url: string; category?: EvidenceCategory; label?: string },
): Deliverable {
	const attachment: DeliverableAttachment = {
		id: tempId("attachment"),
		kind: "link",
		category: body.category ?? "other",
		label: body.label ?? null,
		url: body.url,
		mime_type: null,
		size_bytes: null,
		created_at: new Date().toISOString(),
	};
	return {
		...deliverable,
		attachments: [...(deliverable.attachments ?? []), attachment],
	};
}

export function withEvidenceRemoved(
	deliverable: Deliverable,
	attachmentId: string,
): Deliverable {
	return {
		...deliverable,
		attachments: (deliverable.attachments ?? []).filter(
			(a) => a.id !== attachmentId,
		),
	};
}

/**
 * Adding a link shows the trail immediately but leaves `progress` alone: the
 * task count behind it comes from expanding features and milestones through the
 * roadmap, which only the server can do. The response corrects it.
 */
export function withLinkAdded(
	deliverable: Deliverable,
	link: Omit<DeliverableLink, "id" | "position">,
): Deliverable {
	const links = deliverable.links ?? [];
	return {
		...deliverable,
		links: [
			...links,
			{
				...link,
				id: tempId("link"),
				position: links.length,
			} as DeliverableLink,
		],
	};
}

export function withLinkRemoved(
	deliverable: Deliverable,
	linkId: string,
): Deliverable {
	return {
		...deliverable,
		links: (deliverable.links ?? []).filter((l) => l.id !== linkId),
	};
}

// ─── Create ─────────────────────────────────────────────────────────────────

export interface CreateDeliverableBody {
	title: string;
	description?: string;
	due_date?: string;
	criteria?: string[];
}

/**
 * A placeholder row for the gap before the server assigns an id. Rendered
 * dimmed and non-interactive — the detail route would 404 on a `temp-` id.
 */
export function optimisticDeliverable(
	projectId: string,
	body: CreateDeliverableBody,
): Deliverable {
	const now = new Date().toISOString();
	const id = tempId("deliverable");

	const criteria: DeliverableCriterion[] = (body.criteria ?? []).map(
		(label, index) => ({
			id: `${id}-criterion-${index}`,
			deliverable_id: id,
			label,
			is_met: false,
			met_by: null,
			met_at: null,
			position: index,
		}),
	);

	return recomputeProgress({
		id,
		project_id: projectId,
		roadmap_id: null,
		title: body.title,
		description: body.description ?? null,
		acceptance_criteria: null,
		status: "not_started",
		owner_id: null,
		due_date: body.due_date ?? null,
		position: Number.MAX_SAFE_INTEGER,
		submitted_by: null,
		submitted_at: null,
		reviewed_by: null,
		reviewed_at: null,
		review_note: null,
		created_at: now,
		updated_at: now,
		links: [],
		attachments: [],
		criteria,
		reviewers: [],
	});
}
