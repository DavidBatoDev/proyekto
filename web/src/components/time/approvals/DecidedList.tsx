// web/src/components/time/approvals/DecidedList.tsx
//
// "Decided in the last 30 days" (ux.md › The Time Page › Approver mode): the
// sheets the viewer approved or returned (never their own), newest decision
// first, from `GET /time/approvals?status=decided`.
//
//   ✓ Maria Santos   Sep 15–21   40:00   Approved by you · Sep 23
//   ↩ Leo Cruz       Sep 15–21    9:30   Returned by you · 'Add task names'
//
// Each row links to the review screen. No amounts, ever.

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Circle, CornerUpLeft } from "lucide-react";
import { useId } from "react";
import { ForWorkspaceTag } from "@/components/time/for/ForChip";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import { sheetPersonName } from "@/components/time/sheets/useTimesheetActions";
import { nativeSafe, timeErrorCopy } from "@/lib/timeErrors";
import {
	chipLabel,
	deviceTimeZone,
	firstName,
	formatClock,
	formatInstantDay,
	formatPeriodRange,
	SUBLABEL_NOTE_MAX,
	sheetStatusView,
	truncateLabel,
} from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import { timeQueries } from "@/queries/time";
import type { ApprovalRow, SheetScopeKind } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

/** What a decided row says: "Approved by you · Sep 23", "Returned by you · 'Add task names'". */
export function decidedLine(
	row: Pick<
		ApprovalRow,
		| "status"
		| "decided_by"
		| "decided_at"
		| "decision_note"
		| "overtime_approved"
		| "scope_kind"
		| "period_start"
		| "period_end"
		| "timezone"
	>,
	options: {
		viewerId?: string | null;
		names?: Readonly<Record<string, string | null | undefined>>;
		now?: Date;
		timezone?: string;
	} = {},
): string {
	const tz = options.timezone ?? deviceTimeZone();
	const who =
		row.decided_by && options.viewerId && row.decided_by === options.viewerId
			? "you"
			: firstName(row.decided_by ? options.names?.[row.decided_by] : null);
	const by = who ? ` by ${who}` : "";
	const day = formatInstantDay(row.decided_at, tz, {
		now: options.now,
		userTimezone: tz,
	});
	const when = day === "—" ? "" : ` · ${day}`;
	switch (row.status) {
		case "approved":
			return `Approved${by}${when}${row.overtime_approved ? " · Overtime approved" : ""}`;
		case "returned": {
			const note = row.decision_note?.trim();
			return note
				? `Returned${by} · '${truncateLabel(note, SUBLABEL_NOTE_MAX)}'`
				: `Returned${by}${when}`;
		}
		default: {
			// Decided by the viewer, then moved on (resubmitted, withdrawn): say where it is now.
			const view = sheetStatusView(row, { now: options.now });
			return view.label;
		}
	}
}

export interface DecidedListProps {
	/** As WaitingForYouList: rows of another policy workspace get a tag (E27). */
	currentWorkspaceId?: string | null;
	/** `YYYY-MM-DD`; the server defaults to the last 30 days. */
	since?: string;
	scopeKind?: SheetScopeKind;
	/** The header; `null` hides it. */
	title?: string | null;
	/** Rows to show (the API allows up to 100). */
	limit?: number;
	/** Render nothing when nothing was decided (default true). */
	hideWhenEmpty?: boolean;
	now?: Date;
	userTimezone?: string;
	className?: string;
}

const STATUS_ICON = {
	approved: { icon: Check, className: "text-success", label: "Approved" },
	returned: {
		icon: CornerUpLeft,
		className: "text-warning",
		label: "Returned",
	},
} as const;

export function DecidedList({
	currentWorkspaceId,
	since,
	scopeKind,
	title = "Decided in the last 30 days",
	limit = 50,
	hideWhenEmpty = true,
	now,
	userTimezone,
	className,
}: DecidedListProps) {
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const query = useQuery(
		timeQueries.approvals(userId, {
			status: "decided",
			since,
			scope_kind: scopeKind,
			limit: Math.min(Math.max(1, Math.floor(limit)), 100),
		}),
	);
	const headingId = useId();
	const tz = userTimezone ?? deviceTimeZone();
	const rows = query.data?.items ?? [];

	if (query.isPending) return null;
	if (query.isError) {
		const copy = timeErrorCopy(query.error, {
			subject: "scope",
			operation: "read",
		});
		return (
			<section className={className} data-testid="decided-list">
				{title ? <DecidedTitle id={headingId} title={title} /> : null}
				<TimeReasonCard
					variant="inline"
					tone="danger"
					title={copy.message}
					action={
						<button
							type="button"
							className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
							onClick={() => void query.refetch()}
						>
							Try again
						</button>
					}
				/>
			</section>
		);
	}
	if (rows.length === 0 && hideWhenEmpty) return null;

	return (
		<section
			aria-labelledby={title ? headingId : undefined}
			className={cn("space-y-2", className)}
			data-testid="decided-list"
		>
			{title ? <DecidedTitle id={headingId} title={title} /> : null}
			{rows.length === 0 ? (
				<p className="rounded-xl border border-border bg-card px-3 py-3 text-sm text-muted-foreground">
					Nothing decided yet.
				</p>
			) : (
				<ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
					{rows.map((row) => {
						const status =
							row.status === "approved" || row.status === "returned"
								? STATUS_ICON[row.status]
								: null;
						const Icon = status?.icon ?? Circle;
						const name = sheetPersonName(row) ?? "Someone";
						const label = chipLabel(row.scope_label_snapshot ?? "");
						const period = formatPeriodRange(row.period_start, row.period_end, {
							timezone: row.timezone,
							now,
							userTimezone: tz,
						});
						const line = nativeSafe(
							decidedLine(row, { viewerId: userId, now, timezone: tz }),
						);
						const tagged =
							currentWorkspaceId !== undefined &&
							row.policy_workspace != null &&
							row.policy_workspace.id !== currentWorkspaceId;
						return (
							<li
								key={row.id}
								data-testid="decided-row"
								data-status={row.status}
							>
								<Link
									to="/time/timesheets/$timesheetId"
									params={{ timesheetId: row.id }}
									className="group flex items-center gap-3 px-3 py-2 hover:bg-muted/50"
								>
									<Icon
										className={cn(
											"h-4 w-4 shrink-0",
											status?.className ?? "text-muted-foreground",
										)}
										aria-label={status?.label ?? sheetStatusView(row).label}
									/>
									<span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
										<span className="truncate text-sm font-semibold text-foreground group-hover:text-primary sm:w-40 sm:shrink-0">
											{name}
										</span>
										<span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
											<span className="truncate" title={label.title}>
												{label.text}
											</span>
											<span aria-hidden="true">·</span>
											<span className="shrink-0">{period}</span>
											{tagged ? (
												<ForWorkspaceTag name={row.policy_workspace?.name} />
											) : null}
										</span>
										<span
											className="min-w-0 truncate text-xs text-muted-foreground sm:ml-auto sm:max-w-[18rem]"
											title={line}
											data-testid="decided-line"
										>
											{line}
										</span>
									</span>
									<span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
										{formatClock(row.total_seconds ?? row.logged_seconds)}
									</span>
								</Link>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

function DecidedTitle({ id, title }: { id: string; title: string }) {
	return (
		<h2
			id={id}
			className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
		>
			{title}
		</h2>
	);
}
