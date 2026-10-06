/**
 * Copy and small rules for the engagement page's Assignments section
 * (ux.md › Project Surfaces › Engagement page; backend
 * `engagement-assignments.service.ts`).
 *
 * The ux.md sentences are used as written: "Which client agreement is this
 * work for?" (L8), "Ask a project admin to add Leo." (L25) and "Ending this
 * stops Leo's running timer at the end time." (L37). The rest follows the
 * backend's own refusal copy and the time copy's voice. No sentence here
 * names a contract, rate, payout or invoice, and none links to
 * `/engagements`, so the section would be native-safe even though the
 * engagement page is web-only.
 */

import { timeErrorCopy } from "@/lib/timeErrors";
import {
	type DateFormatOptions,
	deviceTimeZone,
	formatInstantDay,
	possessive,
} from "@/lib/timeFormat";
import type { Engagement } from "@/services/engagement.service";
import type { EngagementAssignment } from "@/services/engagementAssignments.service";
import { toTimeApiError } from "@/services/time.service";

export const ASSIGNMENT_COPY = {
	sectionTitle: "Assignments",
	assign: "Assign to project",
	assignTitle: "Assign to project",
	assignConfirm: "Assign",
	assigning: "Assigning…",
	cancel: "Cancel",
	projectLabel: "Project",
	projectPlaceholder: "Choose a project…",
	roleLabel: "Role",
	rolePlaceholder: "e.g. Frontend developer",
	startLabel: "Starts",
	startHint: "Leave empty to start now.",
	/** ux.md (L8), also the `ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED` row. */
	clientQuestion: "Which client agreement is this work for?",
	clientChoiceFallback: "Client agreement",
	notOnAgreementSuffix: "not on this agreement yet",
	alreadyAssignedSuffix: "already assigned",
	placeHint: "This agreement isn't on that project yet. Assigning adds it.",
	noLinkedProject:
		"This agreement isn't on a project yet, so there's nothing to assign to.",
	noProjectToChoose:
		"There's no project to choose yet. Projects you manage show here.",
	projectsLoadFailed: "Proyekto couldn't load your projects. Try again.",
	end: "End assignment",
	endTitle: "End assignment?",
	endConfirm: "End assignment",
	ending: "Ending…",
	endLabel: "Ends",
	endHint: "Leave empty to end it now.",
	reasonLabel: "Reason",
	reasonPlaceholder: "e.g. The work is done",
	alreadyEnded: "This assignment has already ended.",
	dismiss: "Dismiss",
	loadingLabel: "Loading assignments",
	showEnded: (count: number) => `Show ended (${count})`,
	hideEnded: "Hide ended",
	you: "You",
	active: "Active",
	ended: "Ended",
	cancelled: "Cancelled",
} as const;

/** What the viewer may do in this section, from their seat on the engagement. */
export interface AssignmentAuthority {
	/** "Assign to project" is offered. */
	canAssign: boolean;
	/** "End assignment" is offered on active rows. */
	canEnd: boolean;
	/** The viewer assigns themselves (a client engagement's consultant). */
	self: boolean;
	/** The worker an assignment made here names: the talent, or null for the viewer. */
	workerName: string | null;
	/** The viewer is a provider-side party, so workers are named (L22). */
	providerSide: boolean;
}

/** The counterparty's name, as the page header reads it. */
function counterpartyName(engagement: Engagement): string {
	return (
		engagement.counterparty?.display_name_snapshot ??
		engagement.counterparty?.email_snapshot ??
		"this person"
	);
}

/**
 * The backend's rules (`create`, `end`): a talent engagement's hirer assigns
 * and ends the talent's work; a client engagement's consultant (provider)
 * assigns themselves and ends work under it. Only an active engagement takes
 * new assignments. A client hirer and a talent worker read the list only.
 */
export function assignmentAuthority(
	engagement: Engagement,
): AssignmentAuthority {
	const talent = engagement.kind === "talent_services";
	const holds = talent
		? engagement.viewer_position === "hirer"
		: engagement.viewer_position === "provider";
	return {
		canAssign: holds && engagement.status === "active",
		canEnd: holds,
		self: !talent && holds,
		workerName: talent && holds ? counterpartyName(engagement) : null,
		providerSide: talent || engagement.viewer_position === "provider",
	};
}

/** "You" for the viewer's own row; the worker label otherwise ("Delivery team" when masked). */
export function assignmentWorkerName(
	row: Pick<EngagementAssignment, "worker_user_id" | "worker_label">,
	viewerId: string | null,
): string {
	if (viewerId && row.worker_user_id === viewerId) return ASSIGNMENT_COPY.you;
	return row.worker_label;
}

/** The section's one-line description, per seat. */
export function assignmentSectionDescription(engagement: Engagement): string {
	const authority = assignmentAuthority(engagement);
	if (engagement.kind === "talent_services") {
		return authority.canEnd
			? `The projects ${authority.workerName} works on under this agreement.`
			: "The projects you're assigned to under this agreement.";
	}
	return authority.self
		? "The projects you and the people you hired work on under this agreement."
		: "Who works on which of your projects under this agreement.";
}

/** The empty list. */
export function assignmentEmptyCopy(engagement: Engagement): string {
	const authority = assignmentAuthority(engagement);
	if (authority.canAssign) {
		return authority.self
			? "Assign yourself to a project to log time under this agreement."
			: `Assign ${authority.workerName} to a project so they can log time under this agreement.`;
	}
	return "No one is assigned to a project under this agreement yet.";
}

/** L25: what an assignment does to project access, said before it is made. */
export function assignmentGrantNote(authority: AssignmentAuthority): string {
	return authority.self
		? "You need editor access on the project to log time there."
		: `If you manage the project's people, ${authority.workerName} is added to it as an editor.`;
}

/** The dialog's description. */
export function assignDialogDescription(
	authority: AssignmentAuthority,
): string {
	return authority.self
		? "Pick the project you work on under this agreement."
		: `Pick the project ${authority.workerName} works on under this agreement.`;
}

/** ux.md (L25): the worker has no project access yet. */
export function accessNeededCopy(workerName: string): string {
	return `Ask a project admin to add ${workerName}.`;
}

/** ux.md (L37). `workerName` null = the viewer's own assignment. */
export function endWarningCopy(workerName: string | null): string {
	return workerName
		? `Ending this stops ${possessive(workerName)} running timer at the end time.`
		: "Ending this stops your running timer at the end time.";
}

/** What ending means, above the warning. */
export function endDialogDescription(
	workerName: string | null,
	projectTitle: string,
): string {
	return workerName
		? `After it ends, ${workerName} can't log time on ${projectTitle} under this agreement.`
		: `After it ends, you can't log time on ${projectTitle} under this agreement.`;
}

/** The success toast after an assignment. */
export function assignedToast(
	workerName: string | null,
	projectTitle: string,
): string {
	return workerName
		? `${workerName} is assigned to ${projectTitle}.`
		: `You're assigned to ${projectTitle}.`;
}

/** The success toast after an end. */
export function endedToast(projectTitle: string): string {
	return `The assignment to ${projectTitle} has ended.`;
}

export function assignmentStatusLabel(status: string): string {
	if (status === "active") return ASSIGNMENT_COPY.active;
	if (status === "cancelled") return ASSIGNMENT_COPY.cancelled;
	return ASSIGNMENT_COPY.ended;
}

/**
 * "Since Oct 5" (active), "Oct 1 – Oct 5" (ended), in the reader's timezone.
 * The year shows only when it isn't the current one.
 */
export function assignmentSpanLine(
	row: Pick<EngagementAssignment, "status" | "started_at" | "ended_at">,
	options: DateFormatOptions & { timeZone?: string } = {},
): string {
	const tz = options.timeZone ?? deviceTimeZone();
	const day = (iso: string | null) =>
		formatInstantDay(iso, tz, { ...options, userTimezone: tz });
	if (row.status === "active" || !row.ended_at) {
		return `Since ${day(row.started_at)}`;
	}
	return `${day(row.started_at)} – ${day(row.ended_at)}`;
}

/** Active first (oldest first, the server's order), then ended (latest end first). */
export function sortAssignments(rows: readonly EngagementAssignment[]): {
	active: EngagementAssignment[];
	past: EngagementAssignment[];
} {
	const active = rows.filter((row) => row.status === "active");
	const past = rows
		.filter((row) => row.status !== "active")
		.sort(
			(a, b) =>
				Date.parse(b.ended_at ?? b.started_at) -
				Date.parse(a.ended_at ?? a.started_at),
		);
	return { active, past };
}

/** `datetime-local` value → ISO instant in the browser's timezone; undefined when empty or unreadable. */
export function localInputToIso(value: string): string | undefined {
	if (!value.trim()) return undefined;
	const at = new Date(value);
	return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** Now as a `datetime-local` value (the inputs' `max`). */
export function nowLocalInput(now: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export interface AssignmentErrorContext {
	/** The worker the call was about; null = the viewer themselves. */
	workerName?: string | null;
	operation: "list" | "create" | "end";
	native?: boolean;
}

const NOT_FOUND_COPY: Record<AssignmentErrorContext["operation"], string> = {
	list: "This engagement doesn't exist or you can't open it.",
	create: "This project doesn't exist or you can't open it.",
	end: "This assignment doesn't exist or you can't open it.",
};

/**
 * What to tell people when an assignment call fails. The ux.md rows and the
 * refusals that need a name are written here; everything else goes through
 * `timeErrorCopy`, which keeps the backend's fixed sentences ("Only the
 * agreement's hirer can assign work under it.", "An assignment can't start
 * in the future.") and never shows a code or validator text.
 */
export function assignmentErrorCopy(
	error: unknown,
	ctx: AssignmentErrorContext,
): string {
	const err = toTimeApiError(error);
	const self = ctx.workerName === null || ctx.workerName === undefined;
	switch (err.code as string) {
		case "ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED":
			return ASSIGNMENT_COPY.clientQuestion;
		case "ASSIGNMENT_ALREADY_ACTIVE":
			return self
				? "You're already assigned to this project under this agreement."
				: `${ctx.workerName} is already assigned to this project under this agreement.`;
		case "ASSIGNMENT_NOT_ACTIVE":
		case "ENGAGEMENT_ASSIGNMENT_STATUS_INVALID":
			return ASSIGNMENT_COPY.alreadyEnded;
		case "ASSIGNMENT_PROJECT_LINK_REQUIRED":
			return "Ask a project admin to add this agreement to the project first.";
		case "NO_LOGGING_CONTEXT":
			return "You can't log time on this project yet. Ask a project admin for editor access.";
		case "RETROACTIVE_WINDOW":
			return "This start is further back than time can be added under this agreement.";
		default:
			break;
	}
	if (err.status === 404) return NOT_FOUND_COPY[ctx.operation];
	return timeErrorCopy(err, {
		native: ctx.native,
		subject: "scope",
		operation: ctx.operation === "list" ? "read" : "write",
	}).message;
}

/** True when the end failed because the assignment had already ended (refresh, don't retry). */
export function isAlreadyEndedError(error: unknown): boolean {
	const code = toTimeApiError(error).code as string;
	return (
		code === "ASSIGNMENT_NOT_ACTIVE" ||
		code === "ENGAGEMENT_ASSIGNMENT_STATUS_INVALID"
	);
}
