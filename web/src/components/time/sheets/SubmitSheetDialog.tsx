// web/src/components/time/sheets/SubmitSheetDialog.tsx
//
// The Submit sheet (ux.md › Submit, Return, Reopen › Submit flow, step 2):
//
// - per-day totals in the sheet's own timezone;
// - who it goes to, from A1's `routing_preview` ("Goes to Prodigitality
//   Services Inc. Team's owners and admins", "Goes to Ana Reyes",
//   "Submitting confirms these hours for your agreement with Acme Corp.",
//   "You're the only approver here, so this approves itself.", or "No one
//   else can approve this. Add a workspace admin." when the decider list came
//   back empty);
// - blockers: a timer running inside the period, an empty sheet, a period
//   that has not reached its last day (manual routing);
// - acknowledged warnings the member ticks to continue: Needs-review entries
//   (10 h or longer, or stopped automatically), days over 8 h, entries added
//   after their day, and hours over a limit that cuts payable time (the
//   agreement's weekly limit, L12; a team member's weekly cap). A workspace
//   or team policy limit is an indicator only (D65): one line, no tick.
//
// The dialog reads the sheet's detail (`GET /time/timesheets/:id`) for the
// entries, the fresh revision and `viewer.actions`; the card's summary is the
// fallback while it loads. Submitting goes through `useTimesheetActions`, so
// the toast, the invalidation and the stale-revision banner match every
// other sheet action.

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, Info, Loader2, Send } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { LONG_TIMER_SECONDS } from "@/components/time/timer/liveDuration";
import {
	contractLimitCopy,
	flaggedReasonCopy,
	nativeSafe,
	policyLimitCopy,
	timeErrorCopy,
	transitionReasonCopy,
} from "@/lib/timeErrors";
import {
	formatClock,
	formatDurationText,
	formatLocalDay,
	formatMinutesText,
	formatPeriodRange,
	goesToCopy,
	sheetScopeLabel,
	weekdayShort,
} from "@/lib/timeFormat";
import {
	eachDay,
	isoDow,
	localDate,
	safeTimezone,
	todayIn,
} from "@/lib/timePeriods";
import { cn } from "@/lib/utils";
import { timeQueries } from "@/queries/time";
import type {
	LoggingForRequest,
	ResolvedTimePolicy,
	SheetRoutingPreview,
	TimeEntryView,
	TimesheetDetail,
	TimesheetRow,
	TimesheetSummary,
} from "@/services/time.types";
import { StaleRevisionBanner } from "./StaleRevisionBanner";
import { useTimesheetActions } from "./useTimesheetActions";

// ── Pure checks (exported for tests and the review screen) ─────────────────

/** A day over this many seconds gets ⚠ (the same rule as the live day total). */
export const DAY_WARNING_SECONDS = 8 * 3600;

export interface SheetDayTotal {
	/** Local date in the sheet's timezone. */
	date: string;
	seconds: number;
	/** Over 8 h. */
	over: boolean;
}

type SheetBasics = Pick<
	TimesheetSummary,
	"period_start" | "period_end" | "timezone"
>;

function entrySeconds(entry: TimeEntryView): number {
	return Math.max(0, entry.duration_seconds ?? 0);
}

/** Every day of the period with its logged seconds, in the sheet's timezone. */
export function sheetDayTotals(
	sheet: SheetBasics,
	entries: readonly TimeEntryView[],
): { days: SheetDayTotal[]; totalSeconds: number } {
	const tz = safeTimezone(sheet.timezone);
	const byDay = new Map<string, number>();
	let total = 0;
	for (const entry of entries) {
		const seconds = entrySeconds(entry);
		total += seconds;
		const day = localDate(entry.started_at, tz);
		byDay.set(day, (byDay.get(day) ?? 0) + seconds);
	}
	const days = eachDay({
		start: sheet.period_start,
		end: sheet.period_end,
	}).map((date) => {
		const seconds = byDay.get(date) ?? 0;
		return { date, seconds, over: seconds > DAY_WARNING_SECONDS };
	});
	return { days, totalSeconds: total };
}

/**
 * The policy to read for limits: the context of the sheet's first entry with
 * a project (any of them carries the same governing limit). Weekly sheets
 * only, where the sheet's total is the week's total.
 */
export function sheetPolicyRef(
	sheet: Pick<TimesheetSummary, "period_kind">,
	entries: readonly TimeEntryView[],
): { projectId: string; forRef: LoggingForRequest } | null {
	if (sheet.period_kind !== "weekly") return null;
	for (const entry of entries) {
		if (!entry.project_id || entry.context_kind === "personal") continue;
		if (!entry.context_ref) continue;
		return {
			projectId: entry.project_id,
			forRef: { kind: entry.context_kind, id: entry.context_ref },
		};
	}
	return null;
}

export interface SubmitWarning {
	/** Stable per kind ("long", "flagged", "days", "late", "agreement_limit", "member_cap", "policy_limit"). */
	id: string;
	text: string;
	/** True: the member ticks it to continue. False: an indicator line only. */
	ack: boolean;
}

export interface SubmitChecks {
	blockers: string[];
	warnings: SubmitWarning[];
	days: SheetDayTotal[];
	totalSeconds: number;
}

function count(n: number, one: string, many: string): string {
	return n === 1 ? one : many.replace("{n}", String(n));
}

export interface SubmitChecksInput {
	sheet: Pick<
		TimesheetSummary,
		| "status"
		| "scope_kind"
		| "scope_label_snapshot"
		| "period_kind"
		| "period_start"
		| "period_end"
		| "timezone"
		| "entry_count"
		| "running_count"
	>;
	entries: readonly TimeEntryView[];
	/** `viewer.actions` from the detail; null while it loads (no "not allowed" blocker). */
	actions?: readonly string[] | null;
	/** The context policy (weekly sheets), for limits. */
	policy?: ResolvedTimePolicy | null;
	preview?: SheetRoutingPreview | null;
	now?: Date;
	userTimezone?: string;
}

/** Blockers, acknowledged warnings and indicator lines for a submit. */
export function submitChecks(input: SubmitChecksInput): SubmitChecks {
	const { sheet, entries } = input;
	const tz = safeTimezone(sheet.timezone);
	const dateOptions = {
		now: input.now,
		userTimezone: input.userTimezone ?? tz,
	};
	const { days, totalSeconds } = sheetDayTotals(sheet, entries);
	const blockers: string[] = [];
	const warnings: SubmitWarning[] = [];

	// Blockers.
	const running =
		entries.some((e) => !e.ended_at) || (sheet.running_count ?? 0) > 0;
	const empty = entries.length === 0 && (sheet.entry_count ?? 0) === 0;
	if (running) blockers.push(transitionReasonCopy("running_entry"));
	if (empty) blockers.push(transitionReasonCopy("empty"));
	if (
		!running &&
		!empty &&
		input.actions &&
		!input.actions.includes("submit")
	) {
		const today = todayIn(tz, input.now);
		if (sheet.status !== "open" && sheet.status !== "returned") {
			blockers.push(transitionReasonCopy("state"));
		} else if (today < sheet.period_end) {
			blockers.push(
				transitionReasonCopy("too_early", {
					periodEnd: sheet.period_end,
					...dateOptions,
				}),
			);
		} else {
			blockers.push(transitionReasonCopy("not_allowed"));
		}
	}

	// Needs review: stopped automatically, then 10 h or longer.
	const flagged = entries.filter((e) => Boolean(e.flagged_reason));
	if (flagged.length === 1) {
		warnings.push({
			id: "flagged",
			text:
				flaggedReasonCopy(flagged[0].flagged_reason, {
					agreementLabel:
						sheet.scope_kind === "engagement"
							? sheet.scope_label_snapshot
							: null,
				}) ?? "1 entry was stopped automatically. Check its end time.",
			ack: true,
		});
	} else if (flagged.length > 1) {
		warnings.push({
			id: "flagged",
			text: `${flagged.length} entries were stopped automatically. Check their end times.`,
			ack: true,
		});
	}
	const long = entries.filter(
		(e) => !e.flagged_reason && entrySeconds(e) >= LONG_TIMER_SECONDS,
	).length;
	if (long > 0) {
		warnings.push({
			id: "long",
			text: count(
				long,
				"1 entry ran 10h or longer.",
				"{n} entries ran 10h or longer.",
			),
			ack: true,
		});
	}

	// Days over 8 h.
	const overDays = days.filter((d) => d.over);
	if (overDays.length > 0) {
		const named = overDays.map(
			(d) =>
				`${formatLocalDay(d.date, { ...dateOptions, weekday: true })} (${formatDurationText(d.seconds)})`,
		);
		warnings.push({
			id: "days",
			text:
				overDays.length === 1
					? `${formatLocalDay(overDays[0].date, { ...dateOptions, weekday: true })} is over 8h (${formatDurationText(overDays[0].seconds)}).`
					: `${overDays.length} days are over 8h: ${named.join(", ")}.`,
			ack: true,
		});
	}

	// Entries added after their day.
	const late = entries.filter(
		(e) =>
			Boolean(e.created_at) &&
			localDate(e.created_at, tz) > localDate(e.started_at, tz),
	).length;
	if (late > 0) {
		warnings.push({
			id: "late",
			text: count(
				late,
				"1 entry was added after its day.",
				"{n} entries were added after their day.",
			),
			ack: true,
		});
	}

	// Limits (weekly sheets, where the sheet's total is the week's).
	const policy = input.policy;
	if (policy && sheet.period_kind === "weekly") {
		const loggedMinutes = Math.floor(totalSeconds / 60);
		const limit = policy.weekly_limit_minutes;
		const source = policy.sources?.weekly_limit_minutes;
		if (typeof limit === "number" && limit > 0 && loggedMinutes > limit) {
			if (source === "contract") {
				const approver =
					input.preview?.approver_scope === "hirer"
						? (input.preview.deciders[0]?.display_name ?? null)
						: null;
				warnings.push({
					id: "agreement_limit",
					text: contractLimitCopy({
						label: sheet.scope_label_snapshot,
						limitMinutes: limit,
						loggedMinutes,
						approverName: approver,
					}),
					ack: true,
				});
			} else if (source === "workspace" || source === "team") {
				warnings.push({
					id: "policy_limit",
					text: policyLimitCopy({
						label: sheet.scope_label_snapshot,
						limitMinutes: limit,
						loggedMinutes,
					}),
					ack: false,
				});
			}
		}
		const cap = policy.member?.weekly_limit_hours;
		if (typeof cap === "number" && cap > 0 && loggedMinutes > cap * 60) {
			const label = sheet.scope_label_snapshot?.trim();
			warnings.push({
				id: "member_cap",
				text: `Your weekly limit${label ? ` for ${label}` : ""} is ${formatMinutesText(cap * 60)}. You logged ${formatMinutesText(loggedMinutes)}. The ${formatMinutesText(loggedMinutes - cap * 60)} over needs approval.`,
				ack: true,
			});
		}
	}

	return { blockers, warnings, days, totalSeconds };
}

// ── Component ───────────────────────────────────────────────────────────────

export interface SubmitSheetDialogProps {
	open: boolean;
	onClose: () => void;
	/** The card's sheet (A1 `routing_preview` / A2 `deciders` when sent). */
	sheet: TimesheetSummary;
	/** After a successful submit (the dialog closes itself). */
	onSubmitted?: (row: TimesheetRow) => void;
	/** The policy workspace's name ("Goes to Acme's workspace owners and admins" on a team sheet). */
	workspaceName?: string | null;
	/** Raise above another dialog. */
	zIndex?: number;
	/** Tests and fixed clocks. */
	now?: Date;
	userTimezone?: string;
}

const PRIMARY =
	"inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
	"rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50";

/** The sheet as the detail knows it (fresh revision), with the A1/A2 fields of either. */
function mergedSheet(
	summary: TimesheetSummary,
	detail: TimesheetDetail | undefined,
): TimesheetSummary {
	if (!detail) return summary;
	return {
		...summary,
		...detail.sheet,
		routing_preview:
			detail.routing_preview ??
			detail.sheet.routing_preview ??
			summary.routing_preview,
		deciders: detail.deciders ?? detail.sheet.deciders ?? summary.deciders,
	};
}

export function SubmitSheetDialog({
	open,
	onClose,
	sheet: summary,
	onSubmitted,
	workspaceName,
	zIndex,
	now,
	userTimezone,
}: SubmitSheetDialogProps) {
	const detailQuery = useQuery({
		...timeQueries.timesheet(summary.id),
		enabled: open && Boolean(summary.id),
	});
	const detail = detailQuery.data;
	const sheet = useMemo(() => mergedSheet(summary, detail), [summary, detail]);
	const entries = useMemo(() => detail?.entries ?? [], [detail]);
	const policyRef = useMemo(
		() => (detail ? sheetPolicyRef(sheet, detail.entries) : null),
		[detail, sheet],
	);
	const policyQuery = useQuery({
		...timeQueries.projectPolicy(policyRef?.projectId, policyRef?.forRef),
		enabled: open && Boolean(policyRef),
	});

	const actions = useTimesheetActions({ workspaceName });
	const [acked, setAcked] = useState<ReadonlySet<string>>(new Set());
	const headingId = useId();

	// A fresh start each time the dialog opens or the sheet changes.
	const { clearFailure } = actions;
	useEffect(() => {
		if (!open) return;
		setAcked(new Set());
		clearFailure();
	}, [open, summary.id, clearFailure]);

	const preview = sheet.routing_preview ?? null;
	const checks = useMemo(
		() =>
			submitChecks({
				sheet,
				entries,
				actions: detail?.viewer.actions ?? null,
				policy: policyQuery.data ?? null,
				preview,
				now,
				userTimezone,
			}),
		[sheet, entries, detail, policyQuery.data, preview, now, userTimezone],
	);

	const goesTo = goesToCopy(
		preview?.approver_scope ??
			(sheet.status === "returned" ? sheet.approver_scope : null),
		preview?.deciders,
		{
			scopeKind: sheet.scope_kind,
			label: sheet.scope_label_snapshot,
			workspaceName,
		},
	);
	const label = sheetScopeLabel(sheet.scope_kind, sheet.scope_label_snapshot);
	const period = formatPeriodRange(sheet.period_start, sheet.period_end, {
		timezone: sheet.timezone,
		now,
		userTimezone,
	});
	const resubmit = sheet.status === "returned";
	const ackWarnings = checks.warnings.filter((w) => w.ack);
	const infoWarnings = checks.warnings.filter((w) => !w.ack);
	const allAcked = ackWarnings.every((w) => acked.has(w.id));
	const submitting = actions.isPending("submit", sheet.id);
	const loadError = detailQuery.isError
		? timeErrorCopy(detailQuery.error, {
				subject: "timesheet",
				operation: "read",
			})
		: null;
	const ready = Boolean(detail) && !loadError;
	// The over-limit warnings (agreement limit, member cap) need the policy:
	// until it answers, Submit waits so a quick tap can't skip their tick. A
	// failed policy read still lets the sheet go (the server re-checks limits).
	const limitsPending = Boolean(policyRef) && policyQuery.isPending;
	const canSubmit =
		ready &&
		!limitsPending &&
		checks.blockers.length === 0 &&
		allAcked &&
		!submitting;
	const shortDays = checks.days.length <= 7;
	const shownDays = shortDays
		? checks.days
		: checks.days.filter((d) => d.seconds > 0);
	const failure = actions.failure;

	const toggle = (id: string, checked: boolean) =>
		setAcked((current) => {
			const next = new Set(current);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});

	const submit = async () => {
		if (!canSubmit) return;
		const outcome = await actions.submit(sheet);
		if (outcome.ok) {
			const row = outcome.rows[0];
			if (row) onSubmitted?.(row);
			onClose();
		}
	};

	const reviewLatest = () => {
		actions.clearFailure();
		setAcked(new Set());
		void detailQuery.refetch();
	};

	return (
		<AppDialog
			open={open}
			onClose={onClose}
			busy={submitting}
			zIndex={zIndex}
			size="md"
			title={resubmit ? "Resubmit timesheet" : "Submit timesheet"}
			description={nativeSafe(`${label} · ${period}`)}
			footer={
				<>
					<button
						type="button"
						className={SECONDARY}
						onClick={onClose}
						disabled={submitting}
					>
						Cancel
					</button>
					<button
						type="button"
						className={PRIMARY}
						onClick={() => void submit()}
						disabled={!canSubmit}
					>
						{submitting ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
						) : (
							<Send className="h-4 w-4" aria-hidden="true" />
						)}
						{resubmit ? "Resubmit" : "Submit"}
					</button>
				</>
			}
		>
			<div className="space-y-4 text-sm">
				{goesTo ? (
					<p
						className="flex items-start gap-2 text-foreground"
						data-testid="submit-goes-to"
					>
						<Send
							className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
						<span>{nativeSafe(goesTo)}</span>
					</p>
				) : null}

				{loadError ? (
					<div
						role="alert"
						className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2"
					>
						<span className="min-w-0 flex-1 text-foreground">
							{loadError.message}
						</span>
						<button
							type="button"
							className={SECONDARY}
							onClick={() => void detailQuery.refetch()}
						>
							Try again
						</button>
					</div>
				) : !detail ? (
					<p className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
						Loading this timesheet…
					</p>
				) : (
					<section aria-labelledby={headingId}>
						<h3
							id={headingId}
							className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
						>
							{`Days (${sheet.timezone})`}
						</h3>
						{shownDays.length > 0 ? (
							<ul
								className={cn(
									"grid gap-1.5",
									shortDays ? "grid-cols-4 sm:grid-cols-7" : "grid-cols-2",
								)}
								data-testid="submit-days"
							>
								{shownDays.map((day) => (
									<li
										key={day.date}
										className={cn(
											"rounded-lg border px-2 py-1.5",
											day.over
												? "border-warning/40 bg-warning/10"
												: "border-border bg-surface-muted",
										)}
									>
										<span className="block text-[11px] text-muted-foreground">
											{shortDays
												? weekdayShort(isoDow(day.date))
												: formatLocalDay(day.date, {
														now,
														userTimezone: userTimezone ?? sheet.timezone,
														weekday: true,
													})}
										</span>
										<span className="flex items-center gap-1 font-semibold tabular-nums text-foreground">
											{day.seconds > 0 ? formatClock(day.seconds) : "–"}
											{day.over ? (
												<AlertTriangle
													className="h-3 w-3 text-warning"
													aria-label="Over 8h"
												/>
											) : null}
										</span>
									</li>
								))}
							</ul>
						) : null}
						<p className="mt-2 flex items-center justify-between font-semibold text-foreground">
							<span>Total</span>
							<span className="tabular-nums" data-testid="submit-total">
								{formatClock(checks.totalSeconds)}
							</span>
						</p>
					</section>
				)}

				{checks.blockers.length > 0 ? (
					<ul className="space-y-1.5" data-testid="submit-blockers">
						{checks.blockers.map((text) => (
							<li
								key={text}
								className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-foreground"
							>
								<Ban
									className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
									aria-hidden="true"
								/>
								<span>{nativeSafe(text)}</span>
							</li>
						))}
					</ul>
				) : null}

				{ready && limitsPending ? (
					<p
						role="status"
						className="flex items-center gap-2 text-muted-foreground"
						data-testid="submit-limits-pending"
					>
						<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
						Checking limits…
					</p>
				) : null}

				{ready && ackWarnings.length > 0 ? (
					<fieldset className="space-y-1.5" data-testid="submit-warnings">
						<legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Check before you send
						</legend>
						{ackWarnings.map((warning) => (
							<label
								key={warning.id}
								className="flex cursor-pointer items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-foreground"
							>
								<input
									type="checkbox"
									className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
									checked={acked.has(warning.id)}
									onChange={(e) => toggle(warning.id, e.currentTarget.checked)}
								/>
								<span>{nativeSafe(warning.text)}</span>
							</label>
						))}
					</fieldset>
				) : null}

				{ready && infoWarnings.length > 0 ? (
					<ul className="space-y-1" data-testid="submit-info">
						{infoWarnings.map((warning) => (
							<li
								key={warning.id}
								className="flex items-start gap-2 text-muted-foreground"
							>
								<Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
								<span>{nativeSafe(warning.text)}</span>
							</li>
						))}
					</ul>
				) : null}

				{failure ? (
					failure.kind === "stale" ? (
						<StaleRevisionBanner
							message={failure.message}
							onReviewLatest={reviewLatest}
							busy={detailQuery.isFetching}
						/>
					) : (
						<p role="alert" className="text-sm text-destructive">
							{failure.message}
						</p>
					)
				) : null}
			</div>
		</AppDialog>
	);
}
