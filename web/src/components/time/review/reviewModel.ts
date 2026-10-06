// web/src/components/time/review/reviewModel.ts
//
// The pure rules behind the timesheet review screen (ux.md › Approvals ›
// Review screen). No React. The components in this folder render what these
// functions decide:
//
// - the day × project grid, with L21 redaction: hours on projects the reader
//   can't open merge into one "Projects you can't open" row;
// - the flags line ("Thu is 11h 40m · 1 entry over 10h · 2 entries added
//   later") and the entries "Show flagged" picks;
// - the header's facts, the rules line ("Rules at submit: weekly · team
//   owners & admins approve · manual time up to 7 days back", or "Rules from
//   your agreement with Acme Corp" + View terms on web);
// - the weekly-limit indicator (D65), the over-the-limit panel (L12), the
//   cost lines (L64) and the history.
//
// Strings ux.md does not give are written here in the same voice and listed
// in the W2-2 report.

import { serverNow } from "@/lib/serverClock";
import {
	formatClock,
	formatDurationText,
	formatInstantDateTime,
	formatInstantDay,
	formatLocalDay,
	formatMinutesText,
	manualTimeLine,
	periodKindLabel,
	roundingLine,
	scopePhrase,
	weekdayShort,
} from "@/lib/timeFormat";
import { eachDay, isoDow, localDate, safeTimezone } from "@/lib/timePeriods";
import type {
	ApproverScope,
	TimeEntryView,
	TimesheetAction,
	TimesheetDetail,
	TimesheetEventKind,
	TimesheetEventRow,
	TimesheetStatus,
	TimesheetSummary,
} from "@/services/time.types";
import {
	DAY_WARNING_SECONDS,
	entryAmount,
	entryMemberLabel,
	entryWorkSeconds,
	isHiddenContent,
	needsReviewReason,
} from "../entries/entryRules";

// ── Copy ────────────────────────────────────────────────────────────────────

export const REVIEW_COPY = {
	back: "← Time",
	backLabel: "Back to Time",
	gridCaption: "Hours by project and day",
	project: "Project",
	total: "Total",
	hiddenProjects: "Projects you can't open",
	noProject: "Not on a project",
	overDay: "over 8 hours",
	noTime: "No time on this timesheet yet.",
	noMatch: "No entries here. Show all entries to see the rest.",
	showFlagged: "Show flagged",
	showAll: "Show all entries",
	flaggedEntries: "flagged entries",
	entries: "Entries",
	showing: "Showing",
	history: "History",
	historyEmpty: "Nothing has happened to this timesheet yet.",
	estimatedCost: "Estimated cost:",
	finalAtApproval: "(final at approval)",
	amountAtApproval: "Amount at approval:",
	viewTerms: "View terms →",
	rulesAtSubmit: "Rules at submit:",
	openInTime: "Open in Time →",
	actionsLabel: "Timesheet actions",
	tryAgain: "Try again",
	loading: "Loading the timesheet…",
	overLimitHead: "over the limit",
} as const;

// ── Grid ────────────────────────────────────────────────────────────────────

/** The row that merges hours on projects the reader can't open (L21). */
export const HIDDEN_ROW_KEY = "__hidden__";
/** Time with no project (rare on a governed sheet). */
export const NO_PROJECT_ROW_KEY = "__none__";

export interface ReviewGridRow {
	key: string;
	label: string;
	/** True for the merged "Projects you can't open" row. */
	merged: boolean;
	/** Seconds per local date. */
	byDay: Readonly<Record<string, number>>;
	totalSeconds: number;
}

export interface ReviewGrid {
	/** Every day of the period (plus any day an entry falls on outside it). */
	days: string[];
	rows: ReviewGridRow[];
	dayTotals: Readonly<Record<string, number>>;
	totalSeconds: number;
	/** Distinct projects behind the rows (the merged row may hide several). */
	projectCount: number;
}

type SheetBasics = Pick<
	TimesheetSummary,
	"period_start" | "period_end" | "timezone"
>;

/** Which grid row an entry adds to. */
export function reviewRowKey(
	entry: Pick<TimeEntryView, "content" | "project_id" | "project">,
): string {
	if (isHiddenContent(entry)) return HIDDEN_ROW_KEY;
	return entry.project_id ?? entry.project?.id ?? NO_PROJECT_ROW_KEY;
}

/** The local date an entry counts on: its start, in the sheet's timezone. */
export function reviewDayOf(
	entry: Pick<TimeEntryView, "started_at">,
	timeZone: string,
): string | null {
	const ms = Date.parse(entry.started_at);
	if (Number.isNaN(ms)) return null;
	return localDate(new Date(ms), safeTimezone(timeZone));
}

function rowLabel(entry: TimeEntryView, key: string): string {
	if (key === HIDDEN_ROW_KEY) return REVIEW_COPY.hiddenProjects;
	if (key === NO_PROJECT_ROW_KEY) return REVIEW_COPY.noProject;
	return entry.project?.title?.trim() || REVIEW_COPY.noProject;
}

/**
 * The read-only grid: one row per project the reader can open, one merged
 * row for the rest, one column per day of the period in the sheet's
 * timezone, and totals. Running entries count their live time.
 */
export function buildReviewGrid(
	sheet: SheetBasics,
	entries: readonly TimeEntryView[],
	options: { nowMs?: number } = {},
): ReviewGrid {
	const tz = safeTimezone(sheet.timezone);
	const nowMs = options.nowMs ?? serverNow();
	const rows = new Map<
		string,
		{ key: string; label: string; byDay: Record<string, number>; total: number }
	>();
	const dayTotals: Record<string, number> = {};
	const extraDays = new Set<string>();
	const projects = new Set<string>();
	let total = 0;

	for (const entry of entries) {
		const seconds = Math.max(0, entryWorkSeconds(entry, nowMs));
		const key = reviewRowKey(entry);
		projects.add(entry.project_id ?? key);
		const day = reviewDayOf(entry, tz);
		let row = rows.get(key);
		if (!row) {
			row = { key, label: rowLabel(entry, key), byDay: {}, total: 0 };
			rows.set(key, row);
		}
		row.total += seconds;
		total += seconds;
		if (day) {
			row.byDay[day] = (row.byDay[day] ?? 0) + seconds;
			dayTotals[day] = (dayTotals[day] ?? 0) + seconds;
			if (day < sheet.period_start || day > sheet.period_end) {
				extraDays.add(day);
			}
		}
	}

	const days = [
		...eachDay({ start: sheet.period_start, end: sheet.period_end }),
		...extraDays,
	].sort();

	const rank = (key: string) =>
		key === HIDDEN_ROW_KEY ? 2 : key === NO_PROJECT_ROW_KEY ? 1 : 0;
	const ordered = [...rows.values()].sort(
		(a, b) =>
			rank(a.key) - rank(b.key) ||
			b.total - a.total ||
			a.label.localeCompare(b.label, "en"),
	);

	return {
		days,
		rows: ordered.map((row) => ({
			key: row.key,
			label: row.label,
			merged: row.key === HIDDEN_ROW_KEY,
			byDay: row.byDay,
			totalSeconds: row.total,
		})),
		dayTotals,
		totalSeconds: total,
		projectCount: projects.size,
	};
}

/** A day is flagged past 8 h (the same rule as the live day total). */
export function isOverDay(seconds: number | null | undefined): boolean {
	return (seconds ?? 0) > DAY_WARNING_SECONDS;
}

/** A grid column header: "Mon" and "22". */
export function dayColumnLabel(date: string): { weekday: string; day: string } {
	return {
		weekday: weekdayShort(isoDow(date)),
		day: String(Number(date.slice(8, 10))),
	};
}

/** A day in a sentence: "Thu" on a weekly sheet, "Thu Oct 1" otherwise. */
export function dayName(
	date: string,
	options: { weekly?: boolean; now?: Date; userTimezone?: string } = {},
): string {
	if (options.weekly) return weekdayShort(isoDow(date));
	return formatLocalDay(date, {
		weekday: true,
		now: options.now,
		userTimezone: options.userTimezone,
	});
}

/** The full day for screen readers and tooltips: "Thu Oct 1". */
export function dayFullName(
	date: string,
	options: { now?: Date; userTimezone?: string } = {},
): string {
	return formatLocalDay(date, {
		weekday: true,
		now: options.now,
		userTimezone: options.userTimezone,
	});
}

// ── Entry filter (a cell, a row, a day, or the flagged entries) ────────────

export interface ReviewFilter {
	/** A grid row (project, or the merged row). */
	rowKey?: string | null;
	/** A local date. */
	date?: string | null;
}

export function hasFilter(filter: ReviewFilter | null | undefined): boolean {
	return Boolean(filter && (filter.rowKey || filter.date));
}

/** The entries behind a cell, a row or a day; merged cells give the merged rows. */
export function filterReviewEntries(
	entries: readonly TimeEntryView[],
	filter: ReviewFilter | null | undefined,
	timeZone: string,
): TimeEntryView[] {
	if (!filter || !hasFilter(filter)) return [...entries];
	return entries.filter((entry) => {
		if (filter.rowKey && reviewRowKey(entry) !== filter.rowKey) return false;
		if (filter.date && reviewDayOf(entry, timeZone) !== filter.date) {
			return false;
		}
		return true;
	});
}

/** "Acme Website · Thu Oct 1", "Projects you can't open", "Thu Oct 1". */
export function filterLabel(
	filter: ReviewFilter,
	grid: Pick<ReviewGrid, "rows">,
	options: { now?: Date; userTimezone?: string } = {},
): string {
	const parts: string[] = [];
	if (filter.rowKey) {
		const row = grid.rows.find((r) => r.key === filter.rowKey);
		parts.push(row?.label ?? REVIEW_COPY.noProject);
	}
	if (filter.date) parts.push(dayFullName(filter.date, options));
	return parts.join(" · ");
}

// ── Flags ───────────────────────────────────────────────────────────────────

export interface ReviewFlags {
	/** Days over 8 h, in date order. */
	overDays: { date: string; seconds: number }[];
	/** Entries of 10 h or more. */
	long: number;
	/** Entries the system stopped (24 h, an agreement ending). */
	stopped: number;
	/** Entries added after their day. */
	late: number;
	/** Timers still running. */
	running: number;
	/** The entries "Show flagged" keeps: needs review, added later, running. */
	flaggedIds: ReadonlySet<string>;
}

/** Added on a later local day than it started (ux.md › Submit flow). */
export function addedLater(
	entry: Pick<TimeEntryView, "created_at" | "started_at">,
	timeZone: string,
): boolean {
	if (!entry.created_at || !entry.started_at) return false;
	const tz = safeTimezone(timeZone);
	try {
		return localDate(entry.created_at, tz) > localDate(entry.started_at, tz);
	} catch {
		return false;
	}
}

export function reviewFlags(
	sheet: SheetBasics & Partial<Pick<TimesheetSummary, "origin">>,
	entries: readonly TimeEntryView[],
	grid: Pick<ReviewGrid, "days" | "dayTotals">,
	options: { nowMs?: number } = {},
): ReviewFlags {
	const nowMs = options.nowMs ?? serverNow();
	const tz = safeTimezone(sheet.timezone);
	// Imported sheets were created long after their days; "added later" means nothing there.
	const checkLate = sheet.origin !== "legacy_migration";
	let long = 0;
	let stopped = 0;
	let late = 0;
	let running = 0;
	const flaggedIds = new Set<string>();
	for (const entry of entries) {
		const reason = needsReviewReason(entry, nowMs);
		const isLate = checkLate && addedLater(entry, tz);
		const isRunning = !entry.ended_at;
		if (reason === "long") long += 1;
		else if (reason) stopped += 1;
		if (isLate) late += 1;
		if (isRunning) running += 1;
		if (reason || isLate || isRunning) flaggedIds.add(entry.id);
	}
	const overDays = grid.days
		.filter((date) => isOverDay(grid.dayTotals[date]))
		.map((date) => ({ date, seconds: grid.dayTotals[date] ?? 0 }));
	return { overDays, long, stopped, late, running, flaggedIds };
}

function counted(n: number, one: string, many: string): string {
	return n === 1 ? one : many.replace("{n}", String(n));
}

/**
 * The flags line's parts (ux.md: "⚠ Thu is 11h 40m · 1 entry over 10h · 2
 * entries added later"). Empty when nothing is flagged.
 */
export function flagsLineParts(
	flags: ReviewFlags,
	options: { weekly?: boolean; now?: Date; userTimezone?: string } = {},
): string[] {
	const parts: string[] = [];
	if (flags.overDays.length > 0 && flags.overDays.length <= 2) {
		for (const day of flags.overDays) {
			parts.push(
				`${dayName(day.date, options)} is ${formatDurationText(day.seconds)}`,
			);
		}
	} else if (flags.overDays.length > 2) {
		parts.push(`${flags.overDays.length} days over 8h`);
	}
	if (flags.long > 0) {
		parts.push(counted(flags.long, "1 entry over 10h", "{n} entries over 10h"));
	}
	if (flags.stopped > 0) {
		parts.push(
			counted(
				flags.stopped,
				"1 timer stopped automatically",
				"{n} timers stopped automatically",
			),
		);
	}
	if (flags.late > 0) {
		parts.push(
			counted(flags.late, "1 entry added later", "{n} entries added later"),
		);
	}
	if (flags.running > 0) {
		parts.push(
			counted(
				flags.running,
				"1 timer still running",
				"{n} timers still running",
			),
		);
	}
	return parts;
}

// ── People ──────────────────────────────────────────────────────────────────

/**
 * Whose sheet this is, as this reader may see them: "Delivery team" when the
 * entries come back masked (L22), else the sheet's name snapshot. Null when
 * nothing names them.
 */
export function reviewPersonName(
	detail: Pick<TimesheetDetail, "sheet" | "entries">,
): string | null {
	const masked = detail.entries.find((e) => e.identity === "masked");
	if (masked) return entryMemberLabel(masked);
	const snapshot = detail.sheet.member_display_name_snapshot?.trim();
	if (snapshot) return snapshot;
	const first = detail.entries[0];
	return first?.member ? entryMemberLabel(first) : null;
}

/** Display names by user id, for the status sublabels ("Returned by Ana"). */
export function reviewNames(
	detail: Pick<TimesheetDetail, "sheet" | "entries" | "deciders">,
): Record<string, string | null> {
	const names: Record<string, string | null> = {};
	for (const decider of detail.deciders ?? detail.sheet.deciders ?? []) {
		names[decider.id] = decider.display_name;
	}
	const member = detail.sheet.member_user_id;
	if (member) names[member] = reviewPersonName(detail);
	return names;
}

// ── Header ──────────────────────────────────────────────────────────────────

const SUBMITTED_VERB: Record<string, string> = {
	manual: "Submitted",
	auto: "Sent automatically",
	on_deletion: "Sent when the account was closed",
	legacy: "Imported",
};

/**
 * The header's second line, after the status: "Submitted Sep 29, 10:14 ·
 * 38:15 · 3 projects" ("Submitted" follows `submission_kind`: Imported, Sent
 * automatically, Sent when the account was closed). An approved sheet whose
 * approved time differs from its logged time adds "38:00 approved".
 */
export function headerFacts(
	sheet: Pick<
		TimesheetSummary,
		| "status"
		| "submitted_at"
		| "submission_kind"
		| "timezone"
		| "payable_seconds"
	>,
	grid: Pick<ReviewGrid, "totalSeconds" | "projectCount">,
	options: { now?: Date } = {},
): string[] {
	const tz = safeTimezone(sheet.timezone);
	const facts: string[] = [];
	if (sheet.status !== "open" && sheet.submitted_at) {
		const verb =
			SUBMITTED_VERB[sheet.submission_kind ?? "manual"] ??
			SUBMITTED_VERB.manual;
		const at = formatInstantDateTime(sheet.submitted_at, tz, {
			now: options.now,
			userTimezone: tz,
		});
		if (at !== "—") facts.push(`${verb} ${at}`);
	}
	facts.push(formatClock(grid.totalSeconds));
	if (
		sheet.status === "approved" &&
		typeof sheet.payable_seconds === "number" &&
		Math.floor(sheet.payable_seconds / 60) !==
			Math.floor(grid.totalSeconds / 60)
	) {
		facts.push(`${formatClock(sheet.payable_seconds)} approved`);
	}
	if (grid.projectCount > 0) {
		facts.push(counted(grid.projectCount, "1 project", "{n} projects"));
	}
	return facts;
}

function lowerFirst(text: string): string {
	return text ? text[0].toLowerCase() + text.slice(1) : text;
}

function approverPhrase(
	scope: ApproverScope | null | undefined,
	approvalRequired: boolean | undefined,
): string | null {
	if (approvalRequired === false) return "no approval needed";
	switch (scope) {
		case "team":
			return "team owners & admins approve";
		case "workspace":
			return "workspace owners & admins approve";
		case "hirer":
			return "the hirer approves";
		case "self":
			return "approves itself";
		case "auto":
			return "no approval needed";
		default:
			return null;
	}
}

export interface RulesView {
	text: string;
	/** "View terms →" (web only; null on native or without an engagement). */
	engagementId: string | null;
}

/**
 * The rules line (L40): from `policy_snapshot`, written at submit. An
 * agreement sheet reads "Rules from your agreement with Acme Corp" (the
 * member) or "Rules from this agreement" (anyone else: the label names the
 * hirer, who may be the reader) with "View terms →" on web, whatever the
 * status, since the agreement is the rules. Any other sheet has no line
 * while it is open (no snapshot yet). The member's A1 "Goes to …" line is
 * separate and shows beside it.
 */
export function rulesView(
	detail: Pick<TimesheetDetail, "sheet" | "rules" | "routing" | "viewer">,
	options: { native?: boolean } = {},
): RulesView | null {
	const { sheet, rules } = detail;
	const agreement =
		sheet.scope_kind === "engagement" ||
		rules?.sources?.period_kind === "contract";
	if (agreement) {
		const text = detail.viewer.is_member
			? `Rules from ${scopePhrase("engagement", sheet.scope_label_snapshot)}`
			: "Rules from this agreement";
		return {
			text,
			engagementId: options.native ? null : (sheet.engagement_id ?? null),
		};
	}
	if (!rules) return null;
	const parts: string[] = [];
	if (rules.period_kind) parts.push(periodKindLabel(rules.period_kind));
	const approver = approverPhrase(
		sheet.approver_scope ?? detail.routing?.base ?? null,
		rules.approval_required,
	);
	if (approver) parts.push(approver);
	if (typeof rules.allow_manual_entries === "boolean") {
		parts.push(lowerFirst(manualTimeLine(rules)));
	}
	if (
		typeof rules.rounding_minutes === "number" &&
		rules.rounding_minutes > 0
	) {
		parts.push(lowerFirst(roundingLine(rules.rounding_minutes)));
	}
	if (parts.length === 0) return null;
	return {
		text: `${REVIEW_COPY.rulesAtSubmit} ${parts.join(" · ")}`,
		engagementId: null,
	};
}

// ── Limits and money ────────────────────────────────────────────────────────

export interface SheetLimitReading {
	/** `policy`: an indicator only (D65). `agreement`: can cut payable time (L12). */
	source: "policy" | "agreement";
	label: string | null;
	limitMinutes: number;
	loggedSeconds: number;
}

/**
 * The weekly limit the sheet was submitted under (`rules.weekly_limit_minutes`)
 * against its logged total. Weekly sheets only: only there is the sheet's
 * total the week's total.
 */
export function sheetWeeklyLimit(
	detail: Pick<TimesheetDetail, "sheet" | "rules">,
	grid: Pick<ReviewGrid, "totalSeconds">,
): SheetLimitReading | null {
	const { sheet, rules } = detail;
	const limit = rules?.weekly_limit_minutes;
	if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
		return null;
	}
	if (sheet.period_kind !== "weekly") return null;
	const agreement =
		sheet.scope_kind === "engagement" ||
		rules?.sources?.weekly_limit_minutes === "contract";
	return {
		source: agreement ? "agreement" : "policy",
		label: sheet.scope_label_snapshot?.trim() || null,
		limitMinutes: limit,
		loggedSeconds: grid.totalSeconds,
	};
}

export interface SheetOvertime {
	/** Over the cap, after per-entry rounding (the checkbox's figure). */
	overSeconds: number;
	/** Approved for payment when the box stays unticked. */
	payableSeconds: number;
	/** The sheet's time after per-entry rounding; null when the preview has none. */
	countedSeconds: number | null;
}

/**
 * Hours over a cap that cuts payable time (the agreement's weekly limit, a
 * team member's cap), from the decider's freeze preview. Null when nothing
 * is over; a policy limit never lands here (D65). Every figure is the
 * backend's: rounding happens per entry first, then the cap.
 */
export function sheetOvertime(
	detail: Pick<TimesheetDetail, "freeze_preview">,
): SheetOvertime | null {
	const preview = detail.freeze_preview;
	if (!preview || !(preview.over_cap_seconds > 0)) return null;
	let payableSeconds = 0;
	let countedSeconds = 0;
	for (const entry of preview.entries ?? []) {
		payableSeconds += Math.max(0, entry.payable_seconds ?? 0);
		countedSeconds += Math.max(0, entry.rounded_seconds ?? 0);
	}
	return {
		overSeconds: preview.over_cap_seconds,
		payableSeconds,
		countedSeconds: countedSeconds > 0 ? countedSeconds : null,
	};
}

/**
 * The over-the-limit panel's head. The agreement's cap reads like the
 * weekly-limit line ("Weekly limit 40h in the agreement with Acme Corp ·
 * 43:30 logged · 3:30 over"), but from the freeze preview: the time after
 * rounding and the hours over, so it agrees with the checkbox under it. A
 * member cap reads "2:00 over the limit".
 */
export function overLimitHead(
	overtime: Pick<SheetOvertime, "overSeconds"> &
		Partial<Pick<SheetOvertime, "countedSeconds">>,
	reading?: SheetLimitReading | null,
): string {
	if (reading?.source !== "agreement") {
		return `${formatClock(overtime.overSeconds)} ${REVIEW_COPY.overLimitHead}`;
	}
	const label = reading.label?.trim();
	const where = label ? ` in the agreement with ${label}` : " in the agreement";
	const logged = overtime.countedSeconds ?? reading.loggedSeconds;
	return `Weekly limit ${formatMinutesText(reading.limitMinutes)}${where} · ${formatClock(logged)} logged · ${formatClock(overtime.overSeconds)} over`;
}

export interface SheetCost {
	/** `estimate` before approval ("Estimated cost"), `final` after ("Amount at approval"). */
	kind: "estimate" | "final";
	amounts: Record<string, number>;
}

/**
 * The sheet's money (L64), per currency, never summed across currencies:
 * the decider's freeze preview when it carries amounts (it does only when
 * the decider may read every entry's money), otherwise the entries' own
 * amounts when every entry's cost is visible. Null otherwise. Native and
 * agreement rules are applied where it renders (`AmountLines`).
 */
export function sheetCost(
	detail: Pick<TimesheetDetail, "sheet" | "entries" | "freeze_preview">,
	options: { nowMs?: number } = {},
): SheetCost | null {
	const final = detail.sheet.status === "approved";
	if (!final && detail.freeze_preview) {
		const amounts = detail.freeze_preview.amounts_by_currency;
		if (!amounts || Object.keys(amounts).length === 0) return null;
		return { kind: "estimate", amounts: { ...amounts } };
	}
	const entries = detail.entries;
	if (entries.length === 0) return null;
	if (!entries.every((entry) => entry.cost === "visible")) return null;
	const amounts: Record<string, number> = {};
	for (const entry of entries) {
		const amount = entryAmount(entry, options.nowMs);
		if (!amount) continue;
		if (final && !amount.final) continue;
		amounts[amount.currency] =
			Math.round(((amounts[amount.currency] ?? 0) + amount.amount) * 100) / 100;
	}
	if (Object.keys(amounts).length === 0) return null;
	return { kind: final ? "final" : "estimate", amounts };
}

// ── History ─────────────────────────────────────────────────────────────────

const EVENT_TEXT: Record<TimesheetEventKind, string> = {
	legacy_import: "Imported from per-entry review",
	submitted: "Submitted",
	auto_submitted: "Sent automatically",
	withdrawn: "Withdrawn",
	approved: "Approved",
	returned: "Returned",
	reopened: "Reopened",
	reopen_requested: "Asked to reopen",
};

export interface HistoryItem {
	id: string;
	/** "Returned", "Resubmitted", "Imported from per-entry review". */
	text: string;
	/** The event's instant (for `<time dateTime>`). */
	at: string;
	/** "Sep 30" in the sheet's timezone. */
	day: string;
	/** "Sep 30, 10:14", for the tooltip. */
	when: string;
	note: string | null;
}

/**
 * The history line (ux.md: "Imported from per-entry review Sep 29 · Returned
 * Sep 30 'Split Thu' · Resubmitted Oct 1"), oldest first. A submit after a
 * return reads "Resubmitted".
 */
export function historyItems(
	events: readonly TimesheetEventRow[] | null | undefined,
	options: { timeZone: string; now?: Date },
): HistoryItem[] {
	const tz = safeTimezone(options.timeZone);
	const dateOptions = { now: options.now, userTimezone: tz };
	return [...(events ?? [])]
		.sort(
			(a, b) =>
				a.created_at.localeCompare(b.created_at) || Number(a.id) - Number(b.id),
		)
		.map((event) => {
			const text =
				event.event === "submitted" && event.from_status === "returned"
					? "Resubmitted"
					: (EVENT_TEXT[event.event] ?? "Changed");
			return {
				id: String(event.id),
				text,
				at: event.created_at,
				day: formatInstantDay(event.created_at, tz, dateOptions),
				when: formatInstantDateTime(event.created_at, tz, dateOptions),
				note: event.note?.trim() || null,
			};
		});
}

// ── Actions ─────────────────────────────────────────────────────────────────

export type ReviewButtonId =
	| "submit"
	| "withdraw"
	| "request_reopen"
	| "reopen"
	| "return"
	| "approve";

export interface ReviewButton {
	id: ReviewButtonId;
	label: string;
	primary: boolean;
}

const BUTTON_ORDER: readonly ReviewButtonId[] = [
	"submit",
	"withdraw",
	"request_reopen",
	"reopen",
	"return",
	"approve",
];

/**
 * The buttons `viewer.actions` allows, in reading order (the primary one
 * last): the decider's "Return…" and "Approve…" (ux.md: [Return…]
 * [Approve…]); the submitter's Withdraw, Reopen or Ask to reopen in their
 * place; and Submit / Resubmit on the member's own open or returned sheet.
 */
export function reviewButtons(
	actions: readonly TimesheetAction[] | null | undefined,
	status: TimesheetStatus,
): ReviewButton[] {
	const allowed = new Set(actions ?? []);
	const out: ReviewButton[] = [];
	for (const id of BUTTON_ORDER) {
		if (!allowed.has(id)) continue;
		switch (id) {
			case "submit":
				out.push({
					id,
					label: status === "returned" ? "Resubmit" : "Submit",
					primary: true,
				});
				break;
			case "withdraw":
				out.push({ id, label: "Withdraw", primary: false });
				break;
			case "request_reopen":
				out.push({ id, label: "Ask to reopen", primary: false });
				break;
			case "reopen":
				out.push({ id, label: "Reopen", primary: false });
				break;
			case "return":
				out.push({ id, label: "Return…", primary: false });
				break;
			case "approve":
				out.push({ id, label: "Approve…", primary: true });
				break;
		}
	}
	return out;
}

/**
 * The project an invoice refusal is about: a billed entry's project, else the
 * sheet's only project. Null when the sheet spans several and none is marked
 * billed yet (the page loaded before the billing).
 */
function invoiceProjectOf(
	entries: readonly Pick<TimeEntryView, "locked_reason" | "project_id">[],
): string | null {
	const billed = entries.find(
		(entry) => entry.locked_reason === "billed" && entry.project_id,
	);
	if (billed?.project_id) return billed.project_id;
	const projects = new Set(
		entries
			.map((entry) => entry.project_id)
			.filter((id): id is string => Boolean(id)),
	);
	return projects.size === 1 ? [...projects][0] : null;
}

/**
 * Where a settled refusal's payout or invoice lives (web only; the dialog
 * drops it on native). An invoice goes to its project's Invoices tab, where
 * a draft is edited and an issued one voided (the invoice editor needs the
 * project and can't void); without a project, to the invoices hub.
 */
export function settledHrefFor(
	sheet: Pick<TimesheetSummary, "team_id">,
	entries: readonly Pick<TimeEntryView, "locked_reason" | "project_id">[] = [],
): (link: { kind: "payout" | "invoice"; id: string }) => string | null {
	return (link) => {
		if (link.kind === "invoice") {
			const projectId = invoiceProjectOf(entries);
			return projectId
				? `/engagements/finance/invoices?projectId=${encodeURIComponent(projectId)}`
				: "/engagements/finance/invoices";
		}
		return sheet.team_id
			? `/teams/${encodeURIComponent(sheet.team_id)}/time/payouts`
			: null;
	};
}

/** The newest event, for telling the reader's own change from someone else's. */
export function latestEvent(
	events: readonly TimesheetEventRow[] | null | undefined,
): TimesheetEventRow | null {
	let latest: TimesheetEventRow | null = null;
	for (const event of events ?? []) {
		if (
			!latest ||
			event.created_at > latest.created_at ||
			(event.created_at === latest.created_at &&
				Number(event.id) > Number(latest.id))
		) {
			latest = event;
		}
	}
	return latest;
}
