import type { Deliverable, DeliverableLink } from "@/services/delivery.service";
import type { StatusTone } from "./DeliveryPrimitives";

/**
 * Presentation rules for deliverables, kept out of the components so they are
 * testable and stated once.
 *
 * Note the label mapping: the stored status is `approved`, the UI says
 * **Accepted**. Renaming the stored value would be a data migration for pure
 * wording, and label ≠ stored value is already established (`work-items` is
 * labelled Board).
 */

export const DELIVERABLE_STATUS_LABEL: Record<Deliverable["status"], string> = {
	not_started: "Not started",
	in_progress: "In progress",
	in_review: "In review",
	approved: "Accepted",
	changes_requested: "Changes requested",
};

export const DELIVERABLE_STATUS_TONE: Record<
	Deliverable["status"],
	StatusTone
> = {
	not_started: "neutral",
	in_progress: "progress",
	in_review: "review",
	approved: "good",
	changes_requested: "bad",
};

/**
 * Pipeline columns mirror the stored status exactly, so a card's position is
 * never a lie. `changes_requested` deliberately has no column of its own — it
 * sits in "In progress" carrying a flag, because that is where the work
 * actually is once a reviewer has bounced it.
 */
export const PIPELINE_COLUMNS = [
	{ key: "not_started", label: "Not started" },
	{ key: "in_progress", label: "In progress" },
	{ key: "in_review", label: "In review" },
	{ key: "approved", label: "Accepted" },
] as const;

export type PipelineColumnKey = (typeof PIPELINE_COLUMNS)[number]["key"];

export function pipelineColumnFor(
	status: Deliverable["status"],
): PipelineColumnKey {
	return status === "changes_requested" ? "in_progress" : status;
}

export interface DeliveryStats {
	total: number;
	accepted: number;
	inReview: number;
	inProgress: number;
	changesRequested: number;
	notStarted: number;
	/** Share of deliverables the project has actually accepted, 0-100. */
	acceptedPercent: number | null;
}

export function summarize(deliverables: Deliverable[]): DeliveryStats {
	const count = (status: Deliverable["status"]) =>
		deliverables.filter((d) => d.status === status).length;

	const total = deliverables.length;
	const accepted = count("approved");

	return {
		total,
		accepted,
		inReview: count("in_review"),
		inProgress: count("in_progress"),
		changesRequested: count("changes_requested"),
		notStarted: count("not_started"),
		// Null rather than 0 with nothing planned, so the header can say "nothing
		// planned yet" instead of implying total failure.
		acceptedPercent: total === 0 ? null : Math.round((accepted / total) * 100),
	};
}

/** "N of M sign-offs", plus who is still owed. */
export function signOffSummary(deliverable: Deliverable): {
	total: number;
	approved: number;
	pending: number;
	label: string;
} | null {
	const reviewers = deliverable.reviewers ?? [];
	if (reviewers.length === 0) return null;

	const approved = reviewers.filter((r) => r.decision === "approved").length;
	const pending = reviewers.filter((r) => r.decision === "pending").length;

	return {
		total: reviewers.length,
		approved,
		pending,
		label: `${approved} of ${reviewers.length} sign-off${
			reviewers.length === 1 ? "" : "s"
		}`,
	};
}

/**
 * The Epic → Feature → Task trail a link came from, as readable segments.
 *
 * Returns null for a link whose parents were not embedded (a deleted target,
 * or an older payload), so callers render nothing rather than "undefined".
 */
export function linkTrail(link: DeliverableLink): string[] | null {
	if (link.task) {
		const epic = link.task.feature?.epic?.title;
		const feature = link.task.feature?.title;
		return [epic, feature, link.task.title].filter((part): part is string =>
			Boolean(part),
		);
	}
	if (link.feature) {
		return [link.feature.epic?.title, link.feature.title].filter(
			(part): part is string => Boolean(part),
		);
	}
	if (link.milestone) return [link.milestone.title];
	return null;
}

export type RoadmapNodeKind = "epic" | "feature" | "task" | "milestone";

export interface LinkSegment {
	kind: RoadmapNodeKind;
	title: string;
}

/**
 * The same trail as `linkTrail`, but each segment keeps its kind so the UI can
 * give it its own glyph. Ordered outermost first (epic → feature → task), which
 * is the order a tree draws in.
 */
export function linkSegments(link: DeliverableLink): LinkSegment[] {
	const segment = (
		kind: RoadmapNodeKind,
		title: string | undefined | null,
	): LinkSegment[] => (title ? [{ kind, title }] : []);

	if (link.task) {
		return [
			...segment("epic", link.task.feature?.epic?.title),
			...segment("feature", link.task.feature?.title),
			...segment("task", link.task.title),
		];
	}
	if (link.feature) {
		return [
			...segment("epic", link.feature.epic?.title),
			...segment("feature", link.feature.title),
		];
	}
	if (link.milestone) return segment("milestone", link.milestone.title);
	return [];
}

/** Deliverables with a due date, soonest first — for "what's coming next". */
export function upcomingDeliveries(
	deliverables: Deliverable[],
	limit = 6,
): Deliverable[] {
	return deliverables
		.filter((d) => Boolean(d.due_date) && d.status !== "approved")
		.sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
		.slice(0, limit);
}
