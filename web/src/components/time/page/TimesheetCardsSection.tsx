// web/src/components/time/page/TimesheetCardsSection.tsx
//
// "Timesheets in this week" (ux.md › The Time Page › Timesheet cards): one
// card per sheet that overlaps the view week, labelled by sheet scope. The
// card itself is W1-4's presentational `TimesheetCard`; this section lays
// them out and wires Submit, Fix and Withdraw to the page.
//
// "Just me" time has no sheets, so a person who only tracks for themselves
// (P1) sees no section at all.

import { timeErrorMessage } from "@/lib/timeErrors";
import { cn } from "@/lib/utils";
import type {
	TimesheetEventRow,
	TimesheetSummary,
} from "@/services/time.types";
import { TimeReasonCard } from "../shared/TimeReasonCard";
import { TimesheetCard } from "../sheets/TimesheetCard";

export const TIMESHEET_CARDS_COPY = {
	title: "Timesheets in this week",
	retry: "Try again",
} as const;

export interface TimesheetCardsSectionProps {
	sheets: readonly TimesheetSummary[];
	loading?: boolean;
	error?: unknown;
	onRetry?: () => void;
	onSubmit?: (sheet: TimesheetSummary) => void;
	onFix?: (sheet: TimesheetSummary) => void;
	onWithdraw?: (sheet: TimesheetSummary) => void;
	/** An action on this card is in flight. */
	isBusy?: (sheetId: string) => boolean;
	/** Display names by user id ("Returned by Ana"). */
	names?: Readonly<Record<string, string>>;
	/** Events by sheet id, so a returned card can say "Reopened by Ana". */
	events?: Readonly<Record<string, readonly TimesheetEventRow[]>>;
	/** Workspace names by id ("Waiting on Acme's owners and admins"). */
	workspaceNames?: Readonly<Record<string, string>>;
	/** The sheet being fixed (its card is marked). */
	fixingId?: string | null;
	/**
	 * Each sheet's `reminder_days` by id, for "sends itself <date>" (D85; see
	 * `reminderDaysBySheet`). A sheet missing here uses its own
	 * `reminder_days`, else the card's default of 1 day.
	 */
	reminderDays?: Readonly<Record<string, number>>;
	now?: Date;
	userTimezone?: string;
	className?: string;
}

export function TimesheetCardsSection({
	sheets,
	loading = false,
	error,
	onRetry,
	onSubmit,
	onFix,
	onWithdraw,
	isBusy,
	names,
	events,
	workspaceNames,
	fixingId,
	reminderDays,
	now,
	userTimezone,
	className,
}: TimesheetCardsSectionProps) {
	const headingId = "time-sheets-heading";
	if (error) {
		return (
			<section
				aria-labelledby={headingId}
				className={cn("space-y-2", className)}
			>
				<SectionTitle id={headingId} />
				<TimeReasonCard
					variant="inline"
					tone="danger"
					title={timeErrorMessage(error, {
						operation: "read",
						subject: "timesheet",
					})}
					action={
						onRetry ? (
							<button
								type="button"
								onClick={onRetry}
								className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
							>
								{TIMESHEET_CARDS_COPY.retry}
							</button>
						) : null
					}
				/>
			</section>
		);
	}
	if (loading && sheets.length === 0) {
		return (
			<section
				aria-labelledby={headingId}
				aria-busy="true"
				className={cn("space-y-2", className)}
			>
				<SectionTitle id={headingId} />
				<div className="h-14 animate-pulse rounded-xl border border-border bg-muted/50" />
			</section>
		);
	}
	if (sheets.length === 0) return null;
	return (
		<section
			aria-labelledby={headingId}
			className={cn("space-y-2", className)}
			data-testid="timesheet-cards"
		>
			<SectionTitle id={headingId} />
			<ul className="space-y-2">
				{sheets.map((sheet) => (
					<li key={sheet.id}>
						<TimesheetCard
							sheet={sheet}
							onSubmit={onSubmit}
							onFix={onFix}
							onWithdraw={onWithdraw}
							busy={isBusy?.(sheet.id) ?? false}
							names={names}
							events={events?.[sheet.id]}
							workspaceName={
								sheet.policy_workspace_id
									? (workspaceNames?.[sheet.policy_workspace_id] ?? null)
									: null
							}
							reminderDays={reminderDays?.[sheet.id] ?? sheet.reminder_days}
							now={now}
							userTimezone={userTimezone}
							className={
								fixingId === sheet.id ? "ring-2 ring-warning/40" : undefined
							}
						/>
					</li>
				))}
			</ul>
		</section>
	);
}

function SectionTitle({ id }: { id: string }) {
	return (
		<h2
			id={id}
			className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
		>
			{TIMESHEET_CARDS_COPY.title}
		</h2>
	);
}
