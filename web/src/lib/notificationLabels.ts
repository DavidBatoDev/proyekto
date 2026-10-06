import {
	AlarmClock,
	Briefcase,
	CheckCircle2,
	Clock3,
	FolderInput,
	Info,
	type LucideIcon,
	MessageCircle,
	RotateCcw,
	Timer,
	TimerOff,
	Undo2,
	Users,
	Wallet,
	XCircle,
} from "lucide-react";

/**
 * How each notification type reads in the header bell and on /notifications.
 *
 * Both used to keep their own if-chains, and they had drifted: the bell knew
 * the team-invite types the page did not, and the page had icons the bell
 * never needed. One table now feeds both.
 *
 * Time types follow ux.md › Notifications. The historical per-entry review
 * types (`time_log_approval_requested`, `_approved`, `_rejected`, `_pending`,
 * `_day_rejected`) are no longer sent, but rows already written still list:
 * they keep their old label, prefixed "(older)", and their stored links reach
 * the new pages through the team-time redirect stubs.
 *
 * Labels carry no amount and none of the words the installed app strips
 * (contract, rate, payout, invoice), so the same label serves web and native.
 */

/** A theme tone; `notificationToneClass` turns it into a text colour token. */
export type NotificationTone =
	| "primary"
	| "info"
	| "success"
	| "warning"
	| "destructive"
	| "muted";

export interface NotificationLabel {
	/** The title line. Already carries the "(older)" prefix when `older`. */
	label: string;
	icon: LucideIcon;
	tone: NotificationTone;
	/** A type that is no longer sent; its rows are history. */
	older: boolean;
}

const OLDER_PREFIX = "(older)";

type Entry = Omit<NotificationLabel, "older" | "label"> & {
	label: string;
	older?: true;
};

const LABELS: Record<string, Entry> = {
	// ── Projects, teams and the marketplace ─────────────────────────────────
	project_invite_received: {
		label: "New project invite",
		icon: Briefcase,
		tone: "primary",
	},
	project_invite_responded: {
		label: "Invite response",
		icon: Briefcase,
		tone: "primary",
	},
	project_team_invite_received: {
		label: "Your team is invited",
		icon: Users,
		tone: "primary",
	},
	project_team_invite_responded: {
		label: "Invite response",
		icon: Users,
		tone: "primary",
	},
	marketplace_profile_live: {
		label: "Profile is live",
		icon: CheckCircle2,
		tone: "success",
	},
	task_assigned: { label: "Task assigned", icon: Briefcase, tone: "info" },

	// ── Chat and comments ───────────────────────────────────────────────────
	chat_mention: { label: "Mention", icon: MessageCircle, tone: "primary" },
	chat_dm_received: {
		label: "New message",
		icon: MessageCircle,
		tone: "primary",
	},
	task_comment_mention: {
		label: "Mentioned in task",
		icon: MessageCircle,
		tone: "primary",
	},
	feature_comment_mention: {
		label: "Mentioned in feature",
		icon: MessageCircle,
		tone: "primary",
	},
	epic_comment_mention: {
		label: "Mentioned in epic",
		icon: MessageCircle,
		tone: "primary",
	},

	// ── Time: timesheets ────────────────────────────────────────────────────
	timesheet_submitted: {
		label: "Timesheet to review",
		icon: Clock3,
		tone: "warning",
	},
	timesheet_returned: {
		label: "Timesheet returned",
		icon: Undo2,
		tone: "warning",
	},
	timesheet_approved: {
		label: "Timesheet approved",
		icon: CheckCircle2,
		tone: "success",
	},
	timesheet_reopened: {
		label: "Timesheet reopened",
		icon: RotateCcw,
		tone: "info",
	},
	timesheet_reopen_requested: {
		label: "Reopen requested",
		icon: RotateCcw,
		tone: "warning",
	},
	timesheet_reminder: {
		label: "Time to submit",
		icon: AlarmClock,
		tone: "info",
	},
	timesheets_imported: {
		label: "Timesheets moved",
		icon: FolderInput,
		tone: "info",
	},

	// ── Time: timers, payments, comments ────────────────────────────────────
	timer_running_long: {
		label: "Timer still running",
		icon: Timer,
		tone: "warning",
	},
	timer_auto_stopped: {
		label: "Timer stopped",
		icon: TimerOff,
		tone: "warning",
	},
	time_payout_recorded: {
		label: "Payment recorded",
		icon: Wallet,
		tone: "success",
	},
	// Kept from the old model, under its new wording.
	time_log_comment_added: {
		label: "New comment on your time",
		icon: MessageCircle,
		tone: "info",
	},

	// ── Time: the retired per-entry review (history only) ───────────────────
	time_log_approval_requested: {
		label: "Time approval requested",
		icon: Clock3,
		tone: "muted",
		older: true,
	},
	time_log_approved: {
		label: "Time log approved",
		icon: CheckCircle2,
		tone: "muted",
		older: true,
	},
	time_log_rejected: {
		label: "Time log rejected",
		icon: XCircle,
		tone: "muted",
		older: true,
	},
	time_log_pending: {
		label: "Time log reset to pending",
		icon: Clock3,
		tone: "muted",
		older: true,
	},
	time_log_day_rejected: {
		label: "Daily logs rejected",
		icon: XCircle,
		tone: "muted",
		older: true,
	},
};

const FALLBACK: NotificationLabel = {
	label: "Notification",
	icon: Info,
	tone: "muted",
	older: false,
};

/** Own keys only: a type named `toString` must not find Object.prototype. */
function entryFor(typeName: string | null | undefined): Entry | undefined {
	return typeName && Object.hasOwn(LABELS, typeName)
		? LABELS[typeName]
		: undefined;
}

/** The full presentation of a notification type; unknown types get the fallback. */
export function notificationLabelFor(
	typeName: string | null | undefined,
): NotificationLabel {
	const entry = entryFor(typeName);
	if (!entry) return FALLBACK;
	const older = entry.older === true;
	return {
		label: older ? `${OLDER_PREFIX} ${entry.label}` : entry.label,
		icon: entry.icon,
		tone: entry.tone,
		older,
	};
}

/** Just the title line. */
export function notificationLabel(typeName: string | null | undefined): string {
	return notificationLabelFor(typeName).label;
}

/** Whether the type is known to this table (the rest render the fallback). */
export function hasNotificationLabel(
	typeName: string | null | undefined,
): boolean {
	return entryFor(typeName) !== undefined;
}

const TONE_CLASS: Record<NotificationTone, string> = {
	primary: "text-primary",
	info: "text-info",
	success: "text-success",
	warning: "text-warning",
	destructive: "text-destructive",
	muted: "text-muted-foreground",
};

/** The theme text-colour class for a tone (never a hex). */
export function notificationToneClass(tone: NotificationTone): string {
	return TONE_CLASS[tone];
}

/**
 * The body line. The server writes `content.message` for every current type;
 * the other fields are what older rows carried before it did, and their
 * sentences describe that older model as it was (ux.md: "Unchanged").
 */
export function notificationBody(
	content: Record<string, unknown> | null | undefined,
): string {
	const message = content?.message;
	if (typeof message === "string" && message.trim()) return message;
	const reason = content?.reason;
	if (typeof reason === "string" && reason.trim()) return `Reason: ${reason}`;
	const day = content?.day;
	if (typeof day === "string" && day.trim()) return `Day: ${day}`;
	const status = content?.status;
	if (typeof status === "string") {
		if (status === "approved") return "Your logged time was approved.";
		if (status === "rejected") return "Your logged time was rejected.";
		if (status === "pending") return "A time log was moved back to pending.";
		return `Invite was ${status}.`;
	}
	return "You have a new update.";
}
