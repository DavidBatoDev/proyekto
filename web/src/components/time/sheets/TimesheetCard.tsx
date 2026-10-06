// web/src/components/time/sheets/TimesheetCard.tsx
//
// One timesheet card on the Time page (ux.md › The Time Page › Timesheet
// cards): one per sheet that overlaps the view week, labelled by sheet scope.
//
//   ▣ Prodigitality Services Inc. Team  Sep 29–Oct 5  28:45  Open · until Oct 5   [Submit]
//   ▣ Acme Corp · agreement             Sep 22–28      6:00  Returned · 'Split…'  [Fix] [Resubmit]
//   ▣ Acme                              Oct 1–15       4:00  Open · sends itself Oct 17
//
// | `scope_kind` | Web label                           | Native label      |
// |--------------|-------------------------------------|-------------------|
// | `workspace`  | Workspace name ("Acme")             | Same              |
// | `team`       | Team name, cut + full-name tooltip  | Same              |
// | `engagement` | "Acme Corp · agreement"             | "Acme Corp"       |
//
// Status words and sublabels come from `sheetStatusView` (four states, the
// rest sublabels: "until Oct 5", "sends itself Oct 17", "overdue", "Waiting
// on Ana Reyes" (A2), "Returned by Ana · 'Split Thursday'"). The accent bar is
// grey for Submitted, green for Approved, amber for Returned (theme tokens).
//
// The card is presentational: the page wires Submit (the Submit sheet), Fix
// (filter the list to this sheet) and Withdraw (`useTimesheetActions`).

import { Link } from "@tanstack/react-router";
import { Briefcase, Building, Loader2, Users } from "lucide-react";
import { useMemo } from "react";
import {
	CARD_LABEL_MAX,
	formatClock,
	formatPeriodRange,
	type SheetTone,
	sheetScopeLabel,
	sheetStatusView,
	truncateLabel,
} from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import type {
	SheetScopeKind,
	TimesheetEventRow,
	TimesheetSummary,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

export interface TimesheetCardProps {
	sheet: TimesheetSummary;
	/** Defaults to the signed-in user ("Reopened by you"). */
	viewerId?: string | null;
	/** Opens the Submit sheet. Shown from the period's last day (any time for auto/self) and for Returned. */
	onSubmit?: (sheet: TimesheetSummary) => void;
	/** Returned only: filters the list to this sheet so its rows can be fixed. */
	onFix?: (sheet: TimesheetSummary) => void;
	/** Submitted only, the member's own sheet. */
	onWithdraw?: (sheet: TimesheetSummary) => void;
	/** An action on this card is in flight. */
	busy?: boolean;
	/** The policy's `reminder_days` for "sends itself <date>" (default 1). */
	reminderDays?: number | null;
	/** The policy workspace's name ("Waiting on Acme's owners and admins" on a team sheet). */
	workspaceName?: string | null;
	/** Display names by user id ("Returned by Ana"). */
	names?: Readonly<Record<string, string | null | undefined>>;
	/** The sheet's history, when the caller has it ("Reopened by you"). */
	events?: readonly TimesheetEventRow[] | null;
	/** Links the label to `/time/timesheets/<id>` (default true). */
	linkToReview?: boolean;
	/** Tests and fixed clocks. */
	now?: Date;
	/** The reader's timezone (defaults to the device's). */
	userTimezone?: string;
	className?: string;
}

const ACCENT: Record<SheetTone, string> = {
	neutral: "border-l-border",
	muted: "border-l-muted-foreground/50",
	warning: "border-l-warning",
	success: "border-l-success",
};

const PILL: Record<SheetTone, string> = {
	neutral: "bg-muted text-foreground",
	muted: "bg-muted text-muted-foreground",
	warning: "bg-warning/15 text-foreground",
	success: "bg-success/15 text-foreground",
};

const SCOPE_ICON: Record<SheetScopeKind, typeof Users> = {
	team: Users,
	workspace: Building,
	engagement: Briefcase,
};

const PRIMARY =
	"inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
	"inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

/** The card's label and its tooltip (set only when the name was cut). */
export function timesheetCardLabel(
	sheet: Pick<TimesheetSummary, "scope_kind" | "scope_label_snapshot">,
	options: { native?: boolean } = {},
): { text: string; title: string | undefined } {
	const raw = sheet.scope_label_snapshot ?? "";
	const cut = truncateLabel(raw, CARD_LABEL_MAX) !== raw.trim();
	return {
		text: sheetScopeLabel(sheet.scope_kind, raw, {
			native: options.native,
			max: CARD_LABEL_MAX,
		}),
		title: cut
			? sheetScopeLabel(sheet.scope_kind, raw, { native: options.native })
			: undefined,
	};
}

export function TimesheetCard({
	sheet,
	viewerId: viewerIdProp,
	onSubmit,
	onFix,
	onWithdraw,
	busy = false,
	reminderDays,
	workspaceName,
	names,
	events,
	linkToReview = true,
	now,
	userTimezone,
	className,
}: TimesheetCardProps) {
	const signedIn = useAuthStore((state) => state.user?.id ?? null);
	const viewerId = viewerIdProp === undefined ? signedIn : viewerIdProp;
	const view = useMemo(
		() =>
			sheetStatusView(sheet, {
				now,
				userTimezone,
				viewerId,
				reminderDays,
				names,
				events,
				workspaceName,
			}),
		[
			sheet,
			now,
			userTimezone,
			viewerId,
			reminderDays,
			names,
			events,
			workspaceName,
		],
	);
	const label = timesheetCardLabel(sheet);
	const period = formatPeriodRange(sheet.period_start, sheet.period_end, {
		timezone: sheet.timezone,
		now,
		userTimezone,
	});
	const Icon = SCOPE_ICON[sheet.scope_kind] ?? Users;
	const isMember =
		viewerId == null ||
		sheet.member_user_id == null ||
		sheet.member_user_id === viewerId;

	const canSubmit =
		Boolean(onSubmit) &&
		isMember &&
		view.submitAvailable &&
		(sheet.entry_count ?? 0) > 0;
	const canFix = Boolean(onFix) && isMember && sheet.status === "returned";
	const canWithdraw =
		Boolean(onWithdraw) && isMember && sheet.status === "submitted";
	const sublabelTitle =
		view.sublabels.length > 1 ? view.sublabels.join(" · ") : undefined;

	const labelNode = (
		<span className="truncate" title={label.title}>
			{label.text}
		</span>
	);

	return (
		<article
			data-testid="timesheet-card"
			data-status={sheet.status}
			aria-label={`${label.title ?? label.text}, ${period}, ${view.label}`}
			className={cn(
				"flex flex-col gap-2 rounded-xl border border-l-4 border-border bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4",
				ACCENT[view.tone],
				className,
			)}
		>
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<Icon
					className="h-4 w-4 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-baseline gap-x-3 gap-y-0.5 max-sm:flex-col">
						{linkToReview ? (
							<Link
								to="/time/timesheets/$timesheetId"
								params={{ timesheetId: sheet.id }}
								className="flex min-w-0 text-sm font-semibold text-foreground hover:text-primary hover:underline"
							>
								{labelNode}
							</Link>
						) : (
							<span className="flex min-w-0 text-sm font-semibold text-foreground">
								{labelNode}
							</span>
						)}
						<span className="shrink-0 text-xs text-muted-foreground">
							{period}
						</span>
					</div>
				</div>
				<span
					className="shrink-0 text-sm font-semibold tabular-nums text-foreground"
					title="Time logged on this timesheet"
				>
					{formatClock(sheet.logged_seconds)}
				</span>
			</div>

			<div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
				<span
					className="flex min-w-0 items-center gap-1.5 text-xs"
					title={sublabelTitle}
				>
					<span
						className={cn(
							"shrink-0 rounded-full px-2 py-0.5 font-semibold",
							PILL[view.tone],
						)}
						data-testid="timesheet-card-status"
					>
						{view.label}
					</span>
					{view.sublabel ? (
						<span
							className={cn(
								"min-w-0 truncate",
								view.overdue
									? "font-semibold text-warning"
									: "text-muted-foreground",
							)}
							data-testid="timesheet-card-sublabel"
						>
							{view.sublabel}
						</span>
					) : null}
				</span>
				{canFix || canWithdraw || canSubmit ? (
					<span className="ml-auto flex shrink-0 items-center gap-2">
						{busy ? (
							<Loader2
								className="h-3.5 w-3.5 animate-spin text-muted-foreground"
								aria-label="Working"
							/>
						) : null}
						{canFix ? (
							<button
								type="button"
								className={SECONDARY}
								disabled={busy}
								onClick={() => onFix?.(sheet)}
							>
								Fix
							</button>
						) : null}
						{canWithdraw ? (
							<button
								type="button"
								className={SECONDARY}
								disabled={busy}
								onClick={() => onWithdraw?.(sheet)}
							>
								Withdraw
							</button>
						) : null}
						{canSubmit ? (
							<button
								type="button"
								className={PRIMARY}
								disabled={busy}
								onClick={() => onSubmit?.(sheet)}
							>
								{view.submitLabel}
							</button>
						) : null}
					</span>
				) : null}
			</div>
		</article>
	);
}
