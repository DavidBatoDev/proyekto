// web/src/components/time/entries/entryRules.ts
//
// Pure rules behind the entries kit (TimeEntriesTable, TimeEntryDetailModal,
// EntryBadges, AmountLines). No React. The rules come from ux.md:
//
// - Lock matrix (CHANGE-14): a row locks when its sheet is Submitted or
//   Approved, or the entry is paid, billed, legacy or frozen. The backend
//   derives `locked_reason` in trg_40's order (paid → billed → legacy →
//   frozen → sheet status); the web trusts it and only derives it for rows
//   that lack it. Locked rows keep only "View details" and "Comment".
// - Needs review (CHANGE-22, A3): an entry of 10 h or more, or one the
//   system stopped (`flagged_reason`). A running timer joins at 10 h.
// - Accent bar (Submit, Return, Reopen): grey Submitted, green Approved,
//   amber Returned, primary while running. Theme tokens only.
// - Entry badges: Paid (row and detail, web and native); Billed (row and
//   detail, web only, cost viewers); "Paid outside Proyekto" and "Not
//   approved (legacy)" (detail only, L56).
// - Hidden content (L21, D32): task, note and project are null and the row
//   reads "A project you can't open" plus the work-item kind.
//
// Strings that ux.md does not give are written here in the same voice and
// marked in the W1-1 report, for W3-1 to fold into lib/timeErrors.

import { isNativeApp } from "@/lib/platform";
import { serverNow } from "@/lib/serverClock";
import { flaggedReasonCopy, lockedChipCopy } from "@/lib/timeErrors";
import {
	contextLabel,
	deviceTimeZone,
	formatInstantDay,
	formatLocalDay,
	formatPeriodRange,
	sheetScopeLabel,
} from "@/lib/timeFormat";
import { localDate, safeTimezone } from "@/lib/timePeriods";
import type {
	ContextKind,
	EntryLockedReason,
	SheetScopeKind,
	TimeEntryView,
	TimesheetStatus,
	TimesheetSummary,
	WorkItem,
} from "@/services/time.types";
import { liveBreakSeconds, liveWorkSeconds } from "../timer/liveDuration";

// ── Constants ───────────────────────────────────────────────────────────────

/** At 10 hours an entry joins Needs review (CHANGE-22; the A3 approval flag). */
export const NEEDS_REVIEW_SECONDS = 10 * 3600;
/** A day over 8 hours shows ⚠ (ux.md › Day strip, the live day total rule). */
export const DAY_WARNING_SECONDS = 8 * 3600;
/** Group key of the pulled-out Needs review rows. */
export const NEEDS_REVIEW_GROUP_KEY = "__needs_review__";

/**
 * Who the table is for:
 * - `mine`: the signed-in person's own entries (the Time page, month view).
 *   The lock matrix decides the actions; selection mode is available.
 * - `review`: someone else's entries read by a decider or manager (the review
 *   screen). View details and Comment only; Needs review starts open.
 * - `readonly`: any other read. View details and Comment only.
 */
export type EntriesTableMode = "mine" | "review" | "readonly";

/** What a row needs to know about its sheet beyond `EntrySheetRef` (from `me/timesheets`). */
export type EntrySheetInfo = Pick<TimesheetSummary, "id"> &
	Partial<
		Pick<
			TimesheetSummary,
			"status" | "submitted_at" | "decided_at" | "timezone"
		>
	>;

// ── Copy (ux.md words; new sentences are listed in the W1-1 report) ────────

export const ENTRY_COPY = {
	hiddenContent: "A project you can't open",
	untitledTask: "Untitled task",
	noTask: "No task",
	maskedMember: "Delivery team",
	maskedCommentAuthor: "Delivery team member",
	justMe: "Just me",
	running: "Running",
	onBreak: "On break",
	notOnSheet: "Not on a timesheet",
	needsReview: "Needs review",
	overTenHours: "Over 10 hours. Check the end time.",
	stopFirst: "Stop the timer first.",
	stopToEdit: "Stop the timer to edit its times.",
	dayOver: "Over 8 hours this day",
	estimate: "Estimated. Final at approval.",
	viewDetails: "View details",
	comment: "Comment",
	edit: "Edit",
	changeTask: "Change task",
	changeFor: "Change For…",
	delete: "Delete",
	openTask: "Open task in roadmap",
	stop: "Stop",
	stopTimer: "Stop timer",
} as const;

const STATUS_WORD: Record<TimesheetStatus, string> = {
	open: "Open",
	submitted: "Submitted",
	returned: "Returned",
	approved: "Approved",
};

const WORK_ITEM_LABEL: Record<WorkItem, string> = {
	task: "Task",
	meeting: "Meeting",
	review: "Review",
	admin: "Admin",
	other: "Other",
};

/** "Task", "Meeting", "Review", "Admin", "Other". */
export function workItemLabel(item: WorkItem | null | undefined): string {
	return (item && WORK_ITEM_LABEL[item]) || WORK_ITEM_LABEL.other;
}

/** The sheet status word ("Open", "Submitted", "Returned", "Approved"). */
export function sheetStatusWord(status: TimesheetStatus): string {
	return STATUS_WORD[status] ?? status;
}

// ── Basics ──────────────────────────────────────────────────────────────────

export function isRunning(entry: Pick<TimeEntryView, "ended_at">): boolean {
	return !entry.ended_at;
}

export function isOnBreak(
	entry: Pick<TimeEntryView, "ended_at" | "paused_at">,
): boolean {
	return !entry.ended_at && Boolean(entry.paused_at);
}

export function isHiddenContent(
	entry: Pick<TimeEntryView, "content">,
): boolean {
	return entry.content === "hidden";
}

/** Worked seconds: the stored duration, or the live clock while running. */
export function entryWorkSeconds(
	entry: TimeEntryView,
	nowMs: number = serverNow(),
): number {
	if (entry.ended_at) return Math.max(0, entry.duration_seconds ?? 0);
	return liveWorkSeconds(entry, nowMs);
}

/** Break seconds, including a pause in progress. */
export function entryBreakSeconds(
	entry: TimeEntryView,
	nowMs: number = serverNow(),
): number {
	return liveBreakSeconds(entry, nowMs);
}

/** The local date (`YYYY-MM-DD`) the entry starts on in `timeZone`. */
export function entryDayKey(
	entry: Pick<TimeEntryView, "started_at">,
	timeZone: string,
): string | null {
	const ms = Date.parse(entry.started_at);
	if (Number.isNaN(ms)) return null;
	return localDate(new Date(ms), safeTimezone(timeZone));
}

// ── Titles and labels ───────────────────────────────────────────────────────

export interface EntryTitle {
	text: string;
	/** `task`: a named task; `preset`: a work item (◦); `hidden`: content redacted; `missing`: no title. */
	kind: "task" | "preset" | "hidden" | "missing";
}

/** What the row's task cell reads. */
export function entryTitle(
	entry: Pick<
		TimeEntryView,
		"content" | "content_label" | "task" | "task_id" | "work_item"
	>,
): EntryTitle {
	if (entry.content === "hidden") {
		return {
			text: entry.content_label?.trim() || ENTRY_COPY.hiddenContent,
			kind: "hidden",
		};
	}
	const title = entry.task?.title?.trim();
	if (title) return { text: title, kind: "task" };
	if (entry.task_id) return { text: ENTRY_COPY.untitledTask, kind: "missing" };
	if (entry.work_item && entry.work_item !== "task") {
		return { text: workItemLabel(entry.work_item), kind: "preset" };
	}
	return { text: ENTRY_COPY.noTask, kind: "missing" };
}

/** The project's title, or null when hidden or absent. */
export function entryProjectLabel(
	entry: Pick<TimeEntryView, "content" | "project">,
): string | null {
	if (entry.content === "hidden") return null;
	return entry.project?.title?.trim() || null;
}

/** The person, as this viewer may see them: "Delivery team" when masked. */
export function entryMemberLabel(
	entry: Pick<
		TimeEntryView,
		"identity" | "member" | "member_label" | "member_display_name_snapshot"
	>,
): string {
	if (entry.identity === "masked") {
		return entry.member_label?.trim() || ENTRY_COPY.maskedMember;
	}
	const m = entry.member;
	return (
		m?.display_name?.trim() ||
		[m?.first_name, m?.last_name].filter(Boolean).join(" ").trim() ||
		entry.member_display_name_snapshot?.trim() ||
		ENTRY_COPY.maskedMember
	);
}

/** The For label: "Just me" for personal, else the context snapshot. */
export function entryForLabel(
	entry: Pick<TimeEntryView, "context_kind" | "context_label_snapshot">,
): string {
	return (
		contextLabel(entry.context_kind, entry.context_label_snapshot) ||
		ENTRY_COPY.justMe
	);
}

// ── Locks ───────────────────────────────────────────────────────────────────

type LockFields = Pick<
	TimeEntryView,
	"payout_id" | "legacy_status" | "payable_seconds" | "timesheet"
> & { locked_reason?: TimeEntryView["locked_reason"] };

/**
 * Why the entry can't change, or null. The backend's `locked_reason` wins;
 * a row without the key (an optimistic row) is derived in trg_40's order.
 * The backend's "billed" can't be derived on the web.
 */
export function entryLockReason(
	entry: LockFields,
): EntryLockedReason | (string & {}) | null {
	if (entry.locked_reason !== undefined) return entry.locked_reason ?? null;
	if (entry.payout_id || entry.legacy_status === "paid_outside") return "paid";
	if (entry.legacy_status) return "legacy";
	if (entry.payable_seconds !== null && entry.payable_seconds !== undefined) {
		return "frozen";
	}
	const status = entry.timesheet?.status;
	if (status === "submitted" || status === "approved") return `sheet_${status}`;
	return null;
}

export function isEntryLocked(entry: LockFields): boolean {
	return entryLockReason(entry) !== null;
}

export interface LockCopyOptions {
	native?: boolean;
	/** The sheet's own row (from `me/timesheets`), for the submitted date. */
	sheet?: EntrySheetInfo | null;
	/** Timezone for the dates; defaults to the sheet's, then the device's. */
	timeZone?: string;
	now?: Date;
}

/**
 * The member-facing sentence for a locked entry (the 🔒 chip tooltip, a
 * disabled checkbox, the detail modal): "Submitted Oct 6. Withdraw to
 * change.", "Approved Oct 6. Ask to reopen to change.", or why it is paid,
 * billed or legacy. Null when the entry is not locked.
 */
export function entryLockCopy(
	entry: LockFields,
	options: LockCopyOptions = {},
): string | null {
	const reason = entryLockReason(entry);
	if (!reason) return null;
	const native = options.native ?? isNativeApp();
	const sheet = entry.timesheet;
	const tz = safeTimezone(
		options.timeZone ?? options.sheet?.timezone ?? deviceTimeZone(),
	);
	const day = (iso: string | null | undefined) =>
		iso
			? formatInstantDay(iso, tz, { now: options.now, userTimezone: tz })
			: null;
	switch (reason) {
		case "paid":
			return entry.payout_id
				? "This time has been paid, so it can't change."
				: "This time was paid outside Proyekto, so it can't change.";
		case "billed":
			return native
				? "This time is already being billed, so it can't change."
				: "This time is on an invoice, so it can't change.";
		case "legacy":
			return "This is older time from per-entry review, so it can't change.";
		case "sheet_submitted":
			return lockedChipCopy(
				"submitted",
				day(options.sheet?.submitted_at ?? null),
			);
		case "sheet_approved":
			return lockedChipCopy(
				"approved",
				day(sheet?.decided_at ?? options.sheet?.decided_at ?? null),
			);
		case "frozen":
			if (sheet?.status === "approved" || !sheet) {
				return lockedChipCopy(
					"approved",
					day(sheet?.decided_at ?? options.sheet?.decided_at ?? null),
				);
			}
			return "This time was approved, so it can't change.";
		default:
			return "This entry is on a submitted or approved timesheet.";
	}
}

// ── Status and accent ───────────────────────────────────────────────────────

export type EntryAccent =
	| "running"
	| "open"
	| "submitted"
	| "returned"
	| "approved"
	| "none";

/** The left accent bar: running first, then the sheet status; personal time has none. */
export function entryAccent(
	entry: Pick<TimeEntryView, "ended_at" | "timesheet">,
): EntryAccent {
	if (!entry.ended_at) return "running";
	return entry.timesheet?.status ?? "none";
}

/** Theme tokens only (ux.md › Submit, Return, Reopen). */
export const ACCENT_CLASS: Record<EntryAccent, string> = {
	running: "border-l-primary",
	open: "border-l-transparent",
	submitted: "border-l-muted-foreground/40",
	returned: "border-l-warning",
	approved: "border-l-success",
	none: "border-l-transparent",
};

/** The status a row's accent stands for, as words (tooltip and screen readers). */
export function entryStatusLabel(
	entry: Pick<TimeEntryView, "ended_at" | "paused_at" | "timesheet">,
): string {
	if (!entry.ended_at) {
		return entry.paused_at ? ENTRY_COPY.onBreak : ENTRY_COPY.running;
	}
	const status = entry.timesheet?.status;
	return status ? sheetStatusWord(status) : ENTRY_COPY.notOnSheet;
}

export interface EntrySheetLine {
	status: TimesheetStatus;
	/** "Submitted · Prodigitality Services Inc. Team · Sep 22–28". */
	text: string;
	/** The decider's note on a returned sheet. */
	note: string | null;
}

/** The sheet line in the detail modal; null for personal time. */
export function entrySheetLine(
	entry: Pick<TimeEntryView, "timesheet" | "context_kind">,
	options: { native?: boolean; now?: Date; userTimezone?: string } = {},
): EntrySheetLine | null {
	const sheet = entry.timesheet;
	if (!sheet) return null;
	const kind: SheetScopeKind =
		entry.context_kind === "assignment" ? "engagement" : "workspace";
	const scope = sheet.scope_label_snapshot?.trim()
		? sheetScopeLabel(kind, sheet.scope_label_snapshot, {
				native: options.native,
			})
		: "";
	const period = formatPeriodRange(sheet.period_start, sheet.period_end, {
		now: options.now,
		userTimezone: options.userTimezone,
	});
	const text = [sheetStatusWord(sheet.status), scope, period]
		.filter(Boolean)
		.join(" · ");
	const note =
		sheet.status === "returned" && sheet.decision_note?.trim()
			? sheet.decision_note.trim()
			: null;
	return { status: sheet.status, text, note };
}

// ── Needs review ────────────────────────────────────────────────────────────

export type NeedsReviewReason =
	| "long"
	| "auto_stopped_24h"
	| "stopped_by_assignment_end"
	| "flagged";

/** Why the entry needs a look, or null. */
export function needsReviewReason(
	entry: TimeEntryView,
	nowMs: number = serverNow(),
): NeedsReviewReason | null {
	const flagged = entry.flagged_reason;
	if (flagged === "auto_stopped_24h") return "auto_stopped_24h";
	if (flagged === "stopped_by_assignment_end") {
		return "stopped_by_assignment_end";
	}
	if (flagged) return "flagged";
	return entryWorkSeconds(entry, nowMs) >= NEEDS_REVIEW_SECONDS ? "long" : null;
}

export function needsReview(
	entry: TimeEntryView,
	nowMs: number = serverNow(),
): boolean {
	return needsReviewReason(entry, nowMs) !== null;
}

/** The sentence for one entry: the flagged copy, or the over-10-hours note. */
export function needsReviewCopy(
	entry: TimeEntryView,
	options: { nowMs?: number } = {},
): string | null {
	const reason = needsReviewReason(entry, options.nowMs);
	if (!reason) return null;
	if (reason === "long") return ENTRY_COPY.overTenHours;
	const agreementLabel =
		entry.context_kind === "assignment" ? entry.context_label_snapshot : null;
	return (
		flaggedReasonCopy(entry.flagged_reason, { agreementLabel }) ??
		ENTRY_COPY.overTenHours
	);
}

/** "one entry ran over 10h · 2 timers were stopped automatically". */
export function needsReviewCaption(
	entries: readonly TimeEntryView[],
	nowMs: number = serverNow(),
): string {
	let long = 0;
	let stopped = 0;
	for (const entry of entries) {
		const reason = needsReviewReason(entry, nowMs);
		if (reason === "long") long += 1;
		else if (reason) stopped += 1;
	}
	const parts: string[] = [];
	if (long === 1) parts.push("one entry ran over 10h");
	else if (long > 1) parts.push(`${long} entries ran over 10h`);
	if (stopped === 1) parts.push("one timer was stopped automatically");
	else if (stopped > 1)
		parts.push(`${stopped} timers were stopped automatically`);
	return parts.join(" · ");
}

// ── Grouping ────────────────────────────────────────────────────────────────

export interface EntryGroup {
	key: string;
	kind: "review" | "day";
	/** "Needs review (1)" or "Thu Oct 2". */
	label: string;
	caption?: string;
	/** The local date for a day group. */
	date?: string;
	entries: TimeEntryView[];
	/** Any running entry (the group total ticks). */
	running: boolean;
}

export interface GroupOptions {
	/** Days are cut in this timezone (the day strip's). Default: the device's. */
	timeZone?: string;
	/** `newest` (default): newest day and newest time-in first. */
	order?: "newest" | "oldest";
	/** Pull Needs review rows into their own group (default true). */
	pullNeedsReview?: boolean;
	nowMs?: number;
	/** For the year rule in day labels. */
	now?: Date;
}

function startedMs(entry: Pick<TimeEntryView, "started_at">): number {
	const ms = Date.parse(entry.started_at);
	return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Day groups, plus a leading "Needs review" group. Needs review rows are
 * pulled out of their day so a forgotten timer doesn't inflate the day's
 * total, and are easy to find and fix.
 */
export function groupEntries(
	entries: readonly TimeEntryView[],
	options: GroupOptions = {},
): EntryGroup[] {
	const tz = safeTimezone(options.timeZone ?? deviceTimeZone());
	const nowMs = options.nowMs ?? serverNow();
	const newest = (options.order ?? "newest") === "newest";
	const pull = options.pullNeedsReview ?? true;
	const sign = newest ? -1 : 1;
	const byStart = (a: TimeEntryView, b: TimeEntryView) =>
		sign * (startedMs(a) - startedMs(b)) || a.id.localeCompare(b.id);

	const review: TimeEntryView[] = [];
	const days = new Map<string, TimeEntryView[]>();
	for (const entry of entries) {
		if (pull && needsReview(entry, nowMs)) {
			review.push(entry);
			continue;
		}
		const key = entryDayKey(entry, tz) ?? "undated";
		const bucket = days.get(key);
		if (bucket) bucket.push(entry);
		else days.set(key, [entry]);
	}

	const groups: EntryGroup[] = [];
	for (const [key, dayEntries] of days) {
		dayEntries.sort(byStart);
		groups.push({
			key,
			kind: "day",
			date: key === "undated" ? undefined : key,
			label:
				key === "undated"
					? "Undated"
					: formatLocalDay(key, {
							weekday: true,
							now: options.now,
							userTimezone: tz,
						}),
			entries: dayEntries,
			running: dayEntries.some((e) => !e.ended_at),
		});
	}
	// Keys are YYYY-MM-DD, so they sort as strings ("undated" sorts last either way).
	groups.sort((a, b) => {
		if (a.key === "undated") return 1;
		if (b.key === "undated") return -1;
		return newest ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key);
	});

	if (review.length === 0) return groups;
	review.sort(byStart);
	return [
		{
			key: NEEDS_REVIEW_GROUP_KEY,
			kind: "review",
			label: `${ENTRY_COPY.needsReview} (${review.length})`,
			caption: needsReviewCaption(review, nowMs),
			entries: review,
			running: review.some((e) => !e.ended_at),
		},
		...groups,
	];
}

// ── Actions ─────────────────────────────────────────────────────────────────

export type EntryActionId =
	| "stop"
	| "view"
	| "comment"
	| "edit"
	| "change_task"
	| "change_for"
	| "delete"
	| "open_task";

export interface EntryActionRule {
	id: EntryActionId;
	disabled: boolean;
	/** Why it is disabled, when there is a sentence for it. */
	reason: string | null;
}

export interface EntryActionContext {
	mode: EntriesTableMode;
	/** A write on this row is in flight. */
	pending?: boolean;
	/** The task can be opened in its roadmap. */
	canOpenTask?: boolean;
}

/**
 * The actions a row offers, in menu order. Every mode keeps View details and
 * Comment. Only `mine` edits, and a locked row keeps only those two (ux.md ›
 * Submit, Return, Reopen). The caller still hides an action it has no
 * handler for.
 */
export function entryActions(
	entry: TimeEntryView,
	ctx: EntryActionContext,
): EntryActionRule[] {
	const rule = (
		id: EntryActionId,
		disabled = false,
		reason: string | null = null,
	): EntryActionRule => ({ id, disabled, reason });
	const pending = Boolean(ctx.pending);
	const running = isRunning(entry);
	const out: EntryActionRule[] = [];

	const editable =
		ctx.mode === "mine" && !isEntryLocked(entry) && !isHiddenContent(entry);
	if (editable && running) out.push(rule("stop", pending));
	out.push(rule("view"), rule("comment"));
	if (!editable) return out;

	out.push(
		running ? rule("edit", true, ENTRY_COPY.stopToEdit) : rule("edit", pending),
		rule("change_task", pending),
	);
	if (!running) out.push(rule("change_for", pending));
	out.push(rule("delete", pending));
	if (entry.task_id && ctx.canOpenTask) out.push(rule("open_task", pending));
	return out;
}

export interface SelectionRule {
	selectable: boolean;
	/** Why the box is disabled (mine mode only). */
	reason: string | null;
}

/**
 * Selection mode feeds bulk "Change For…", which works on rows whose sheet
 * is Open or Returned (L2): never a locked row, a running timer, or another
 * person's time.
 */
export function entrySelection(
	entry: TimeEntryView,
	mode: EntriesTableMode,
	lockOptions: LockCopyOptions = {},
): SelectionRule {
	if (mode !== "mine" || isHiddenContent(entry)) {
		return { selectable: false, reason: null };
	}
	if (isRunning(entry)) {
		return { selectable: false, reason: ENTRY_COPY.stopFirst };
	}
	const lock = entryLockCopy(entry, lockOptions);
	if (lock) return { selectable: false, reason: lock };
	return { selectable: true, reason: null };
}

// ── Money ───────────────────────────────────────────────────────────────────

export interface EntryAmount {
	amount: number;
	currency: string;
	/** True once approved (`amount_snapshot`); an estimate before. */
	final: boolean;
}

/**
 * The entry's cost for a cost viewer: `amount_snapshot` once approved, else
 * an estimate from `rate_snapshot` × duration. Null when cost is hidden, the
 * rate is fixed or zero, or an approved entry carries no amount (fixed fee,
 * client-governed time). Whether it may show at all (native agreement time)
 * is AmountLines' `canShowAmounts` check.
 */
export function entryAmount(
	entry: TimeEntryView,
	nowMs: number = serverNow(),
): EntryAmount | null {
	if (entry.cost !== "visible") return null;
	const currency = (entry.currency_snapshot || "USD").toUpperCase();
	if (entry.payable_seconds !== null && entry.payable_seconds !== undefined) {
		const amount = entry.amount_snapshot;
		return typeof amount === "number" && Number.isFinite(amount)
			? { amount, currency, final: true }
			: null;
	}
	if (entry.rate_type_snapshot === "fixed") return null;
	const rate = Number(entry.rate_snapshot ?? 0);
	if (!Number.isFinite(rate) || rate <= 0) return null;
	const seconds = entryWorkSeconds(entry, nowMs);
	if (seconds <= 0) return null;
	return {
		amount: Math.round((seconds / 3600) * rate * 100) / 100,
		currency,
		final: false,
	};
}

/** `{ PHP: 450 }`, the shape AmountLines takes; null without an amount. */
export function amountRecord(
	amount: EntryAmount | null,
): Record<string, number> | null {
	return amount ? { [amount.currency]: amount.amount } : null;
}

// ── Badges ──────────────────────────────────────────────────────────────────

export type EntryBadgeKind =
	| "paid"
	| "billed"
	| "paid_outside"
	| "legacy_rejected";

export const BADGE_LABEL: Record<EntryBadgeKind, string> = {
	paid: "Paid",
	billed: "Billed",
	paid_outside: "Paid outside Proyekto",
	legacy_rejected: "Not approved (legacy)",
};

/**
 * The badges an entry shows. Paid: row and detail, web and native. Billed:
 * web only, cost viewers (the backend says billed through `locked_reason`,
 * which reads `paid` first, so a paid entry never also reads Billed). The
 * legacy markers show in the entry detail only (L56).
 */
export function entryBadgeKinds(
	entry: Pick<
		TimeEntryView,
		"payout_id" | "legacy_status" | "cost" | "locked_reason"
	>,
	options: { variant?: "row" | "detail"; native?: boolean } = {},
): EntryBadgeKind[] {
	const native = options.native ?? isNativeApp();
	const detail = options.variant === "detail";
	const out: EntryBadgeKind[] = [];
	if (entry.payout_id) out.push("paid");
	if (!native && entry.cost === "visible" && entry.locked_reason === "billed") {
		out.push("billed");
	}
	if (detail && entry.legacy_status === "paid_outside")
		out.push("paid_outside");
	if (detail && entry.legacy_status === "rejected") out.push("legacy_rejected");
	return out;
}

// ── Kinds ───────────────────────────────────────────────────────────────────

/** Agreement time is the native-sensitive kind (amounts never show there). */
export function isAgreementKind(
	kind: ContextKind | SheetScopeKind | null | undefined,
): boolean {
	return kind === "assignment" || kind === "engagement";
}
