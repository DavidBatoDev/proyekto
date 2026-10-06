// Project › Time and Project settings › Time: the pure parts (ux.md › Reports
// › Project › Time page, Project Surfaces, Routes and Redirects).
//
// - The route's search (`view` plus the report filters) and the two legacy
//   redirects: `?view=team` → `everyone`, `?view=mine` → `/time?project=`.
// - Which view a caller gets (L22): Everyone needs `time.view_team_logs`,
//   Client hours needs a client-hours level other than `none`; someone who
//   only logs here belongs on their own Time page.
// - Client agreements on the project and the level each lets the client see.
// - "Who can log time here" lines (A11).
// - Every sentence these surfaces write. None of them says contract, rate,
//   payout or invoice: these pages are on the app too (`/project` is `app`).

import type { ProjectTimeAccess } from "@/lib/projectPermissions";
import {
	isIsoDate,
	isUuid,
	type TeamTimeReportSearch,
	validateTeamTimeReportSearch,
} from "@/lib/timeSearch";
import type { Engagement } from "@/services/engagement.service";
import type { ClientHoursLevel, ProjectLogger } from "@/services/time.types";

// ── Copy ────────────────────────────────────────────────────────────────────

export const PROJECT_TIME_COPY = {
	title: "Time",
	yourTime: "Your time on this project",
	viewGroup: "Time view",
	everyone: "Everyone",
	client: "Client hours",
	clientHint:
		"Approved hours from the delivery team, at the detail your agreement allows.",
	linkCardTitle: "Your time on this project lives in Time.",
	open: "Open",
	deniedTitle: "Time on this project isn't open to you.",
	deniedDetail: "Ask a project admin if you need to see it.",
	accessLoadError: "Proyekto couldn't check your access to this project.",
	emptyTitle: "No time on this project yet.",
	emptyDetail: "Editors and above can track time here.",
	whoCanLogLink: "Who can log time here",
	clientLoadError: "Proyekto couldn't load your client agreements.",
	retry: "Try again",
	teamMoney: "Team money",
	payouts: "Payouts",
	rates: "Rates",
} as const;

export const PROJECT_TIME_SETTINGS_COPY = {
	title: "Time",
	noAccessTitle: "You don't have access",
	noAccessDetail:
		"Seeing who logs time here and setting hour limits needs permission to see everyone's time on this project.",
	whoCanLog: "Who can log time here",
	whoCanLogIntro: "Next to each person: where their time goes by default.",
	whoCanLogFooter: "Viewers and commenters can't log time.",
	whoCanLogEmpty: "Nobody can log time here yet. Editors and above can.",
	whoCanLogTruncated:
		"More than 200 people can log time here. The first 200 are listed.",
	you: "You",
	cannotLogNow: "nothing to log for right now",
	clientSees: "Client sees",
	clientSeesIntro:
		"What a client sees of approved time on this project, from each client agreement's terms. It can't be changed here.",
	clientSeesNone:
		"None of the client agreements you're part of covers this project.",
	clientSeesTerms: "These come from the signed terms.",
	viewTerms: "View terms",
	clientLoadError: "Proyekto couldn't load the client agreements.",
	hourLimits: "Hour limits",
	hourLimitsIntro:
		"Cap how many hours each person can track on this project each week or month. Leave blank for no limit.",
	weekly: "Weekly",
	monthly: "Monthly",
	hoursSuffix: "hours",
	blockLabel: "Block time past a limit (otherwise people just get a warning)",
	save: "Save",
	saving: "Saving…",
	saved: "Hour limits saved",
	noLimitRecordWeb:
		"No rate on this project yet. Add one in the team's Rates first.",
	noLimitRecordNative: "Set up hour limits for this person on the web.",
	noTeam:
		"No team is attached to this project yet. Attach one under Settings › Teams to set hour limits.",
	noMembers:
		"No team members are on this project yet. Add them under Settings › Teams.",
	retry: "Try again",
} as const;

/** What the client sees at each level (ux.md › Reports › Client hours view). */
export const CLIENT_LEVEL_COPY: Record<ClientHoursLevel, string> = {
	none: "No hours (client hours are off in the terms)",
	summary: "Hours by week",
	detailed: "Each entry's date, task and hours",
};

// ── Search ──────────────────────────────────────────────────────────────────

export const PROJECT_TIME_VIEWS = ["everyone", "client"] as const;
export type ProjectTimeView = (typeof PROJECT_TIME_VIEWS)[number];

/** Old spellings kept only long enough to redirect (ux.md › Routes and Redirects). */
const LEGACY_VIEWS = ["team", "mine"] as const;
type LegacyView = (typeof LEGACY_VIEWS)[number];

/**
 * `/project/$projectId/time`. The report filters are the team report's
 * (person, For, status, range); `project` and `group` are dropped, because
 * the scope already is the project and the Everyone view is laid out in
 * sections, not groups.
 */
export interface ProjectTimeSearch
	extends Omit<TeamTimeReportSearch, "project" | "group"> {
	view?: ProjectTimeView | LegacyView;
}

export function validateProjectTimeSearch(
	search: Record<string, unknown>,
): ProjectTimeSearch {
	const {
		project: _project,
		group: _group,
		...report
	} = validateTeamTimeReportSearch(search);
	const raw = typeof search.view === "string" ? search.view.trim() : "";
	const view = (
		[...PROJECT_TIME_VIEWS, ...LEGACY_VIEWS] as readonly string[]
	).includes(raw)
		? (raw as ProjectTimeSearch["view"])
		: undefined;
	return view ? { ...report, view } : report;
}

export type ProjectTimeRedirect =
	| { kind: "view"; search: ProjectTimeSearch }
	| { kind: "mine"; project: string | undefined };

/**
 * The redirects a URL alone decides, for the route's `beforeLoad`:
 * `?view=team` → `?view=everyone` (other params kept); `?view=mine` → the
 * caller's own Time page filtered to this project.
 */
export function projectTimeRedirect(
	search: ProjectTimeSearch,
	projectId: string,
): ProjectTimeRedirect | null {
	if (search.view === "team") {
		return { kind: "view", search: { ...search, view: "everyone" } };
	}
	if (search.view === "mine") {
		return { kind: "mine", project: isUuid(projectId) ? projectId : undefined };
	}
	return null;
}

// ── Which view ──────────────────────────────────────────────────────────────

export type ProjectTimeOutcome =
	| { kind: "view"; view: ProjectTimeView; views: ProjectTimeView[] }
	/** Logs here (`time.log`) and asked for nothing: off to Time. */
	| { kind: "redirect_mine" }
	/** Logs here, but asked for a view they can't open: a link card. */
	| { kind: "link_card" }
	| { kind: "denied" };

/** The views a caller may open, Everyone first. */
export function availableProjectTimeViews(
	access: ProjectTimeAccess,
): ProjectTimeView[] {
	const views: ProjectTimeView[] = [];
	if (access.everyone) views.push("everyone");
	if (access.client) views.push("client");
	return views;
}

export function resolveProjectTimeView(
	access: ProjectTimeAccess,
	requested: ProjectTimeSearch["view"],
): ProjectTimeOutcome {
	const views = availableProjectTimeViews(access);
	const asked =
		requested === "everyone" || requested === "client" ? requested : undefined;
	if (asked && views.includes(asked)) {
		return { kind: "view", view: asked, views };
	}
	if (views.length > 0) return { kind: "view", view: views[0], views };
	// The route gate is the nav composite (ux.md › Project › Time: `time.log`
	// OR `time.view_team_logs` OR a client level other than `none`). Holding
	// `access.time` alone (a viewer or commenter, P10) is not enough: they get
	// the refusal card, not a hop to a Time page whose item they can't see.
	if (!access.canLog) return { kind: "denied" };
	return asked ? { kind: "link_card" } : { kind: "redirect_mine" };
}

// ── Client agreements ───────────────────────────────────────────────────────

export function normaliseClientLevel(value: unknown): ClientHoursLevel {
	return value === "summary" || value === "detailed" ? value : "none";
}

/** The other party's name, as the viewer may see it. */
export function counterpartyLabel(engagement: Engagement): string {
	const party = engagement.counterparty;
	return (
		party?.team_name_snapshot?.trim() ||
		party?.display_name_snapshot?.trim() ||
		"the other party"
	);
}

function linksProject(engagement: Engagement, projectId: string): boolean {
	return engagement.project_links.some(
		(link) => link.project_id === projectId && link.status === "active",
	);
}

export interface ClientAgreementRow {
	engagementId: string;
	label: string;
	level: ClientHoursLevel;
	viewerPosition: Engagement["viewer_position"];
}

/** Active client agreements linked to the project, as the viewer sees them. */
export function clientAgreementRows(
	engagements: readonly Engagement[] | undefined,
	projectId: string,
): ClientAgreementRow[] {
	return (engagements ?? [])
		.filter(
			(e) =>
				e.kind === "client_services" &&
				e.status === "active" &&
				linksProject(e, projectId),
		)
		.map((e) => ({
			engagementId: e.id,
			label: counterpartyLabel(e),
			level: normaliseClientLevel(
				e.current_settings?.client_hours_detail_level,
			),
			viewerPosition: e.viewer_position,
		}));
}

/**
 * The agreements whose hours the caller reads as the client: hirer seats at a
 * level other than `none` (the same rule as `time_client_hours_level`).
 */
export function clientHoursAgreements(
	engagements: readonly Engagement[] | undefined,
	projectId: string,
): Array<{
	engagementId: string;
	label: string;
	level: "summary" | "detailed";
}> {
	return clientAgreementRows(engagements, projectId).flatMap((row) =>
		row.viewerPosition === "hirer" && row.level !== "none"
			? [{ engagementId: row.engagementId, label: row.label, level: row.level }]
			: [],
	);
}

// ── Who can log time here (A11) ─────────────────────────────────────────────

export function isMaskedLogger(logger: ProjectLogger): boolean {
	return logger.user_id.startsWith("masked:");
}

/**
 * One person's line: "Maria (Prodigitality Services Inc. Team)",
 * "You (editor · just you)", "Leo (agreement with Pixel Studio)".
 */
export function loggerLine(
	logger: ProjectLogger,
	ctx: { selfId?: string | null } = {},
): { name: string; detail: string; self: boolean } {
	const self = Boolean(ctx.selfId) && logger.user_id === ctx.selfId;
	const name = self
		? PROJECT_TIME_SETTINGS_COPY.you
		: logger.display_name?.trim() || "Unnamed person";
	const label =
		logger.reason === "none" || !logger.label.trim()
			? PROJECT_TIME_SETTINGS_COPY.cannotLogNow
			: logger.label.trim();
	const extra =
		typeof logger.options === "number" && logger.options > 1
			? ` · or ${logger.options - 1} other ${logger.options - 1 === 1 ? "choice" : "choices"}`
			: "";
	const role = self && logger.role ? `${logger.role} · ` : "";
	return { name, detail: `${role}${label}${extra}`, self };
}

// ── Misc ────────────────────────────────────────────────────────────────────

/** Tomorrow's local date in the reader's zone: the end of an "all time" probe. */
export function probeEndDate(now: Date = new Date()): string {
	const next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
	const y = next.getFullYear();
	const m = String(next.getMonth() + 1).padStart(2, "0");
	const d = String(next.getDate()).padStart(2, "0");
	const out = `${y}-${m}-${d}`;
	return isIsoDate(out) ? out : "2100-01-01";
}
