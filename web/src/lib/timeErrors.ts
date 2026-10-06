/**
 * Every sentence the Time pages say about a refusal, a warning, a plan gate
 * or a finished action (ux.md › Copy, Submit, Return, Reopen, Approvals).
 *
 * The rule for the whole module: **components never print a server message
 * or a bare code**. They pass the thrown value to `timeErrorCopy` (or one of
 * the builders below) and render what comes back. The server's own copy is
 * used only where it is already a human sentence (class-validator output and
 * field names never reach a person), and only after the native filter.
 *
 * Native rules (ux.md › Mobile): the installed app never says "contract",
 * "rate", "payout" or "invoice", shows no amount on agreement time and links
 * nowhere under `/engagements`. Every builder takes `native` (defaulting to
 * `isNativeApp()`), returns the native wording where ux.md gives one, and runs
 * through `nativeSafe` as a backstop. Rows ux.md marks *hidden* come back with
 * `hidden: true`: the surface that raised them is web-only.
 *
 * Plan copy names tiers only (Pro, Business, Enterprise): never a price,
 * "per user", "/month" or a pricing link.
 *
 * Formats (durations, periods, money, labels) live in lib/timeFormat.ts.
 */

import { parsePlanLimitError } from "@/lib/planLimitErrors";
import { isNativeApp } from "@/lib/platform";
import { toTimeApiError } from "@/services/time.service";
import type {
	ApproverScope,
	ContextKind,
	EntryWarning,
	FlaggedReason,
	PeriodKind,
	SheetScopeKind,
	TimeDecider,
	TimeErrorCode,
	TimesheetStatus,
	TimesheetTransitionInvalidReason,
} from "@/services/time.types";
import {
	capitalize,
	type DateFormatOptions,
	firstName,
	formatClock,
	formatDurationText,
	formatLocalDay,
	formatMinutesText,
	type GoesToContext,
	goesToTarget,
	possessive,
	scopePhrase,
} from "./timeFormat";

type Kind = ContextKind | SheetScopeKind;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function num(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

function isAgreement(kind: Kind | null | undefined): boolean {
	return kind === "assignment" || kind === "engagement";
}

// ── Native filter ───────────────────────────────────────────────────────────

/** The words the installed app never shows (ux.md › Mobile). */
export const NATIVE_FORBIDDEN_WORDS = [
	"contract",
	"rate",
	"payout",
	"invoice",
] as const;

const FORBIDDEN_RE =
	/\b(?:contracts?|contractual|contractors?|rates?|rated|payouts?|invoices?|invoiced|invoicing)\b/i;
const CONTRACT_WORD_RE = /\b(contract)(s?)\b/gi;
/** A link or path into the marketplace's engagement pages (web only). */
const ENGAGEMENTS_PATH_RE = /\/engagements\b/;
/** "PHP 6,885.00", "USD -10", "$120", "₱6,885". */
const AMOUNT_RE = /\b[A-Z]{3} -?\d[\d,]*(?:\.\d+)?\b|[$€£₱¥]\s?\d/;

/** Shown on native when a sentence can't be said there. */
export const NATIVE_FALLBACK_COPY = "Open Proyekto on the web to see this.";
/** Shown on native for a row ux.md marks hidden (a web-only surface raised it). */
export const NATIVE_WEB_ONLY_COPY = "Open Proyekto on the web to do this.";

/** True when the text uses a word native never shows. */
export function hasNativeForbiddenWords(
	text: string | null | undefined,
): boolean {
	return typeof text === "string" && FORBIDDEN_RE.test(text);
}

/** True when the text shows a money amount. */
export function hasAmount(text: string | null | undefined): boolean {
	return typeof text === "string" && AMOUNT_RE.test(text);
}

/**
 * A sentence made safe for the installed app. On web it comes back as is. On
 * native, "contract" becomes "agreement" (the word ux.md uses everywhere);
 * anything still naming a rate, payout or invoice, pointing at
 * `/engagements`, or (with `stripAmounts`) showing an amount, is replaced by
 * `fallback`. Error copy always strips amounts on native.
 */
export function nativeSafe(
	text: string,
	options: { native?: boolean; fallback?: string; stripAmounts?: boolean } = {},
): string {
	const native = options.native ?? isNativeApp();
	if (!native) return text;
	const fallback = options.fallback ?? NATIVE_FALLBACK_COPY;
	const swapped = text.replace(
		CONTRACT_WORD_RE,
		(_match, word: string, s: string) =>
			`${word[0] === "C" ? "Agreement" : "agreement"}${s}`,
	);
	if (FORBIDDEN_RE.test(swapped) || ENGAGEMENTS_PATH_RE.test(swapped)) {
		return fallback;
	}
	if (options.stripAmounts && AMOUNT_RE.test(swapped)) return fallback;
	return swapped;
}

/** A link native may show: null for anything under `/engagements` on native. */
export function nativeSafeHref(
	href: string | null | undefined,
	options: { native?: boolean } = {},
): string | null {
	if (!href) return null;
	const native = options.native ?? isNativeApp();
	if (native && /(?:^|\/)engagements(?:[/?#]|$)/.test(href)) return null;
	return href;
}

// ── Plan copy (ux.md › Plan copy) ───────────────────────────────────────────

export const TIME_PLAN_KEYS = [
	"time_tracking",
	"time_billable_invoices",
	"time_team_rules",
	"time_payouts",
	"time_reports_export",
	"time_audit_export",
	"time_approval_chains",
] as const;

export type TimePlanKey = (typeof TIME_PLAN_KEYS)[number];

export function isTimePlanKey(key: unknown): key is TimePlanKey {
	return (
		typeof key === "string" &&
		(TIME_PLAN_KEYS as readonly string[]).includes(key)
	);
}

export interface TimePlanCopyOptions {
	/** The workspace whose plan is short ("Acme"). Falls back to "your workspace". */
	workspaceName?: string | null;
	native?: boolean;
	/**
	 * `time_billable_invoices` has two places: contract create or sign
	 * (`contract`, the default) and the cut-off editor (`cutoffs`, also used
	 * for `time_payouts` there).
	 */
	context?: "contract" | "cutoffs";
}

/**
 * The upgrade line for a time plan key, for `PlanLimitNotice`'s `message`.
 * Null means the notice is not shown on native (the surface is hidden there).
 */
export function timePlanCopy(
	key: TimePlanKey,
	options: TimePlanCopyOptions = {},
): string | null {
	const native = options.native ?? isNativeApp();
	const name = options.workspaceName?.trim() || null;
	const owner = name ? possessive(name) : "your workspace's";
	const cutoffs =
		"Billing and pay cut-offs are part of Pro (billing) or Business (payouts).";
	switch (key) {
		case "time_tracking":
			return native
				? `Timesheets and approvals aren't on ${owner} current plan. A workspace owner can change this on the web.`
				: `Timesheets and approvals are part of Pro. Upgrade ${name ?? "your workspace"} to send time for approval.`;
		case "time_billable_invoices":
			if (native) return null;
			return options.context === "cutoffs"
				? cutoffs
				: "Billing hours on invoices is part of Pro. You can still sign a retainer or fixed-fee contract.";
		case "time_team_rules":
			return native
				? `Team time rules aren't on ${owner} current plan.`
				: "Team approvers and team time rules are part of Business.";
		case "time_payouts":
			if (native) return null;
			return options.context === "cutoffs"
				? cutoffs
				: "Payouts are part of Business.";
		case "time_reports_export":
			return "Workspace-wide time reports and export are part of Business.";
		case "time_audit_export":
			return native ? null : "Time audit export is part of Enterprise.";
		case "time_approval_chains":
			return "Custom approval chains: Enterprise";
		default:
			return null;
	}
}

/** After a downgrade (web and native). */
export function timePlanDowngradeCopy(
	options: { workspaceName?: string | null } = {},
): string {
	const name = options.workspaceName?.trim();
	return `${name ? possessive(name) : "Your workspace's"} plan no longer includes timesheets. Your existing time is safe, and open timesheets can still be decided.`;
}

// ── Builders the copy table points at ───────────────────────────────────────

/** `TIMESHEET_LOCKED {period}`: "This week's Prodigitality timesheet is submitted. Withdraw it to add time." */
export function lockedPeriodCopy(
	options: {
		label?: string | null;
		periodKind?: PeriodKind | null;
		sheetStatus?: TimesheetStatus | null;
	} = {},
): string {
	const span =
		!options.periodKind || options.periodKind === "weekly"
			? "week's"
			: "period's";
	const label = options.label?.trim();
	const sheet = label ? `${label} timesheet` : "timesheet";
	if (options.sheetStatus === "approved") {
		return `This ${span} ${sheet} is approved, so its time can't change.`;
	}
	return `This ${span} ${sheet} is submitted. Withdraw it to add time.`;
}

/** `MANUAL_ENTRIES_DISABLED`: "Manual time is off for Prodigitality." / "…off in your agreement with Acme." */
export function manualTimeOffCopy(
	options: { label?: string | null; labelKind?: Kind | null } = {},
): string {
	const label = options.label?.trim();
	if (isAgreement(options.labelKind)) {
		return `Manual time is off in ${scopePhrase("engagement", label)}.`;
	}
	return label
		? `Manual time is off for ${label}.`
		: "Manual time is off here.";
}

/** `RETROACTIVE_WINDOW`: "Prodigitality accepts time up to 7 days back." */
export function retroactiveWindowCopy(
	options: {
		label?: string | null;
		labelKind?: Kind | null;
		days?: number | null;
		/** The extras' `earliest_date`, used when the day count is unknown. */
		earliestDate?: string | null;
	} & DateFormatOptions = {},
): string {
	const subject = capitalize(scopePhrase(options.labelKind, options.label));
	const days = num(options.days);
	if (days !== null && days > 0) {
		return `${subject} accepts time up to ${plural(Math.trunc(days), "day", "days")} back.`;
	}
	if (options.earliestDate) {
		return `${subject} accepts time from ${formatLocalDay(options.earliestDate, options)} on.`;
	}
	return `${subject} doesn't accept time this far back.`;
}

/** `HOUR_CAP_EXCEEDED`: "This goes past the 40h weekly limit for Prodigitality Services Inc. Team." */
export function hourCapCopy(
	extras: unknown,
	options: { label?: string | null } = {},
): string {
	const e = isRecord(extras) ? extras : {};
	const hours = num(e.limit_hours);
	const window = e.limit_window === "monthly" ? "monthly" : "weekly";
	const label = options.label?.trim();
	if (hours === null) {
		return label
			? `This goes past the ${window} limit for ${label}.`
			: `This goes past your ${window} limit.`;
	}
	const limit = formatDurationText(hours * 3600);
	return label
		? `This goes past the ${limit} ${window} limit for ${label}.`
		: `This goes past your ${limit} ${window} limit.`;
}

/** Why a timesheet action was refused (`TIMESHEET_TRANSITION_INVALID.reason`). */
export function transitionReasonCopy(
	reason: TimesheetTransitionInvalidReason | (string & {}) | null | undefined,
	options: {
		/** The sheet's last day, for `too_early`. */
		periodEnd?: string | null;
		/** The person a return note is for ("Add a note so Maria knows…"). */
		personName?: string | null;
	} & DateFormatOptions = {},
): string {
	switch (reason) {
		case "action":
		case "arguments":
			return "Proyekto couldn't do that to this timesheet. Reload and try again.";
		case "note_too_long":
			return "Keep the note to 2,000 characters or fewer.";
		case "not_allowed":
			return "You can't do that on this timesheet.";
		case "state":
			return "This timesheet changed. Reload to see where it stands.";
		case "empty":
			return "There's no time on this timesheet to send.";
		case "running_entry":
			return "A timer is still running on this timesheet. Stop it first.";
		case "too_early":
			return options.periodEnd
				? `You can submit this timesheet from ${formatLocalDay(options.periodEnd, options)}, its last day.`
				: "You can submit this timesheet from its last day.";
		case "not_auto":
			return "This timesheet doesn't send itself. Submit it instead.";
		case "note_required": {
			const who = firstName(options.personName);
			return `Add a note so ${who ?? "the person"} knows what to change.`;
		}
		case "freeze_required":
		case "freeze_invalid":
			return "This timesheet changed while you were looking. Review the latest and try again.";
		case "use_request_reopen":
			return "Someone else approves this timesheet. Ask to reopen it instead.";
		default:
			return "This timesheet can't do that right now.";
	}
}

export interface SettledEntriesCopy {
	message: string;
	/** Web only: what the message points at. */
	link: { kind: "payout" | "invoice"; id: string } | null;
}

/**
 * `TIMESHEET_HAS_SETTLED_ENTRIES` (ux.md › Reopen), from the A12 extras:
 *
 * | Case                   | Web                                                                       | Native                                                   |
 * |------------------------|---------------------------------------------------------------------------|----------------------------------------------------------|
 * | In a payout            | "This timesheet is in payout #12. Void the payout to reopen."             | "This time has already been paid. Reopen it on the web." |
 * | On a draft invoice     | "These hours are on draft invoice INV-0042. Remove them from the draft to reopen." | "This time is already being billed. Reopen it on the web." |
 * | On an issued invoice   | "Billed on invoice INV-0042. Void it without a replacement to reopen."    | As the draft row                                         |
 * | Paid outside Proyekto  | "Includes time paid outside Proyekto, so it can't be reopened."           | Same                                                     |
 *
 * Payouts have no number, so the payout is named only when the caller has a
 * label for it (`payoutLabel`); otherwise "a payout". A missing invoice number
 * or status falls back to the wording that fits both.
 */
export function settledEntriesCopy(
	extras: unknown,
	options: { native?: boolean; payoutLabel?: string | null } = {},
): SettledEntriesCopy {
	const native = options.native ?? isNativeApp();
	const e = isRecord(extras) ? extras : {};
	const reason = str(e.reason);
	const legacy =
		"Includes time paid outside Proyekto, so it can't be reopened.";

	if (reason === "legacy" || (reason === "paid" && e.paid_outside === true)) {
		return { message: legacy, link: null };
	}
	if (reason === "paid") {
		if (native) {
			return {
				message: "This time has already been paid. Reopen it on the web.",
				link: null,
			};
		}
		const payoutId = str(e.payout_id);
		const label = options.payoutLabel?.trim();
		return {
			message: label
				? `This timesheet is in payout ${label}. Void the payout to reopen.`
				: "This timesheet is in a payout. Void the payout to reopen.",
			link: payoutId ? { kind: "payout", id: payoutId } : null,
		};
	}
	if (reason === "billed") {
		if (native) {
			return {
				message: "This time is already being billed. Reopen it on the web.",
				link: null,
			};
		}
		const invoiceId = str(e.invoice_id);
		const number = str(e.invoice_number);
		const status = str(e.invoice_status);
		const link = invoiceId ? { kind: "invoice" as const, id: invoiceId } : null;
		if (status === "draft") {
			return {
				message: number
					? `These hours are on draft invoice ${number}. Remove them from the draft to reopen.`
					: "These hours are on a draft invoice. Remove them from the draft to reopen.",
				link,
			};
		}
		if (status) {
			return {
				message: number
					? `Billed on invoice ${number}. Void it without a replacement to reopen.`
					: "Billed on an invoice. Void it without a replacement to reopen.",
				link,
			};
		}
		return {
			message: number
				? `These hours are on invoice ${number}. Remove them from the draft, or void the invoice without a replacement, to reopen.`
				: "These hours are on an invoice. Remove them from the draft, or void the invoice without a replacement, to reopen.",
			link,
		};
	}
	return {
		message: native
			? "This time has already been paid or billed. Reopen it on the web."
			: "This timesheet has time that was already paid or billed, so it can't be reopened.",
		link: null,
	};
}

/** `STALE_REVISION`, with the label of its one action. */
export function staleRevisionCopy(
	options: { subject?: "timesheet" | "entry"; personName?: string | null } = {},
): { message: string; actionLabel: string } {
	if (options.subject === "entry") {
		return {
			message: "This entry changed. Reload to see the latest version.",
			actionLabel: "Reload",
		};
	}
	const who = firstName(options.personName);
	return {
		message: who
			? `${who} changed this timesheet while you were looking.`
			: "This timesheet changed while you were looking.",
		actionLabel: "Review the latest",
	};
}

/** All-or-nothing bulk approve failed on one person's sheet (L24, A10). */
export function bulkApproveFailedCopy(personName?: string | null): {
	message: string;
	actionLabel: string;
} {
	const name = personName?.trim();
	return {
		message: name
			? `Nothing was approved: ${possessive(name)} timesheet changed.`
			: "Nothing was approved: a timesheet changed.",
		actionLabel: "Review",
	};
}

/** Why a Waiting-for-you row can't be bulk-selected. */
export const APPROVAL_DISABLED_COPY = {
	flags: "Has flags. Open it to review.",
	overLimit: "Over the limit. Open it to decide the overtime.",
} as const;

/** Starting while a timer runs: "Stop *Fix login bug* (1:12) and start this?" */
export function switchTimerPrompt(
	taskLabel: string | null | undefined,
	elapsedSeconds: number | null | undefined,
): { text: string; task: string; elapsed: string; confirmLabel: string } {
	const task = taskLabel?.trim() || "your running timer";
	const elapsed = formatClock(elapsedSeconds, "0:00");
	return {
		text: `Stop ${task} (${elapsed}) and start this?`,
		task,
		elapsed,
		confirmLabel: "Switch",
	};
}

/** The locked For chip: "Submitted Oct 6. Withdraw to change." */
export function lockedChipCopy(
	status: TimesheetStatus,
	day: string | null | undefined,
): string {
	if (status === "approved") {
		return day
			? `Approved ${day}. Ask to reopen to change.`
			: "Approved. Ask to reopen to change.";
	}
	return day
		? `Submitted ${day}. Withdraw to change.`
		: "Submitted. Withdraw to change.";
}

/** Why a long timer stopped (`flagged_reason`). */
export function flaggedReasonCopy(
	reason: FlaggedReason | (string & {}) | null | undefined,
	options: { agreementLabel?: string | null } = {},
): string | null {
	if (reason === "auto_stopped_24h") {
		return "Stopped automatically after 24 hours. Check the end time.";
	}
	if (reason === "stopped_by_assignment_end") {
		return `Stopped when ${scopePhrase("engagement", options.agreementLabel)} ended.`;
	}
	return null;
}

/** A row Change For can't move into an agreement (L58). */
export function beforeAgreementCopy(
	startDate: string | null | undefined,
	options: DateFormatOptions = {},
): string {
	return startDate
		? `Logged before this agreement started on ${formatLocalDay(startDate, options)}.`
		: "Logged before this agreement started.";
}

/** The Change For dialog's estimate note (web only: native never says "rate"). */
export function changeForRatesNote(
	options: { native?: boolean } = {},
): string | null {
	return (options.native ?? isNativeApp())
		? null
		: "Rates are re-estimated for the new choice.";
}

/** Account deletion (ux.md › Project Surfaces; D70 copy, which the backend also sends). */
export const TIME_ACCOUNT_DELETION_COPY = {
	openTimesheets:
		"Your open timesheets will be sent for approval when you delete your account.",
	TEAM_HAS_OPEN_TIME:
		"This team has time waiting for approval or payment. Hand it to another member instead of deleting it.",
	WORKSPACE_HAS_OPEN_TIME:
		"This workspace has time waiting for approval or payment. Hand it to another member instead of deleting it.",
} as const;

// ── Warnings ────────────────────────────────────────────────────────────────

/**
 * The agreement's own weekly limit (L12): "Your agreement with Acme allows
 * 40h a week. You logged 43h 30m. The 3h 30m over needs Ana's approval."
 */
export function contractLimitCopy(options: {
	label?: string | null;
	limitMinutes: number;
	loggedMinutes: number;
	/** Who decides the overtime; omitted, the sentence stops after the totals. */
	approverName?: string | null;
}): string {
	const subject = capitalize(scopePhrase("engagement", options.label));
	let text = `${subject} allows ${formatMinutesText(options.limitMinutes)} a week. You logged ${formatMinutesText(options.loggedMinutes)}.`;
	const over = options.loggedMinutes - options.limitMinutes;
	const approver = firstName(options.approverName);
	if (approver && over > 0) {
		text += ` The ${formatMinutesText(over)} over needs ${possessive(approver)} approval.`;
	}
	return text;
}

/**
 * A workspace or team policy limit (A6, D65). An indicator only: the policy
 * limit never cuts payable time, so the sentence never says hours are cut.
 */
export function policyLimitCopy(options: {
	label?: string | null;
	limitMinutes: number;
	loggedMinutes: number;
}): string {
	const label = options.label?.trim();
	const limit = formatMinutesText(options.limitMinutes);
	const head = label
		? `${label} has a ${limit} weekly limit.`
		: `There's a ${limit} weekly limit here.`;
	return `${head} You've logged ${formatMinutesText(options.loggedMinutes)} this week.`;
}

/** One write-time warning (`warnings[]` on start, create and PATCH). */
export function entryWarningCopy(
	warning: EntryWarning,
	options: { agreementLabel?: string | null; native?: boolean } = {},
): string {
	let text: string;
	switch (warning.code) {
		case "OVERLAP": {
			const n = Array.isArray(warning.entry_ids) ? warning.entry_ids.length : 0;
			text =
				n > 1
					? `This overlaps ${n} other entries.`
					: "This overlaps another entry.";
			break;
		}
		case "CONTRACT_WEEKLY_LIMIT":
			text = contractLimitCopy({
				label: options.agreementLabel,
				limitMinutes: warning.limit_minutes,
				loggedMinutes: warning.logged_minutes,
			});
			break;
		case "POLICY_WEEKLY_LIMIT":
			text = policyLimitCopy({
				label: warning.label,
				limitMinutes: warning.limit_minutes,
				loggedMinutes: warning.logged_minutes,
			});
			break;
		default:
			text = "Check this entry before you submit.";
	}
	return nativeSafe(text, { native: options.native });
}

/** Every warning, in order, skipping repeats. */
export function entryWarningsCopy(
	warnings: readonly EntryWarning[] | null | undefined,
	options: { agreementLabel?: string | null; native?: boolean } = {},
): string[] {
	const out: string[] = [];
	for (const warning of warnings ?? []) {
		const text = entryWarningCopy(warning, options);
		if (!out.includes(text)) out.push(text);
	}
	return out;
}

/**
 * The review screen's weekly-limit line, without its ⏱ icon:
 * "Weekly limit 40h (Prodigitality) · 38:15 logged · within limit" (policy,
 * an indicator) or "Weekly limit 40h in the agreement with Acme Corp · 43:30
 * logged · 3:30 over" (agreement, which can cut payable time).
 */
export function weeklyLimitLine(options: {
	source: "policy" | "agreement";
	label?: string | null;
	limitMinutes: number;
	loggedSeconds: number;
}): string {
	const label = options.label?.trim();
	const limit = formatMinutesText(options.limitMinutes);
	const where =
		options.source === "agreement"
			? label
				? ` in the agreement with ${label}`
				: " in the agreement"
			: label
				? ` (${label})`
				: "";
	const over = Math.max(0, options.loggedSeconds - options.limitMinutes * 60);
	const tail = over > 0 ? `${formatClock(over)} over` : "within limit";
	return `Weekly limit ${limit}${where} · ${formatClock(options.loggedSeconds)} logged · ${tail}`;
}

/** The over-the-limit panel (agreement or member caps only, never a policy limit). */
export function overLimitCopy(options: {
	overSeconds: number;
	payableSeconds: number;
}): { checkbox: string; hint: string } {
	return {
		checkbox: `Approve the ${formatDurationText(options.overSeconds)} over the limit`,
		hint: `Left unticked, ${formatClock(options.payableSeconds)} is approved for payment; the extra time stays on record.`,
	};
}

// ── Toasts (ux.md › Copy, Action | Toast) ───────────────────────────────────

export type TimeToastAction =
	| "submit"
	| "approve"
	| "return"
	| "withdraw"
	| "reopen"
	| "request_reopen"
	| "approve_bulk";

export interface TimeToastContext {
	/** submit: where the sheet went. */
	approverScope?: ApproverScope | null;
	deciders?: readonly TimeDecider[] | null;
	goesTo?: GoesToContext;
	/** submit (auto/self) and approve: the sheet's total, shown as h:mm. */
	totalSeconds?: number | null;
	/** return and reopen: the sheet's person. */
	personName?: string | null;
	/** reopen: the member reopened their own sheet. */
	ownSheet?: boolean;
	/** approve_bulk. */
	count?: number;
}

/**
 * | Action       | Toast                                                       |
 * |--------------|-------------------------------------------------------------|
 * | Submit       | "Sent to <approver> for approval." / "Approved · 38:15"     |
 * | Approve      | "Approved · 38:15 frozen"                                   |
 * | Return       | "Returned to Maria"                                         |
 * | Withdraw     | "Withdrawn. You can edit again."                            |
 * | Reopen       | "Reopened. Maria can edit again." / "…You can edit again."  |
 * | Bulk approve | "Approved 3 timesheets"                                     |
 */
export function timeToast(
	action: TimeToastAction,
	ctx: TimeToastContext = {},
): string {
	const total =
		ctx.totalSeconds === undefined || ctx.totalSeconds === null
			? null
			: formatClock(ctx.totalSeconds);
	const person = firstName(ctx.personName);
	switch (action) {
		case "submit": {
			if (ctx.approverScope === "auto" || ctx.approverScope === "self") {
				return total ? `Approved · ${total}` : "Approved";
			}
			const target = goesToTarget(ctx.approverScope, ctx.deciders, ctx.goesTo);
			return `Sent to ${target ?? "your approvers"} for approval.`;
		}
		case "approve":
			return total ? `Approved · ${total} frozen` : "Approved";
		case "return":
			return person ? `Returned to ${person}` : "Returned";
		case "withdraw":
			return "Withdrawn. You can edit again.";
		case "reopen":
			if (ctx.ownSheet) return "Reopened. You can edit again.";
			return person ? `Reopened. ${person} can edit again.` : "Reopened.";
		case "request_reopen":
			return "Asked to reopen. The approvers have your note.";
		case "approve_bulk": {
			const n = Math.max(0, Math.trunc(ctx.count ?? 0));
			return `Approved ${plural(n, "timesheet", "timesheets")}`;
		}
		default:
			return "Done.";
	}
}

// ── Errors (ux.md › Error codes as shown to people) ─────────────────────────

/** What the UI should offer next to the message. */
export type TimeCopyAction =
	| "pick_for"
	| "why"
	| "switch_timer"
	| "withdraw"
	| "review_latest"
	| "reload"
	| "update_app"
	| "retry";

export interface TimeErrorCopy {
	/** The error's code (`TIMESHEET_LOCKED`, `TIME_INTERNAL`, `HTTP_400`, …). */
	code: string;
	status: number;
	/** What people read. Never a raw server message or code. */
	message: string;
	/** ux.md *hidden*: raised by a web-only surface; native renders nothing for it. */
	hidden: boolean;
	action: TimeCopyAction | null;
	/** A 404: render a reason card ("…doesn't exist or you can't open it."). */
	notFound: boolean;
	/** The plan key behind a plan-limit 403. */
	planKey: TimePlanKey | null;
}

export interface TimeErrorCopyContext extends DateFormatOptions {
	native?: boolean;
	/** The scope the refusal is about: a team, a workspace or the agreement's counterparty. */
	label?: string | null;
	/** What `label` names; agreement kinds read "your agreement with Acme". */
	labelKind?: Kind | null;
	/** The workspace whose plan is short, for plan-limit copy. */
	workspaceName?: string | null;
	/** The person a timesheet belongs to (stale revisions, return notes). */
	personName?: string | null;
	/** The policy's retroactive window, for `RETROACTIVE_WINDOW`. */
	retroactiveDays?: number | null;
	/** The sheet's period kind ("This week's…" vs "This period's…"). */
	periodKind?: PeriodKind | null;
	/** The sheet's last day, for `too_early`. */
	periodEnd?: string | null;
	/** What a 404 is about (default: what the code says). */
	subject?: "entry" | "timesheet" | "scope";
	/** `TIME_INTERNAL` on a read says "couldn't load", on a write "couldn't save". */
	operation?: "read" | "write";
	/** A name for the payout on a settled sheet ("#12"). */
	payoutLabel?: string | null;
}

interface ErrorFacts {
	code: string;
	status: number;
	serverMessage: string;
	extras: Record<string, unknown>;
	planLimitKey: string | null;
}

type CopyResult = Pick<TimeErrorCopy, "message"> &
	Partial<Pick<TimeErrorCopy, "hidden" | "action" | "notFound" | "planKey">>;

type CopyHandler = (
	facts: ErrorFacts,
	ctx: TimeErrorCopyContext & { native: boolean },
) => CopyResult;

const NOT_FOUND_COPY = {
	entry: "This time entry doesn't exist or you can't open it.",
	timesheet: "This timesheet doesn't exist or you can't open it.",
	scope: "This doesn't exist or you can't open it.",
} as const;

const GENERIC_COPY = {
	client: "Proyekto couldn't finish this. Check the details and try again.",
	server: "Proyekto couldn't finish this. Try again.",
	network:
		"Proyekto couldn't reach the server. Check your connection and try again.",
	unexpected: "Something went wrong in Proyekto. Try again.",
	save: "Proyekto couldn't save this time. Try again.",
	load: "Proyekto couldn't load this time. Try again.",
} as const;

/** Policy and team-rule field names as people read them. */
const POLICY_FIELD_LABEL: Record<string, string> = {
	tracking_enabled: "time on workspace projects",
	period_kind: "the timesheet period",
	week_start: "the week start",
	timezone: "the timezone",
	period_anchor: "the period start",
	approval_required: "approval",
	approver_scope: "approvers",
	allow_manual_entries: "manual time",
	retroactive_days: "how far back time can be added",
	rounding_minutes: "rounding",
	weekly_limit_minutes: "the weekly limit",
	reminder_days: "the reminder",
	hidden_presets: "presets",
};

function fieldList(fields: readonly string[]): string {
	const labels = fields
		.map((field) => POLICY_FIELD_LABEL[field.trim()] ?? null)
		.filter((label): label is string => Boolean(label));
	if (!labels.length) return "";
	if (labels.length === 1) return labels[0];
	return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * The server's message when it is already a sentence written for people
 * (every fixed message in the time module is); null for class-validator
 * output ("note must be shorter…"), field names and fragments.
 */
function humanServerMessage(message: string | null | undefined): string | null {
	const text = message?.trim();
	if (!text || text.length > 240) return null;
	if (!/^[A-Z]/.test(text) || !/[.!?]$/.test(text)) return null;
	if (/[_{}<>[\]]|\b(?:must|should) (?:be|not)\b|\bproperty\b/.test(text)) {
		return null;
	}
	return text;
}

function serverOr(facts: ErrorFacts, fallback: string): string {
	return humanServerMessage(facts.serverMessage) ?? fallback;
}

/** "Only the team owner can change: approval_required, rounding_minutes" → people words. */
function ownerFieldsCopy(message: string): string | null {
	const match = /^Only the team owner can change: (.+)$/.exec(message.trim());
	if (!match) return null;
	const list = fieldList(match[1].split(","));
	return list
		? `Only the team owner can change ${list}.`
		: "Only the team owner can change these rules.";
}

const CODE_COPY: Record<TimeErrorCode, CopyHandler> = {
	NO_LOGGING_CONTEXT: () => ({
		message: "You can't log time on this project.",
		action: "why",
	}),
	MANUAL_ENTRIES_DISABLED: (_f, ctx) => ({
		message: manualTimeOffCopy({ label: ctx.label, labelKind: ctx.labelKind }),
	}),
	TIME_ENTRY_NO_PROJECT_ACCESS: () => ({
		message: "You don't have access to this project.",
	}),
	TIME_ENTRY_NOT_ON_PROJECT_TEAM: (_f, ctx) => ({
		message: ctx.label?.trim()
			? `You're not on ${ctx.label.trim()} for this project.`
			: "You're not on this team for this project.",
	}),
	TIME_ENTRY_NOT_WORKSPACE_MEMBER: (_f, ctx) => ({
		message: ctx.label?.trim()
			? `You need a seat in ${ctx.label.trim()} to log time for it.`
			: "You need a seat in this workspace to log time for it.",
	}),
	PAYOUT_SELF_NOT_ALLOWED: () => ({
		message: "Someone else on the team has to record your payment.",
		hidden: true,
	}),
	TIME_NOT_FOUND: (facts, ctx) => {
		const subject =
			ctx.subject ??
			(facts.serverMessage.trim() === NOT_FOUND_COPY.scope ? "scope" : "entry");
		return { message: NOT_FOUND_COPY[subject], notFound: true };
	},
	TIMESHEET_NOT_FOUND: () => ({
		message: NOT_FOUND_COPY.timesheet,
		notFound: true,
	}),
	LOGGING_FOR_REQUIRED: () => ({
		message: "Choose who this time is for.",
		action: "pick_for",
	}),
	TIMESHEET_LOCKED: (facts, ctx) => {
		if (facts.extras.reason === "period") {
			const sheetStatus = str(
				facts.extras.sheet_status,
			) as TimesheetStatus | null;
			return {
				message: lockedPeriodCopy({
					label: ctx.label,
					periodKind: ctx.periodKind,
					sheetStatus,
				}),
				action: sheetStatus === "approved" ? null : "withdraw",
			};
		}
		return { message: "This entry is on a submitted or approved timesheet." };
	},
	TIMER_ALREADY_RUNNING: () => ({
		message: "You already have a timer running.",
		action: "switch_timer",
	}),
	TIMER_NOT_RUNNING: (facts) => ({
		message: serverOr(facts, "This timer isn't running any more."),
		action: "reload",
	}),
	TIMESHEET_HAS_SETTLED_ENTRIES: (facts, ctx) => ({
		message: settledEntriesCopy(facts.extras, {
			native: ctx.native,
			payoutLabel: ctx.payoutLabel,
		}).message,
	}),
	STALE_REVISION: (facts, ctx) => {
		const subject =
			facts.extras.entry_id !== undefined &&
			facts.extras.timesheet_id === undefined
				? "entry"
				: "timesheet";
		return {
			message: staleRevisionCopy({ subject, personName: ctx.personName })
				.message,
			action: subject === "entry" ? "reload" : "review_latest",
		};
	},
	TIMESHEET_TRANSITION_INVALID: (facts, ctx) => {
		const reason = str(facts.extras.reason);
		const action: TimeCopyAction | null =
			reason === "state" || reason === "action" || reason === "arguments"
				? "reload"
				: reason === "freeze_required" || reason === "freeze_invalid"
					? "review_latest"
					: null;
		return {
			message: transitionReasonCopy(reason, {
				periodEnd: ctx.periodEnd,
				personName: ctx.personName,
				now: ctx.now,
				userTimezone: ctx.userTimezone,
				year: ctx.year,
			}),
			action,
		};
	},
	LEGACY_CONTRACT_AMBIGUOUS: (facts) => ({
		message:
			facts.extras.reason === "contracts"
				? "Another hourly contract on this project bills the same team's hours. End or amend one of them first."
				: "More than one team could bill hours on this contract. Set the provider's team on the contract first.",
		hidden: true,
	}),
	APPROVED_TIME_ASSIGNMENT_LOCKED: () => ({
		message: "This assignment has approved time, so it can't change.",
	}),
	INVOICE_TIME_ENTRY_NOT_BILLABLE: (facts) => ({
		message:
			facts.extras.reason === "reservation_mismatch"
				? "The hours on this invoice changed since it was drafted. Rebuild the draft to bill them."
				: "This time can't be billed.",
		hidden: true,
	}),
	TIMESHEETS_REPLACED_REVIEW: (_f, ctx) => ({
		message: ctx.native
			? "Update the app to approve timesheets."
			: "Approvals now happen by timesheet. Reload Proyekto.",
		action: ctx.native ? "update_app" : "reload",
	}),
	APP_UPDATE_REQUIRED: () => ({
		message: "Update Proyekto to keep tracking time",
		action: "update_app",
	}),
	LOGGING_FOR_INVALID: () => ({
		message: "That choice isn't available any more. Pick again.",
		action: "pick_for",
	}),
	RETROACTIVE_WINDOW: (facts, ctx) => ({
		message: retroactiveWindowCopy({
			label: ctx.label,
			labelKind: ctx.labelKind,
			days: ctx.retroactiveDays,
			earliestDate: str(facts.extras.earliest_date),
			now: ctx.now,
			userTimezone: ctx.userTimezone,
			year: ctx.year,
		}),
	}),
	HOUR_CAP_EXCEEDED: (facts, ctx) => ({
		message: hourCapCopy(facts.extras, { label: ctx.label }),
	}),
	TEAM_RATES_REQUIRE_APPROVAL: (_f, ctx) => ({
		message: ctx.native
			? "Approval has to stay on for this team."
			: "Approval stays on while member rates are on.",
	}),
	FIXED_RATE_NOT_PAYABLE_BY_ENTRY: () => ({
		message: "Fixed-fee time is paid as a manual payment, not by entry.",
		hidden: true,
	}),
	ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED: () => ({
		message: "Which client agreement is this work for?",
	}),
	ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER: () => ({
		message:
			"This agreement's hirer doesn't deliver the client agreement on this project.",
		hidden: true,
	}),
	TIME_POLICY_INVALID: (facts) => {
		const fields = Array.isArray(facts.extras.fields)
			? facts.extras.fields.filter((f): f is string => typeof f === "string")
			: [];
		const list = fieldList(fields);
		return {
			message: list
				? `Those time settings aren't valid. Check ${list}.`
				: "Those time settings aren't valid.",
		};
	},
	WORK_ITEM_INVALID: (facts) => ({
		message: serverOr(facts, "Pick a task from this project."),
	}),
	TIME_LOG_ASSIGNMENT_INVALID: () => ({
		message: "This time is outside the agreement's dates.",
	}),
	TIME_LOG_OUTSIDE_ASSIGNMENT_WINDOW: () => ({
		message: "This time is outside the agreement's dates.",
	}),
};

/** Codes outside `TimeErrorCode` that time surfaces still meet. */
const OTHER_COPY: Record<string, CopyHandler> = {
	TIME_INTERNAL: (facts, ctx) => {
		const server = facts.serverMessage.trim();
		if (/^Proyekto couldn't (?:save|load)\b/.test(server)) {
			return { message: server, action: "retry" };
		}
		return {
			message: ctx.operation === "read" ? GENERIC_COPY.load : GENERIC_COPY.save,
			action: "retry",
		};
	},
	NETWORK_ERROR: () => ({ message: GENERIC_COPY.network, action: "retry" }),
	CLIENT_ERROR: () => ({ message: GENERIC_COPY.unexpected, action: "retry" }),
	plan_limit: (facts, ctx) => {
		const key = isTimePlanKey(facts.planLimitKey) ? facts.planLimitKey : null;
		if (key) {
			const copy = timePlanCopy(key, {
				workspaceName: ctx.workspaceName,
				native: ctx.native,
			});
			return copy
				? { message: copy, planKey: key }
				: { message: NATIVE_WEB_ONLY_COPY, planKey: key, hidden: true };
		}
		return {
			message: serverOr(facts, "This isn't on your workspace's current plan."),
		};
	},
	missing_permission: (facts) => ({
		message: serverOr(facts, "You don't have permission to do that."),
	}),
	TEAM_HAS_OPEN_TIME: () => ({
		message: TIME_ACCOUNT_DELETION_COPY.TEAM_HAS_OPEN_TIME,
	}),
	WORKSPACE_HAS_OPEN_TIME: () => ({
		message: TIME_ACCOUNT_DELETION_COPY.WORKSPACE_HAS_OPEN_TIME,
	}),
};

function httpCopy(facts: ErrorFacts, ctx: TimeErrorCopyContext): CopyResult {
	const owner = ownerFieldsCopy(facts.serverMessage);
	if (owner) return { message: owner };
	const human = humanServerMessage(facts.serverMessage);
	if (facts.status === 404) {
		return {
			message: NOT_FOUND_COPY[ctx.subject ?? "scope"],
			notFound: true,
		};
	}
	if (human) return { message: human };
	return {
		message: facts.status >= 500 ? GENERIC_COPY.server : GENERIC_COPY.client,
		action: facts.status >= 500 ? "retry" : null,
	};
}

function resolveCopy(
	facts: ErrorFacts,
	ctx: TimeErrorCopyContext & { native: boolean },
): CopyResult {
	const handler =
		(CODE_COPY as Record<string, CopyHandler | undefined>)[facts.code] ??
		OTHER_COPY[facts.code];
	if (handler) return handler(facts, ctx);
	if (facts.code.startsWith("HTTP_") || facts.status >= 400) {
		return httpCopy(facts, ctx);
	}
	return { message: serverOr(facts, GENERIC_COPY.unexpected) };
}

/**
 * What to tell people about a failed time call. Accepts anything thrown (a
 * `TimeApiError`, an axios error, a plain Error) and never returns a raw code,
 * a class-validator string or Postgres text.
 */
export function timeErrorCopy(
	error: unknown,
	ctx: TimeErrorCopyContext = {},
): TimeErrorCopy {
	const err = toTimeApiError(error);
	const native = ctx.native ?? isNativeApp();
	// A PlanLimitError thrown by another service reads as a plain client error
	// to toTimeApiError; its info still names the key.
	const plan = err.planLimit ?? parsePlanLimitError(error);
	const facts: ErrorFacts = {
		code:
			plan && err.code !== "plan_limit" && err.status === 0
				? "plan_limit"
				: String(err.code),
		status: plan && err.status === 0 ? 403 : err.status,
		serverMessage: typeof err.message === "string" ? err.message : "",
		extras: isRecord(err.extras) ? err.extras : {},
		planLimitKey: plan?.limitKey ?? null,
	};
	const result = resolveCopy(facts, { ...ctx, native });
	const hidden = result.hidden ?? false;
	const message = native
		? hidden
			? NATIVE_WEB_ONLY_COPY
			: nativeSafe(result.message, { native: true, stripAmounts: true })
		: result.message;
	return {
		code: facts.code,
		status: facts.status,
		message,
		hidden,
		action: result.action ?? null,
		notFound: result.notFound ?? false,
		planKey: result.planKey ?? null,
	};
}

/** Just the sentence (toasts, inline errors). */
export function timeErrorMessage(
	error: unknown,
	ctx: TimeErrorCopyContext = {},
): string {
	return timeErrorCopy(error, ctx).message;
}
