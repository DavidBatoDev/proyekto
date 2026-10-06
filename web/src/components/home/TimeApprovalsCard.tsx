import { Link } from "@tanstack/react-router";
import { ArrowRight, Clock } from "lucide-react";
import { useId } from "react";
import { Avatar } from "@/components/common/Avatar";
import { ForWorkspaceTag } from "@/components/time/for/ForChip";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import {
	chipLabel,
	deviceTimeZone,
	formatClock,
	formatPeriodRange,
	submittedAgo,
} from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import type { ApprovalRow } from "@/services/time.types";
import {
	approvalRowName,
	approvalRowSeconds,
	DASHBOARD_APPROVAL_ROWS,
	moreApprovalsText,
	policyWorkspaceTag,
	TIME_APPROVALS_REVIEW_ALL,
	TIME_APPROVALS_TITLE,
	timesheetsWaitingText,
	useDashboardTime,
} from "./dashboardTimeLine";

const SKELETON_KEYS = ["first", "second", "third"] as const;

export interface TimeApprovalsCardProps {
	/** Clock for "2 days ago" and the year rule (tests). */
	now?: Date;
	/** The reader's timezone (tests); defaults to the device's. */
	userTimezone?: string;
	className?: string;
}

/**
 * "Waiting for your approval · N" on the dashboard (ux.md › Approvals ›
 * Dashboard card). Rendered in DashboardWidgets' `leadContent` slot, above
 * the welcome card, only while something waits on the viewer.
 *
 * Not filtered by workspace: a decider's queue spans every workspace they
 * approve in, so a row whose sheet belongs to another one carries that
 * workspace's name as a tag (E27). Rows open the review screen; "Review all"
 * goes to Waiting for you on the Time page. Hours only, never money, so the
 * card is the same on the installed app.
 */
export function TimeApprovalsCard({
	now,
	userTimezone,
	className,
}: TimeApprovalsCardProps) {
	const headingId = useId();
	const time = useDashboardTime({ now });
	const { workspace, isLoading: workspaceLoading } = useCurrentWorkspace();

	const count = time.waitingCount;
	if (count <= 0) return null;

	const tz = userTimezone ?? deviceTimeZone();
	// While the workspace list loads nothing is tagged, so a row never flashes
	// a tag that turns out to name the dashboard's own workspace.
	const currentWorkspaceId = workspaceLoading
		? undefined
		: (workspace?.id ?? null);
	const rows = (time.approvals?.rows ?? []).slice(0, DASHBOARD_APPROVAL_ROWS);
	const more = time.approvals ? Math.max(0, count - rows.length) : 0;

	return (
		<section
			aria-labelledby={headingId}
			data-testid="time-approvals-card"
			className={cn("app-surface-card app-motion-safe p-4 sm:p-5", className)}
		>
			{/* Wraps on a narrow phone: "Review all" drops under the title rather
			    than cutting it to "Waiting for your appro…". */}
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<h2
					id={headingId}
					className="flex min-w-0 max-w-full items-center gap-2 text-sm font-semibold text-foreground sm:text-base"
				>
					<Clock className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
					<span className="truncate">{TIME_APPROVALS_TITLE}</span>
					<span aria-hidden="true" className="text-muted-foreground">
						·
					</span>
					<span className="tabular-nums" data-testid="time-approvals-count">
						{count}
					</span>
					<span className="sr-only">{timesheetsWaitingText(count)}</span>
				</h2>
				<Link
					to="/time"
					hash="waiting"
					className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
				>
					{TIME_APPROVALS_REVIEW_ALL}
					<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
				</Link>
			</div>

			{time.approvalsLoading ? (
				<ul aria-busy="true" className="mt-3 space-y-2">
					{SKELETON_KEYS.slice(0, Math.min(count, DASHBOARD_APPROVAL_ROWS)).map(
						(key) => (
							<li
								key={key}
								className="flex animate-pulse items-center gap-3 py-1.5"
							>
								<div className="h-7 w-7 rounded-full bg-muted" />
								<div className="flex-1 space-y-1.5">
									<div className="h-3 w-36 rounded bg-muted" />
									<div className="h-2.5 w-24 rounded bg-muted" />
								</div>
							</li>
						),
					)}
				</ul>
			) : rows.length > 0 ? (
				<ul className="mt-2 divide-y divide-border">
					{rows.map((row) => (
						<li key={row.id}>
							<ApprovalCardRow
								row={row}
								tag={policyWorkspaceTag(row, currentWorkspaceId)}
								now={now}
								timezone={tz}
							/>
						</li>
					))}
				</ul>
			) : null}

			{more > 0 ? (
				<Link
					to="/time"
					hash="waiting"
					className="mt-2 inline-block text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
				>
					{moreApprovalsText(more)}
				</Link>
			) : null}
		</section>
	);
}

function ApprovalCardRow({
	row,
	tag,
	now,
	timezone,
}: {
	row: ApprovalRow;
	tag: string | null;
	now?: Date;
	timezone: string;
}) {
	const name = approvalRowName(row);
	// The counterparty alone on agreement sheets, as in the mock ("Acme
	// Corp"): no " · agreement" suffix, which also keeps the row native-safe.
	const label = chipLabel(row.scope_label_snapshot ?? "");
	const period = formatPeriodRange(row.period_start, row.period_end, {
		timezone: row.timezone,
		now,
		userTimezone: timezone,
	});
	const ago = submittedAgo(row.submitted_at, { now, timezone });

	return (
		<Link
			to="/time/timesheets/$timesheetId"
			params={{ timesheetId: row.id }}
			className="group flex items-center gap-3 py-2"
			data-testid="time-approvals-row"
		>
			<Avatar
				user={{
					id: row.member_user_id ?? row.id,
					display_name: name,
					avatar_url: row.member?.avatar_url ?? null,
					email: null,
					first_name: null,
					last_name: null,
				}}
				size="sm"
			/>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
				<span className="truncate text-sm font-semibold text-foreground group-hover:text-primary sm:w-40 sm:shrink-0">
					{name}
				</span>
				<span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground sm:text-sm">
					<span className="min-w-0 max-w-full truncate" title={label.title}>
						{label.text}
					</span>
					<span aria-hidden="true">·</span>
					<span className="shrink-0">{period}</span>
					{tag ? <ForWorkspaceTag name={tag} /> : null}
				</span>
			</span>
			<span className="flex shrink-0 flex-col items-end gap-0.5 sm:flex-row sm:items-center sm:gap-3">
				<span className="text-sm font-semibold tabular-nums text-foreground">
					{formatClock(approvalRowSeconds(row))}
				</span>
				{ago ? (
					<span className="text-xs text-muted-foreground sm:w-20 sm:text-right">
						{ago}
					</span>
				) : null}
			</span>
		</Link>
	);
}
