import type {
	ChangeRequest,
	ChangeRequestLink,
} from "@/services/delivery.service";
import type { StatusTone } from "./DeliveryPrimitives";
import type { LinkSegment, RoadmapNodeKind } from "./deliveryModel";

/**
 * Presentation rules for change requests, kept out of the components so they are
 * testable and stated once — the same split as `deliveryModel.ts`.
 */

export const CHANGE_REQUEST_STATUS_LABEL: Record<
	ChangeRequest["status"],
	string
> = {
	draft: "Draft",
	submitted: "Awaiting decision",
	approved: "Approved",
	rejected: "Rejected",
	changes_requested: "Changes requested",
	withdrawn: "Withdrawn",
	applied: "Applied",
};

export const CHANGE_REQUEST_STATUS_TONE: Record<
	ChangeRequest["status"],
	StatusTone
> = {
	draft: "neutral",
	submitted: "review",
	approved: "good",
	rejected: "bad",
	changes_requested: "bad",
	withdrawn: "neutral",
	applied: "good",
};

/**
 * The pipeline board: the life of a change request, left to right.
 *
 * `changes_requested` sits in Draft carrying its status pill, because that is
 * where the work actually is once it has been bounced — the same reasoning that
 * puts a bounced deliverable back in "In progress".
 *
 * `rejected` and `withdrawn` have no column: they are endings, not stages, and
 * giving them board space would make a healthy project look half-failed. They
 * are reachable through the status filter and counted in `closed`.
 */
export const CR_PIPELINE_COLUMNS = [
	{ key: "draft", label: "Draft" },
	{ key: "submitted", label: "Awaiting decision" },
	{ key: "approved", label: "Approved" },
	{ key: "applied", label: "Applied" },
] as const;

export type CrPipelineColumnKey = (typeof CR_PIPELINE_COLUMNS)[number]["key"];

/** Null means "off the board" — see the note on CR_PIPELINE_COLUMNS. */
export function crPipelineColumnFor(
	status: ChangeRequest["status"],
): CrPipelineColumnKey | null {
	if (status === "changes_requested") return "draft";
	if (status === "rejected" || status === "withdrawn") return null;
	return status;
}

export interface ChangeRequestStats {
	total: number;
	draft: number;
	awaitingDecision: number;
	approvedNotApplied: number;
	applied: number;
	closed: number;
	/**
	 * Schedule impact already ON the roadmap, from applied requests.
	 *
	 * Split from `pendingTimelineDays` deliberately. An applied request's change
	 * is already reflected in the roadmap's own dates, so adding the two together
	 * and comparing the sum against the current schedule counts the applied ones
	 * twice. Two honest numbers beat one wrong one.
	 */
	committedTimelineDays: number;
	/** Approved but not yet applied — what is about to land. */
	pendingTimelineDays: number;
	/** Share of requests that have reached a decision, 0-100, or null if none. */
	decidedPercent: number | null;
}

const DECIDED: ReadonlyArray<ChangeRequest["status"]> = [
	"approved",
	"applied",
	"rejected",
];

export function summarizeChangeRequests(
	requests: ChangeRequest[],
): ChangeRequestStats {
	const count = (status: ChangeRequest["status"]) =>
		requests.filter((r) => r.status === status).length;

	const days = (predicate: (r: ChangeRequest) => boolean) =>
		requests
			.filter(predicate)
			.reduce((sum, r) => sum + (r.impact_timeline_days ?? 0), 0);

	const total = requests.length;
	// Withdrawn requests never reached a decision, so they are excluded from the
	// denominator rather than counted as undecided forever.
	const decidable = requests.filter((r) => r.status !== "withdrawn").length;
	const decided = requests.filter((r) => DECIDED.includes(r.status)).length;

	return {
		total,
		draft: count("draft") + count("changes_requested"),
		awaitingDecision: count("submitted"),
		approvedNotApplied: count("approved"),
		applied: count("applied"),
		closed: count("rejected") + count("withdrawn"),
		committedTimelineDays: days((r) => r.status === "applied"),
		pendingTimelineDays: days((r) => r.status === "approved"),
		decidedPercent:
			decidable === 0 ? null : Math.round((decided / decidable) * 100),
	};
}

/** Signed day delta, rendered the way a person would say it. */
export function timelineImpact(days: number | null): string | null {
	if (days === null) return null;
	if (days === 0) return "No timeline change";
	const magnitude = Math.abs(days);
	const unit = magnitude === 1 ? "day" : "days";
	return days > 0 ? `+${magnitude} ${unit}` : `${magnitude} ${unit} earlier`;
}

/** "CR-014". Reference 0 is an unsaved optimistic row — see changeRequestCache. */
export function changeRequestReference(request: ChangeRequest): string {
	if (!request.reference) return "CR-—";
	return `CR-${String(request.reference).padStart(3, "0")}`;
}

/**
 * The Epic → Feature → Task trail a link came from, each segment keeping its kind
 * so the UI can give it the roadmap's own glyph.
 *
 * The change-request variant of `linkSegments`: this junction can target an epic
 * or a deliverable directly, and cannot target a milestone at all.
 */
export function crLinkSegments(link: ChangeRequestLink): LinkSegment[] {
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
	if (link.epic) return segment("epic", link.epic.title);
	// A deliverable is not a roadmap node; it borrows the feature glyph so the row
	// still reads as a linked thing rather than rendering unlabelled.
	if (link.deliverable) return segment("feature", link.deliverable.title);
	return [];
}

/**
 * Requests still waiting on a decision, longest first.
 *
 * Oldest-first on purpose: the header column exists to surface what has been
 * sitting, and a newest-first list would bury exactly that.
 */
export function awaitingLongest(
	requests: ChangeRequest[],
	limit = 4,
): ChangeRequest[] {
	return requests
		.filter((r) => r.status === "submitted")
		.sort((a, b) => a.updated_at.localeCompare(b.updated_at))
		.slice(0, limit);
}

/** Whole days a submitted request has been waiting, for the "N days" caption. */
export function daysWaiting(request: ChangeRequest, now = Date.now()): number {
	const since = Date.parse(request.updated_at);
	if (Number.isNaN(since)) return 0;
	return Math.max(0, Math.floor((now - since) / 86_400_000));
}
