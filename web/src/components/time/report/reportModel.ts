/**
 * The report kit's pure logic (ux.md › Reports): ranges, the query each view
 * sends, the Approved / Not yet approved split, the native amount rule, row
 * labels and the per-context sections of the project's Everyone view.
 *
 * Totals (L11, CHANGE-5):
 * - **Approved** sums `payable_seconds`.
 * - **Not yet approved** sums the duration of entries with no
 *   `payable_seconds`. It is shown on its own and is never added to Approved
 *   or to money.
 * - **Cost** sums `amount_snapshot`; the server only counts rows the viewer
 *   may see cost on, and native never shows an amount on agreement time.
 *
 * `reports/summary` answers `total_seconds` (every logged second) and
 * `payable_seconds` (approved). Not yet approved is read from
 * `unapproved_seconds` when the backend sends it; until then it is derived
 * from a second summary filtered to approved sheets. Approval freezes
 * `payable_seconds` on every entry of the sheet and reopen clears it, so an
 * entry has `payable_seconds` exactly when its sheet is approved, and
 * `total(all) − total(approved sheets)` is the not-yet-approved duration.
 * A status filter makes the second call unnecessary.
 */

import { isNativeApp } from "@/lib/platform";
import {
	CHIP_LABEL_MAX,
	contextSectionLabel,
	type DateFormatOptions,
	formatLocalDay,
	formatPeriodRange,
	labelWithTitle,
	sheetScopeLabel,
	workItemLabel,
} from "@/lib/timeFormat";
import {
	addDays,
	isLocalDate,
	monthWindow,
	safeTimezone,
	todayIn,
	weekWindow,
} from "@/lib/timePeriods";
import {
	isUuid,
	type TeamTimeReportSearch,
	type TimeReportForKind,
	type TimeReportGroup,
	type TimeReportStatus,
	timeReportGroupBy,
} from "@/lib/timeSearch";
import type {
	ContextKind,
	ReportExportQuery,
	ReportGroupBy,
	ReportQuery,
	ReportScopeKind,
	ReportScopeRef,
	ReportSummary,
	ReportSummaryGroup,
	TimeEntryView,
	TimesheetStatus,
} from "@/services/time.types";
import type { Workspace } from "@/services/workspaces.service";

// ── Copy ────────────────────────────────────────────────────────────────────

/** Every sentence the report kit writes itself (ux.md › Reports, Copy). */
export const REPORT_COPY = {
	approved: "Approved",
	notApproved: "Not yet approved",
	notApprovedHint: "Not part of Approved or cost until it is approved.",
	billable: "Billable",
	cost: "Cost",
	hoursOnly: "hours only",
	logged: "logged",
	noTime: "No time in this range.",
	noApprovedTime: "No approved time in this range.",
	entries: "Entries",
	deliveryTeam: "Delivery team",
	hiddenProject: "A project you can't open",
	unknownPerson: "Unknown",
	running: "Running",
	underAgreements: "Under agreements",
	underAgreementsHint:
		"Logged under agreements on this team's projects, and approved under those agreements, not by this team.",
	capped:
		"Showing the first 10,000 entries. Pick a shorter range to see the rest.",
	retry: "Try again",
	export: "Export",
	exportCsv: "CSV",
	exportXlsx: "Excel (.xlsx)",
	exporting: "Preparing your file…",
	previousPage: "Previous page",
	nextPage: "Next page",
	allPeople: "All people",
	allStatuses: "All statuses",
	allFor: "For: all",
	selectedPerson: "Selected person",
	timesheets: "Timesheets",
	timesheet: "Timesheet",
} as const;

/** "Days are counted in Asia/Manila." (shown when it isn't the reader's zone). */
export function timezoneCaption(timezone: string): string {
	return `Days are counted in ${timezone}.`;
}

/** "1–50 of 312". */
export function pageRangeLabel(
	page: number,
	pageSize: number,
	total: number,
): string {
	if (total <= 0) return "0 of 0";
	const first = (page - 1) * pageSize + 1;
	const last = Math.min(total, page * pageSize);
	return `${first.toLocaleString("en-US")}–${last.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`;
}

export const REPORT_GROUP_LABEL: Record<TimeReportGroup, string> = {
	person: "Group by person",
	project: "Group by project",
	task: "Group by task",
	day: "Group by day",
	week: "Group by week",
};

/** The first column's header for each API grouping. */
export const REPORT_GROUP_HEADER: Record<ReportGroupBy, string> = {
	member: "Person",
	project: "Project",
	task: "Task",
	day: "Day",
	week: "Week",
	context: "For",
};

export const REPORT_STATUS_LABEL: Record<TimesheetStatus, string> = {
	open: "Open",
	submitted: "Submitted",
	returned: "Returned",
	approved: "Approved",
};

export const REPORT_FOR_LABEL: Record<TimeReportForKind, string> = {
	team: "For: team",
	workspace: "For: workspace",
	assignment: "For: agreement",
};

/**
 * The workspace whose plan covers a report (team scope: the team's workspace;
 * workspace scope: itself). `slug` and `my_role` give the plan notice its call
 * to action; `name` its sentence.
 */
export type ReportPlanWorkspace = Pick<Workspace, "id"> &
	Partial<Pick<Workspace, "name" | "slug" | "my_role">>;

/** PlanLimitNotice's `workspace` prop for a plan workspace (null without a slug). */
export function noticeWorkspace(
	workspace: ReportPlanWorkspace | null | undefined,
): Pick<Workspace, "slug" | "my_role"> | null {
	return workspace?.slug
		? { slug: workspace.slug, my_role: workspace.my_role ?? null }
		: null;
}

// ── Sizes ───────────────────────────────────────────────────────────────────

/** Rows per page of the entries table. */
export const REPORT_ENTRIES_PAGE_SIZE = 50;
/** The most entries a sections view walks (the export cap, D-backend). */
export const REPORT_ENTRIES_CAP = 10_000;

// ── Ranges ──────────────────────────────────────────────────────────────────

export type TimeReportSearch = TeamTimeReportSearch;

/** An inclusive range of local dates in the scope's policy timezone. */
export interface ReportRange {
	from: string;
	to: string;
}

export type ReportPreset =
	| "this_week"
	| "this_month"
	| "this_year"
	| "all_time";

export const REPORT_PRESETS: readonly ReportPreset[] = [
	"this_week",
	"this_month",
	"this_year",
	"all_time",
];

export interface RangeContext {
	/** The scope's policy timezone when known, else the reader's. */
	timezone: string;
	/** ISO week start (1 = Monday). */
	weekStart?: number | null;
	now?: Date;
}

/** The first day "All time" reaches back to. */
export const ALL_TIME_START = "2000-01-01";

function normalWeekStart(weekStart: number | null | undefined): number {
	return typeof weekStart === "number" &&
		Number.isInteger(weekStart) &&
		weekStart >= 1 &&
		weekStart <= 7
		? weekStart
		: 1;
}

/** A preset's dates, in the scope's timezone and week. */
export function presetRange(
	preset: ReportPreset,
	ctx: RangeContext,
): ReportRange {
	const today = todayIn(safeTimezone(ctx.timezone), ctx.now);
	switch (preset) {
		case "this_week": {
			const week = weekWindow(today, normalWeekStart(ctx.weekStart));
			return { from: week.start, to: week.end };
		}
		case "this_year": {
			const year = today.slice(0, 4);
			return { from: `${year}-01-01`, to: `${year}-12-31` };
		}
		case "all_time":
			return { from: ALL_TIME_START, to: today };
		default: {
			const month = monthWindow(today);
			return { from: month.start, to: month.end };
		}
	}
}

/** The preset a range is exactly, if any (for highlighting it). */
export function matchPreset(
	range: ReportRange,
	ctx: RangeContext,
): ReportPreset | null {
	for (const preset of REPORT_PRESETS) {
		const candidate = presetRange(preset, ctx);
		if (candidate.from === range.from && candidate.to === range.to) {
			return preset;
		}
	}
	return null;
}

/** The report's default range: this month. */
export function defaultReportRange(ctx: RangeContext): ReportRange {
	return presetRange("this_month", ctx);
}

/**
 * The range a search asks for. Both ends given: that range (swapped when
 * inverted). Only `from`: from then to today (or that day when it is later).
 * Only `to`: that month up to `to`. Neither: this month.
 */
export function reportRangeFrom(
	search: Pick<TimeReportSearch, "from" | "to">,
	ctx: RangeContext,
): ReportRange {
	const from = isLocalDate(search.from) ? search.from : null;
	const to = isLocalDate(search.to) ? search.to : null;
	if (from && to) return from <= to ? { from, to } : { from: to, to: from };
	if (from) {
		const today = todayIn(safeTimezone(ctx.timezone), ctx.now);
		return { from, to: from > today ? from : today };
	}
	if (to) return { from: monthWindow(to).start, to };
	return defaultReportRange(ctx);
}

// ── Queries ─────────────────────────────────────────────────────────────────

export type ReportFilterQuery = Omit<
	ReportQuery,
	"group_by" | "page" | "limit"
>;

/** The filters every call of one report shares (no grouping, no page). */
export function reportFilterQuery(
	scope: ReportScopeRef,
	search: TimeReportSearch,
	range: ReportRange,
): ReportFilterQuery {
	const query: ReportFilterQuery = {
		scope,
		from: range.from,
		to: range.to,
	};
	if (search.person) query.member_user_id = search.person;
	if (search.status) query.status = search.status;
	if (search.for) query.context_kind = search.for;
	return query;
}

/** The API grouping for a UI group (`person` is `member`). */
export function reportGroupBy(
	group: TimeReportGroup | undefined,
	fallback: TimeReportGroup = "person",
): ReportGroupBy {
	return timeReportGroupBy(group ?? fallback);
}

export function summaryQuery(
	filters: ReportFilterQuery,
	groupBy: ReportGroupBy,
): ReportQuery {
	return { ...filters, group_by: groupBy };
}

/** The summary of approved sheets only, for the Not yet approved split. */
export function approvedSummaryQuery(
	filters: ReportFilterQuery,
	groupBy: ReportGroupBy,
): ReportQuery {
	return { ...filters, status: "approved", group_by: groupBy };
}

/** Who logged in the range, for the Person filter (no person or status filter). */
export function peopleSummaryQuery(filters: ReportFilterQuery): ReportQuery {
	const query: ReportQuery = {
		scope: filters.scope,
		from: filters.from,
		to: filters.to,
		group_by: "member",
	};
	if (filters.context_kind) query.context_kind = filters.context_kind;
	return query;
}

export function entriesPageQuery(
	filters: ReportFilterQuery,
	page: number,
	limit: number = REPORT_ENTRIES_PAGE_SIZE,
): ReportQuery {
	return { ...filters, page, limit };
}

/** D81: `group_by` shapes only the summary; an export is always one row per entry. */
export function exportQuery(
	filters: ReportFilterQuery,
	groupBy?: ReportGroupBy,
): ReportExportQuery {
	return groupBy ? { ...filters, group_by: groupBy } : { ...filters };
}

// ── Approved / Not yet approved ─────────────────────────────────────────────

/**
 * How Not yet approved is found:
 * - `derive`: no status filter, so a second summary of approved sheets is read;
 * - `all_approved`: the status filter is Approved, so nothing is pending;
 * - `none_approved`: Open, Submitted or Returned, so all of it is pending;
 * - `approved_only`: the client's view, which only ever holds approved time.
 */
export type ApprovalSplit =
	| "derive"
	| "all_approved"
	| "none_approved"
	| "approved_only";

export function approvalSplitFor(
	status: TimeReportStatus | undefined,
	clientView = false,
): ApprovalSplit {
	if (clientView) return "approved_only";
	if (!status) return "derive";
	return status === "approved" ? "all_approved" : "none_approved";
}

/** Fields the report reads from `reports/summary` when the backend sends them. */
interface SummaryExtras {
	unapproved_seconds?: unknown;
	billable_seconds?: unknown;
}

function seconds(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, value)
		: null;
}

export interface ReportFigures {
	approvedSeconds: number;
	/** Null while the split is loading, and in the client's view. */
	notApprovedSeconds: number | null;
	/** Null when the backend does not say (see the W1-5 report). */
	billableSeconds: number | null;
	/** Per currency, rounded to cents; null when no cost is visible. */
	amounts: Record<string, number> | null;
}

export interface ReportRow extends ReportFigures {
	key: string;
	label: string;
}

function notApprovedOf(
	all: { total_seconds: number } & SummaryExtras,
	approvedPart: { total_seconds: number } | undefined,
	split: ApprovalSplit,
	approvedLoaded: boolean,
): number | null {
	const direct = seconds(all.unapproved_seconds);
	if (direct !== null && split !== "approved_only") return direct;
	switch (split) {
		case "approved_only":
			return null;
		case "all_approved":
			return 0;
		case "none_approved":
			return Math.max(0, all.total_seconds);
		default:
			if (!approvedLoaded) return null;
			return Math.max(
				0,
				all.total_seconds - (approvedPart?.total_seconds ?? 0),
			);
	}
}

function roundCents(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}

function cleanAmounts(
	amounts: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, number> | null {
	if (!amounts) return null;
	const out: Record<string, number> = {};
	for (const [currency, value] of Object.entries(amounts)) {
		if (typeof value === "number" && Number.isFinite(value)) {
			const code = currency.trim().toUpperCase() || "USD";
			out[code] = roundCents((out[code] ?? 0) + value);
		}
	}
	return Object.keys(out).length > 0 ? out : null;
}

function addAmounts(
	into: Record<string, number>,
	amounts: Readonly<Record<string, number>> | null,
): void {
	if (!amounts) return;
	for (const [currency, value] of Object.entries(amounts)) {
		into[currency] = roundCents((into[currency] ?? 0) + value);
	}
}

/**
 * The totals and rows of a summary. `approved` is the approved-sheets summary
 * (`derive` only; undefined while it loads). Approved and Not yet approved
 * stay apart; nothing here adds them up.
 */
export function reportFigures(
	summary: ReportSummary,
	approved: ReportSummary | null | undefined,
	split: ApprovalSplit,
): { totals: ReportFigures; rows: ReportRow[] } {
	const approvedLoaded = split !== "derive" || Boolean(approved);
	const approvedGroups = new Map<string, ReportSummaryGroup>(
		(approved?.groups ?? []).map((g) => [g.key, g]),
	);
	const total: Record<string, number> = {};
	const rows: ReportRow[] = summary.groups.map((group) => {
		const amounts = cleanAmounts(group.amounts_by_currency);
		addAmounts(total, amounts);
		const extras = group as ReportSummaryGroup & SummaryExtras;
		return {
			key: group.key,
			label: group.label,
			approvedSeconds: Math.max(0, group.payable_seconds ?? 0),
			notApprovedSeconds: notApprovedOf(
				extras,
				approvedGroups.get(group.key),
				split,
				approvedLoaded,
			),
			billableSeconds: seconds(extras.billable_seconds),
			amounts,
		};
	});
	const extras = summary as ReportSummary & SummaryExtras;
	return {
		totals: {
			approvedSeconds: Math.max(0, summary.payable_seconds ?? 0),
			notApprovedSeconds: notApprovedOf(
				extras,
				approved ?? undefined,
				split,
				approvedLoaded,
			),
			billableSeconds: seconds(extras.billable_seconds),
			amounts: Object.keys(total).length > 0 ? total : null,
		},
		rows,
	};
}

// ── Native amounts ──────────────────────────────────────────────────────────

/**
 * Whether summary amounts may show (the server already left out rows whose
 * cost the viewer may not see). Native never shows an amount on agreement
 * time: a team report holds team time only, and a `context` row names its
 * kind; any other mix could hold agreement time, so native hides it.
 */
export function reportAmountsAllowed(options: {
	scopeKind: ReportScopeKind;
	groupBy?: ReportGroupBy;
	rowKey?: string;
	native?: boolean;
}): boolean {
	const native = options.native ?? isNativeApp();
	if (!native) return true;
	if (options.scopeKind === "team") return true;
	if (options.groupBy === "context" && options.rowKey) {
		const kind = options.rowKey.split(":")[0];
		return kind === "team" || kind === "workspace";
	}
	return false;
}

// ── Row labels ──────────────────────────────────────────────────────────────

const SECTION_KINDS = new Set(["team", "workspace", "assignment"]);

/**
 * What a summary row reads. Days read "Thu Oct 2", weeks "Sep 22–28" (A5's
 * key is the week's first day; the year only when it isn't this year), For
 * rows "Acme · workspace"; the rest are the server's label.
 */
export function groupRowLabel(
	groupBy: ReportGroupBy,
	row: { key: string; label: string },
	options: DateFormatOptions = {},
): string {
	if (groupBy === "day" && isLocalDate(row.key)) {
		return formatLocalDay(row.key, { ...options, weekday: true });
	}
	if (groupBy === "week" && isLocalDate(row.key)) {
		return formatPeriodRange(row.key, addDays(row.key, 6), options);
	}
	if (groupBy === "context") {
		const kind = row.key.split(":")[0];
		if (SECTION_KINDS.has(kind) && row.label) {
			return contextSectionLabel(
				kind as Exclude<ContextKind, "personal">,
				row.label,
			);
		}
	}
	return row.label?.trim() || "—";
}

/** A summary row that names one person the report can filter to. */
export function isPersonRow(groupBy: ReportGroupBy, key: string): boolean {
	return groupBy === "member" && isUuid(key);
}

export interface ReportPersonOption {
	id: string;
	label: string;
	avatarUrl?: string | null;
}

/** People with time in the range (masked "Delivery team" rows can't be filtered to). */
export function peopleFromSummary(
	summary: ReportSummary | null | undefined,
): ReportPersonOption[] {
	if (!summary) return [];
	return summary.groups
		.filter((g) => isUuid(g.key))
		.map((g) => ({
			id: g.key,
			label: g.label?.trim() || REPORT_COPY.unknownPerson,
		}))
		.sort((a, b) => a.label.localeCompare(b.label, "en"));
}

// ── Entries ─────────────────────────────────────────────────────────────────

/** CHANGE-5 Approved. */
export function isApprovedEntry(
	entry: Pick<TimeEntryView, "payable_seconds" | "legacy_status">,
): boolean {
	return (
		typeof entry.payable_seconds === "number" &&
		entry.legacy_status !== "rejected"
	);
}

/** The person as the viewer may see them ("Delivery team" when masked, L22). */
export function entryPersonLabel(entry: TimeEntryView): string {
	if (entry.identity === "masked") {
		return entry.member_label?.trim() || REPORT_COPY.deliveryTeam;
	}
	return (
		entry.member?.display_name?.trim() ||
		entry.member_display_name_snapshot?.trim() ||
		REPORT_COPY.unknownPerson
	);
}

/** Project and task, or "A project you can't open" plus the work-item kind (L21). */
export function entryWorkLabels(entry: TimeEntryView): {
	project: string;
	work: string;
	hidden: boolean;
} {
	const kind = workItemLabel(entry.work_item);
	if (entry.content === "hidden") {
		return {
			project: entry.content_label?.trim() || REPORT_COPY.hiddenProject,
			work: kind,
			hidden: true,
		};
	}
	return {
		project: entry.project?.title?.trim() || "—",
		work: entry.task?.title?.trim() || kind,
		hidden: false,
	};
}

/** The For cell: "Acme Corp · agreement" on web, the counterparty on native. */
export function entryForLabel(
	entry: TimeEntryView,
	options: { native?: boolean } = {},
): { text: string; title: string | undefined } {
	const label = entry.context_label_snapshot?.trim() ?? "";
	if (entry.context_kind === "personal") {
		return { text: "Just me", title: undefined };
	}
	if (entry.context_kind === "assignment") {
		const full = sheetScopeLabel(
			"engagement",
			label || REPORT_COPY.deliveryTeam,
			{
				native: options.native,
			},
		);
		const short = sheetScopeLabel(
			"engagement",
			label || REPORT_COPY.deliveryTeam,
			{ native: options.native, max: CHIP_LABEL_MAX },
		);
		return { text: short, title: short === full ? undefined : full };
	}
	return labelWithTitle(label || "—", CHIP_LABEL_MAX);
}

// ── Sections (Project › Time · Everyone) ────────────────────────────────────

export interface ReportSectionPerson {
	key: string;
	label: string;
	masked: boolean;
	approvedSeconds: number;
	notApprovedSeconds: number;
	/** Visible cost only; null when none. */
	amounts: Record<string, number> | null;
}

export interface ReportSection {
	/** `<context_kind>:<context_ref>`. */
	key: string;
	kind: Exclude<ContextKind, "personal">;
	/** The context's own label (team, workspace or counterparty name). */
	label: string;
	approvedSeconds: number;
	notApprovedSeconds: number;
	/** Approved time of billable work (`real_work`). */
	billableSeconds: number;
	amounts: Record<string, number> | null;
	/** Some entry in the section carries cost the viewer may see. */
	costVisible: boolean;
	/** Every entry's person is masked ("Delivery team"). */
	allMasked: boolean;
	people: ReportSectionPerson[];
}

interface SectionAcc extends Omit<ReportSection, "people" | "amounts"> {
	amounts: Record<string, number>;
	people: Map<
		string,
		Omit<ReportSectionPerson, "amounts"> & { amounts: Record<string, number> }
	>;
}

const KIND_ORDER: Record<string, number> = {
	team: 0,
	workspace: 1,
	assignment: 2,
};

function nonEmpty(
	amounts: Record<string, number>,
): Record<string, number> | null {
	return Object.keys(amounts).length > 0 ? amounts : null;
}

/**
 * One section per governed context (kind + ref), each with its people.
 * Personal time and legacy rejected entries never count (E64). Cost counts
 * only approved entries whose cost the viewer may see.
 */
export function sectionsFromEntries(
	entries: readonly TimeEntryView[],
): ReportSection[] {
	const sections = new Map<string, SectionAcc>();
	for (const entry of entries) {
		if (entry.context_kind === "personal") continue;
		if (entry.legacy_status === "rejected") continue;
		const kind = entry.context_kind;
		const key = `${kind}:${entry.context_ref ?? ""}`;
		const section: SectionAcc = sections.get(key) ?? {
			key,
			kind,
			label: entry.context_label_snapshot?.trim() ?? "",
			approvedSeconds: 0,
			notApprovedSeconds: 0,
			billableSeconds: 0,
			amounts: {},
			costVisible: false,
			allMasked: true,
			people: new Map(),
		};
		if (!section.label && entry.context_label_snapshot) {
			section.label = entry.context_label_snapshot.trim();
		}
		const approved = isApprovedEntry(entry);
		const approvedSeconds = approved
			? Math.max(0, entry.payable_seconds ?? 0)
			: 0;
		const pendingSeconds =
			entry.payable_seconds === null || entry.payable_seconds === undefined
				? Math.max(0, entry.duration_seconds ?? 0)
				: 0;
		const masked = entry.identity === "masked";
		const personKey = masked
			? `masked:${entry.context_ref ?? kind}`
			: (entry.member_user_id ?? entry.member?.id ?? "unknown");
		const person = section.people.get(personKey) ?? {
			key: personKey,
			label: entryPersonLabel(entry),
			masked,
			approvedSeconds: 0,
			notApprovedSeconds: 0,
			amounts: {},
		};
		person.approvedSeconds += approvedSeconds;
		person.notApprovedSeconds += pendingSeconds;
		section.approvedSeconds += approvedSeconds;
		section.notApprovedSeconds += pendingSeconds;
		if (approved && entry.work_type_snapshot === "real_work") {
			section.billableSeconds += approvedSeconds;
		}
		if (!masked) section.allMasked = false;
		if (entry.cost === "visible") {
			section.costVisible = true;
			const amount = entry.amount_snapshot;
			if (approved && typeof amount === "number" && Number.isFinite(amount)) {
				const currency = (entry.currency_snapshot || "USD").toUpperCase();
				section.amounts[currency] = roundCents(
					(section.amounts[currency] ?? 0) + amount,
				);
				person.amounts[currency] = roundCents(
					(person.amounts[currency] ?? 0) + amount,
				);
			}
		}
		section.people.set(personKey, person);
		sections.set(key, section);
	}
	return [...sections.values()]
		.map(
			(s): ReportSection => ({
				...s,
				amounts: nonEmpty(s.amounts),
				people: [...s.people.values()]
					.map((p) => ({ ...p, amounts: nonEmpty(p.amounts) }))
					.sort(
						(a, b) =>
							Number(a.masked) - Number(b.masked) ||
							a.label.localeCompare(b.label, "en"),
					),
			}),
		)
		.sort(
			(a, b) =>
				(KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) ||
				a.label.localeCompare(b.label, "en"),
		);
}

/**
 * A section heading (ux.md › Project › Time page): "Prodigitality Services…
 * · team", "Acme · workspace", "Acme Corp · agreement", and for agreement
 * time whose people the viewer may not name, "Delivery team · agreement with
 * Acme Corp".
 */
export function sectionHeading(section: ReportSection): {
	text: string;
	title: string | undefined;
} {
	const name = section.label || REPORT_COPY.deliveryTeam;
	if (section.kind === "assignment" && section.allMasked) {
		const full = `${REPORT_COPY.deliveryTeam} · agreement with ${name}`;
		const text = `${REPORT_COPY.deliveryTeam} · agreement with ${
			labelWithTitle(name, CHIP_LABEL_MAX).text
		}`;
		return { text, title: text === full ? undefined : full };
	}
	const full = contextSectionLabel(section.kind, name);
	const text = contextSectionLabel(section.kind, name, { max: CHIP_LABEL_MAX });
	return { text, title: text === full ? undefined : full };
}

/** Totals over sections (Approved and Not yet approved stay apart). */
export function sectionTotals(
	sections: readonly ReportSection[],
): ReportFigures {
	const amounts: Record<string, number> = {};
	let approvedSeconds = 0;
	let notApprovedSeconds = 0;
	let billableSeconds = 0;
	for (const s of sections) {
		approvedSeconds += s.approvedSeconds;
		notApprovedSeconds += s.notApprovedSeconds;
		billableSeconds += s.billableSeconds;
		addAmounts(amounts, s.amounts);
	}
	return {
		approvedSeconds,
		notApprovedSeconds,
		billableSeconds,
		amounts: nonEmpty(amounts),
	};
}
