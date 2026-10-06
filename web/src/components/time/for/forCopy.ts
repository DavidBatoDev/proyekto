// web/src/components/time/for/forCopy.ts
//
// Every sentence the For chip, the For picker, the "Who approves this time"
// popover and the timer flow show (ux.md › The Time Page › Timer, › For Chip,
// › Copy). W0-B's `lib/timeErrors.ts` / `lib/timeFormat.ts` were written in
// parallel; this module keeps its own copy until W3-1 folds the two together,
// except failed-call copy, which goes through `timeErrorMessage` so both
// modules filter server text the same way.
//
// Native rules (ux.md › Mobile): never the words contract, rate, payout or
// invoice; no amounts on agreement contexts; no `/engagements` links. The
// agreement copy here says "agreement" everywhere, and `nativeSafe` guards
// server text that could carry one of the banned words.

import { isNativeApp } from "@/lib/platform";
import { timeErrorMessage } from "@/lib/timeErrors";
import { isTimeApiError } from "@/services/time.service";
import type {
	EntryWarning,
	PeriodKind,
	PolicySource,
	ResolvedTimePolicy,
	TimeEntryView,
	TimesheetStatus,
	UnavailableOption,
	UnavailableReason,
} from "@/services/time.types";
import { type ForChipOption, governingEngagementId } from "./forOptions";

// ── Formats (local copies of the ux.md rules) ───────────────────────────────

/** "38h 15m", "40h", "45m" (sentences; tables use h:mm). */
export function sentenceDuration(totalSeconds: number): string {
	const minutes = Math.max(0, Math.round((totalSeconds || 0) / 60));
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m}m`;
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "Oct 6" (with the year only when it is not the current one). */
export function shortDate(
	value: string | Date | null | undefined,
	timeZone?: string,
): string {
	if (!value) return "";
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	const options: Intl.DateTimeFormatOptions = {
		month: "short",
		day: "numeric",
	};
	if (timeZone) options.timeZone = timeZone;
	const yearOf = (d: Date) =>
		new Intl.DateTimeFormat("en-US", {
			year: "numeric",
			...(timeZone ? { timeZone } : {}),
		}).format(d);
	if (yearOf(date) !== yearOf(new Date())) options.year = "numeric";
	try {
		return new Intl.DateTimeFormat("en-US", options).format(date);
	} catch {
		return new Intl.DateTimeFormat("en-US", {
			month: "short",
			day: "numeric",
		}).format(date);
	}
}

// ── Native guard ────────────────────────────────────────────────────────────

const BANNED_ON_NATIVE = /\b(contracts?|rates?|payouts?|invoices?)\b/i;

/** True when the text is safe to show in the installed app. */
export function isNativeSafe(text: string): boolean {
	return !BANNED_ON_NATIVE.test(text);
}

/** Generic copy when a server sentence cannot be shown as is. */
export const GENERIC_ERROR = "Proyekto couldn't finish this. Try again.";

/**
 * Server text, made safe for the installed app: "contract" reads
 * "agreement"; anything still naming a rate, payout or invoice falls back.
 */
export function nativeSafe(
	text: string,
	native: boolean = isNativeApp(),
	fallback: string = GENERIC_ERROR,
): string {
	if (!native) return text;
	const replaced = text
		.replace(/\bcontracts\b/g, "agreements")
		.replace(/\bcontract\b/g, "agreement")
		.replace(/\bContracts\b/g, "Agreements")
		.replace(/\bContract\b/g, "Agreement");
	return isNativeSafe(replaced) ? replaced : fallback;
}

// ── Chip and picker ─────────────────────────────────────────────────────────

export const PERSONAL_LABEL = "Just me";
export const FOR_LABEL = "For";
export const PICKER_TITLE = "Choose who this time is for";
export const REMEMBER_LABEL = "Use for new time on this project";
export const ONLY_OPTION_NOTE = "Only option on this project";
/** ux.md wording; native drops "rate" (Native rules). */
export function sameApproverNote(native: boolean = isNativeApp()): string {
	return native
		? "Same approver either way"
		: "Same approver and rate either way";
}

/** "Start for Acme Corp" / "Add for Acme Corp": one tap confirms the choice. */
export function primaryActionLabel(
	mode: "start" | "add",
	label: string,
): string {
	const name = label.trim() || PERSONAL_LABEL;
	return `${mode === "start" ? "Start" : "Add"} for ${name}`;
}

/** 🔒 chip tooltip: "Submitted Oct 6. Withdraw to change." */
export function lockedChipText(input: {
	status: TimesheetStatus | null | undefined;
	at?: string | null;
	timeZone?: string;
}): string {
	const when = shortDate(input.at ?? null, input.timeZone);
	if (input.status === "approved") {
		return when ? `Approved ${when}.` : "Approved.";
	}
	return when
		? `Submitted ${when}. Withdraw to change.`
		: "Submitted. Withdraw to change.";
}

/**
 * Why an option is greyed in the chip menu (ux.md › For Chip, `unavailable`).
 * The team rows read "<owner> has time tracking off for this team." when the
 * caller knows the team's workspace name, and "Time tracking is off for this
 * team." otherwise (the row's own title already names the team).
 */
export function unavailableReasonText(
	item: Pick<UnavailableOption, "label" | "reason" | "kind">,
	context: { ownerName?: string | null } = {},
): string {
	const label = item.label?.trim() || "This workspace";
	const reason: UnavailableReason = item.reason;
	switch (reason) {
		case "team_time_off":
			return context.ownerName?.trim()
				? `${context.ownerName.trim()} has time tracking off for this team.`
				: "Time tracking is off for this team.";
		case "plan":
			// A team row's label is the team, and teams have no plan of their
			// own: the plan is its workspace's (ux.md: "Prodigitality's plan…").
			if (context.ownerName?.trim()) {
				return `${context.ownerName.trim()}'s plan doesn't include timesheets.`;
			}
			return item.kind === "team"
				? "This team's workspace plan doesn't include timesheets."
				: `${label}'s plan doesn't include timesheets.`;
		case "contract_disabled":
			return `Time tracking is off in your agreement with ${label}.`;
		case "engagement_inactive":
			return `Your agreement with ${label} has ended.`;
		case "no_settings":
			return `Your agreement with ${label} has no time terms for this date.`;
		default:
			return "This option isn't available right now.";
	}
}

// ── 0 options ───────────────────────────────────────────────────────────────

export const CANT_LOG_TITLE = "You can't log time on this project";
export const WHY_LABEL = "Why?";

export type NoOptionsCause = "viewer" | "commenter" | "agreement_required";

/** The Why? popover when a project has no option (ux.md › Why? reasons). */
export function whyNoOptionsText(cause: NoOptionsCause): string {
	switch (cause) {
		case "agreement_required":
			return "Time on this project is logged under an agreement, and you aren't on one.";
		case "commenter":
			return "You're a commenter on this project. Ask a project admin for editor access to log time.";
		default:
			return "You're a viewer on this project. Ask a project admin for editor access to log time.";
	}
}

/** "Just me" explained (ux.md › Personas P1b). */
export function personalReasonText(
	reason: "plan" | "no_governed_option" | null | undefined,
): string {
	return reason === "plan"
		? "Your workspace's plan doesn't include timesheets; this time is just for you."
		: "This time is just for you.";
}

// ── Who approves this time ──────────────────────────────────────────────────

export const WHO_APPROVES_TITLE = "Who approves this time";
export const VIEW_TERMS_LABEL = "View terms →";

const PERIOD_WORDS: Record<PeriodKind, string> = {
	weekly: "weekly",
	biweekly: "every two weeks",
	semi_monthly: "twice a month (1–15, 16–end)",
	monthly: "monthly",
};

const WEEKDAYS = [
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"Sunday",
];

/** 1..7 (ISO, 1 = Monday) → "Monday". */
export function weekdayName(isoDay: number | null | undefined): string {
	const index = Math.round(Number(isoDay ?? 1)) - 1;
	return WEEKDAYS[index >= 0 && index < 7 ? index : 0];
}

/** "weekly · starts Monday · Asia/Manila". */
export function periodLine(
	policy: Pick<ResolvedTimePolicy, "period_kind" | "week_start" | "timezone">,
): string {
	const parts = [PERIOD_WORDS[policy.period_kind] ?? policy.period_kind];
	if (policy.period_kind === "weekly" || policy.period_kind === "biweekly") {
		parts.push(`starts ${weekdayName(policy.week_start)}`);
	}
	if (policy.timezone) parts.push(policy.timezone);
	return parts.join(" · ");
}

/** "Manual time up to 7 days back · No rounding". */
export function manualLine(
	policy: Pick<
		ResolvedTimePolicy,
		"allow_manual_entries" | "retroactive_days" | "rounding_minutes"
	>,
): string {
	let manual: string;
	if (!policy.allow_manual_entries) manual = "Manual time is off";
	else if (policy.retroactive_days && policy.retroactive_days > 0) {
		const n = policy.retroactive_days;
		manual = `Manual time up to ${n} ${n === 1 ? "day" : "days"} back`;
	} else manual = "Manual time allowed (no limit)";
	const rounding =
		policy.rounding_minutes && policy.rounding_minutes > 0
			? `Rounding: ${policy.rounding_minutes} min`
			: "No rounding";
	return `${manual} · ${rounding}`;
}

/** "Weekly limit 40h" (an indicator, never a cut, D65) and the member caps. */
export function limitsLine(
	policy: Pick<ResolvedTimePolicy, "weekly_limit_minutes" | "member">,
): string | null {
	const parts: string[] = [];
	if (policy.weekly_limit_minutes && policy.weekly_limit_minutes > 0) {
		parts.push(
			`Weekly limit ${sentenceDuration(policy.weekly_limit_minutes * 60)}`,
		);
	}
	const member = policy.member;
	if (member?.weekly_limit_hours) {
		parts.push(`Your limit ${member.weekly_limit_hours}h a week`);
	}
	if (member?.monthly_limit_hours) {
		parts.push(`Your limit ${member.monthly_limit_hours}h a month`);
	}
	return parts.length ? parts.join(" · ") : null;
}

/** The workspace name the copy can use for an option, when known. */
function workspaceNameFor(
	option: ForChipOption,
	projectWorkspaceName?: string | null,
): string | null {
	if (option.kind === "workspace") return option.label?.trim() || null;
	// The tag names the governing workspace only when it differs from the
	// project's (L57); otherwise the project's workspace governs.
	return option.workspace_tag?.trim() || projectWorkspaceName?.trim() || null;
}

/** Where the time goes ("Goes to: Acme's workspace owners and admins"). */
export function goesToText(
	option: ForChipOption,
	policy?: Pick<
		ResolvedTimePolicy,
		"approval_required" | "approver_scope" | "team_override_applied"
	> | null,
	context: {
		projectWorkspaceName?: string | null;
		personalReason?: "plan" | "no_governed_option" | null;
	} = {},
): string {
	const label = option.label?.trim() || PERSONAL_LABEL;
	if (option.kind === "personal") {
		return personalReasonText(context.personalReason);
	}
	if (option.kind === "assignment") {
		return option.approver_hint === "auto"
			? `Submitting confirms these hours for your agreement with ${label}.`
			: `Goes to: ${label}`;
	}
	let hint = option.approver_hint ?? null;
	if (!hint && policy) {
		if (!policy.approval_required) hint = "auto";
		else
			hint =
				option.kind === "team" &&
				policy.approver_scope === "team" &&
				policy.team_override_applied
					? "team"
					: "workspace";
	}
	// The same sentence as the Submit sheet's (lib/timeFormat AUTO_COPY).
	if (hint === "auto") return "Approval is off here, so this approves itself.";
	if (hint === "team") return `Goes to: ${label}'s owners and admins`;
	const ws = workspaceNameFor(option, context.projectWorkspaceName);
	return ws
		? `Goes to: ${ws}'s workspace owners and admins`
		: "Goes to: the workspace owners and admins";
}

export type WhoApprovesLineKey =
	| "goes_to"
	| "timesheet"
	| "rules"
	| "manual"
	| "limits";

export interface WhoApprovesLine {
	key: WhoApprovesLineKey;
	text: string;
	/** Where the line's value comes from (`sources`), when known. */
	source: PolicySource | null;
	/** The source as people read it ("Team override", "Acme", "Default"). */
	sourceLabel: string | null;
}

export interface WhoApprovesView {
	title: string;
	lines: WhoApprovesLine[];
	/** "View terms →" target (A8), web only; null on native or when unknown. */
	viewTermsEngagementId: string | null;
}

const RULE_FIELDS = [
	"period_kind",
	"week_start",
	"timezone",
	"approval_required",
	"approver_scope",
	"allow_manual_entries",
	"retroactive_days",
	"rounding_minutes",
	"weekly_limit_minutes",
] as const;

/** A source as a short tag. */
export function sourceLabel(
	source: PolicySource | null | undefined,
	option: ForChipOption,
	projectWorkspaceName?: string | null,
): string | null {
	switch (source) {
		case "default":
			return "Default";
		case "workspace":
			return workspaceNameFor(option, projectWorkspaceName) ?? "Workspace";
		case "team":
			return "Team override";
		case "contract":
			return "Agreement";
		case "member":
			return "Your limits";
		default:
			return null;
	}
}

function firstSource(
	sources: Record<string, PolicySource> | undefined,
	...fields: string[]
): PolicySource | null {
	for (const field of fields) {
		const value = sources?.[field];
		if (value) return value;
	}
	return null;
}

/** The "Rules:" line: the strongest layer any rule comes from. */
function rulesLine(
	option: ForChipOption,
	sources: Record<string, PolicySource> | undefined,
	projectWorkspaceName?: string | null,
): { text: string; source: PolicySource } {
	const used = new Set(
		RULE_FIELDS.map((field) => sources?.[field]).filter(Boolean),
	);
	const label = option.label?.trim() || PERSONAL_LABEL;
	if (used.has("contract")) {
		return {
			text: `Set by your agreement with ${label}`,
			source: "contract",
		};
	}
	if (used.has("team")) {
		return {
			text: `Rules: set by ${label} (team override)`,
			source: "team",
		};
	}
	if (used.has("workspace")) {
		const ws = workspaceNameFor(option, projectWorkspaceName);
		return {
			text: ws ? `Rules: set by ${ws}` : "Rules: set by the workspace policy",
			source: "workspace",
		};
	}
	return { text: "Rules: Proyekto defaults", source: "default" };
}

/**
 * The "Who approves this time" popover (ux.md › For Chip). Each line carries
 * its source. Agreements read "Set by your agreement with …" and link
 * "View terms →" on the web only.
 */
export function whoApprovesView(
	option: ForChipOption,
	policy: ResolvedTimePolicy | null | undefined,
	context: {
		native?: boolean;
		projectWorkspaceName?: string | null;
		personalReason?: "plan" | "no_governed_option" | null;
	} = {},
): WhoApprovesView {
	const native = context.native ?? isNativeApp();
	const ws = context.projectWorkspaceName ?? null;
	const lines: WhoApprovesLine[] = [];
	const goesTo = goesToText(option, policy, context);

	if (option.kind === "personal") {
		lines.push({
			key: "goes_to",
			text: goesTo,
			source: null,
			sourceLabel: null,
		});
		return { title: WHO_APPROVES_TITLE, lines, viewTermsEngagementId: null };
	}

	const sources = policy?.sources;
	const approvalSource =
		option.kind === "assignment"
			? (firstSource(sources, "approval_required") ?? "contract")
			: firstSource(sources, "approver_scope", "approval_required");
	lines.push({
		key: "goes_to",
		text: goesTo,
		source: approvalSource,
		sourceLabel: sourceLabel(approvalSource, option, ws),
	});

	if (policy) {
		const periodSource = firstSource(
			sources,
			"period_kind",
			"timezone",
			"week_start",
		);
		lines.push({
			key: "timesheet",
			text: `Timesheet: ${periodLine(policy)}`,
			source: periodSource,
			sourceLabel: sourceLabel(periodSource, option, ws),
		});
		const rules = rulesLine(option, sources, ws);
		lines.push({
			key: "rules",
			text: rules.text,
			source: rules.source,
			sourceLabel: sourceLabel(rules.source, option, ws),
		});
		const manualSource = firstSource(
			sources,
			"allow_manual_entries",
			"retroactive_days",
			"rounding_minutes",
		);
		lines.push({
			key: "manual",
			text: manualLine(policy),
			source: manualSource,
			sourceLabel: sourceLabel(manualSource, option, ws),
		});
		const limits = limitsLine(policy);
		if (limits) {
			const limitSource = policy.member
				? "member"
				: firstSource(sources, "weekly_limit_minutes");
			lines.push({
				key: "limits",
				text: limits,
				source: limitSource,
				sourceLabel: sourceLabel(limitSource, option, ws),
			});
		}
	}

	return {
		title: WHO_APPROVES_TITLE,
		lines,
		viewTermsEngagementId: native
			? null
			: governingEngagementId(option, policy),
	};
}

// ── Timer flow ──────────────────────────────────────────────────────────────

export const START_TIMER_LABEL = "Start timer";
export const ADD_TIME_LABEL = "Add time";
export const SWITCH_BUTTON = "Switch";
export const CANCEL_BUTTON = "Cancel";
export const CLOSE_BUTTON = "Close";
export const WITHDRAW_BUTTON = "Withdraw";
export const TRY_AGAIN_BUTTON = "Try again";
export const PAUSE_LABEL = "Pause";
export const RESUME_LABEL = "Resume";
export const STOP_LABEL = "Stop";
export const ON_BREAK_LABEL = "On break";
export const TIMER_RUNNING_LABEL = "Timer running";

const PRESET_LABELS: Record<string, string> = {
	meeting: "Meeting",
	review: "Review",
	admin: "Admin",
	other: "Other",
};

/** What a running entry is on: its task, else its preset ("Meeting"). */
export function entryWorkLabel(
	entry: Pick<TimeEntryView, "task" | "work_item" | "content_label"> | null,
): string {
	if (!entry) return "";
	const title = entry.task?.title?.trim();
	if (title) return title;
	if (entry.content_label?.trim()) return entry.content_label.trim();
	return PRESET_LABELS[entry.work_item] ?? "Other";
}

/** "Stop *Fix login bug* (1:12) and start this?" (ux.md › Timer › Switching). */
export function switchPromptText(workLabel: string, duration: string): string {
	return `Stop ${workLabel || "your timer"} (${duration}) and start this?`;
}

/** TIMESHEET_LOCKED {period} on a start (ux.md › Timer › Locked period). */
export function periodLockedText(input: {
	label?: string | null;
	periodKind?: PeriodKind | null;
	sheetStatus?: TimesheetStatus | null;
}): string {
	const label = input.label?.trim();
	if (input.sheetStatus && input.sheetStatus !== "submitted") {
		return label
			? `This period's ${label} timesheet is approved, so its time can't change.`
			: "This period's timesheet is approved, so its time can't change.";
	}
	const when =
		!input.periodKind || input.periodKind === "weekly"
			? "This week's"
			: "This period's";
	return label
		? `${when} ${label} timesheet is submitted. Withdraw it to add time.`
		: `${when} timesheet is submitted. Withdraw it to add time.`;
}

export const LOGGING_FOR_INVALID_TEXT =
	"That choice isn't available any more. Pick again.";
export const WITHDRAWN_TOAST = "Withdrawn. You can edit again.";
export const TIMER_STOPPED_TOAST = "Timer stopped.";
export const TIMER_PAUSED_TOAST = "On break — the work timer is paused.";

export function timerResumedToast(breakSeconds: number): string {
	const minutes = Math.round((breakSeconds || 0) / 60);
	return minutes > 0
		? `Back to work — ${minutes}m of break logged.`
		: "Back to work.";
}

/** HOUR_CAP_EXCEEDED: "This goes past the 40h weekly limit for <label>." */
export function hourCapText(
	extras: Record<string, unknown> | null | undefined,
	label?: string | null,
): string {
	const hours = Number(extras?.limit_hours);
	const window = extras?.limit_window === "monthly" ? "monthly" : "weekly";
	const who = label?.trim() || "this team";
	return Number.isFinite(hours) && hours > 0
		? `This goes past the ${hours}h ${window} limit for ${who}.`
		: `This goes past the ${window} limit for ${who}.`;
}

/** A write's warnings as toasts (indicators only; nothing was refused). */
export function entryWarningText(
	warning: EntryWarning,
	label?: string | null,
): string {
	const who = label?.trim() || "";
	switch (warning.code) {
		case "CONTRACT_WEEKLY_LIMIT":
			return `${
				who ? `Your agreement with ${who}` : "Your agreement"
			} allows ${sentenceDuration(warning.limit_minutes * 60)} a week. You've logged ${sentenceDuration(warning.logged_minutes * 60)}.`;
		case "POLICY_WEEKLY_LIMIT":
			return `${warning.label?.trim() || who || "This timesheet"} has a ${sentenceDuration(
				warning.limit_minutes * 60,
			)} weekly limit. You've logged ${sentenceDuration(warning.logged_minutes * 60)} this week.`;
		case "OVERLAP":
			return "This time overlaps another entry.";
		default:
			return "";
	}
}

/**
 * The message to show for a failed timer call. Delegates to the shared error
 * copy (`lib/timeErrors`), which keeps the server's fixed sentences and drops
 * class-validator output, pipe messages and Postgres text, so a raw "note
 * must be shorter than…" never becomes a toast. `operation` picks the
 * TIME_INTERNAL wording ("couldn't load" for reads, "couldn't save" for
 * writes).
 */
export function timerErrorText(
	error: unknown,
	native: boolean = isNativeApp(),
	operation: "read" | "write" = "write",
): string {
	if (!isTimeApiError(error)) return GENERIC_ERROR;
	if (error.code === "LOGGING_FOR_INVALID") return LOGGING_FOR_INVALID_TEXT;
	if (error.code === "NO_LOGGING_CONTEXT") return `${CANT_LOG_TITLE}.`;
	return timeErrorMessage(error, { native, operation });
}
