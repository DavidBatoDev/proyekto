import { Link } from "@tanstack/react-router";
import { Hourglass } from "lucide-react";
import type { ChangeRequest } from "@/services/delivery.service";
import {
	awaitingLongest,
	type ChangeRequestStats,
	changeRequestReference,
	daysWaiting,
	timelineImpact,
} from "./changeRequestModel";
import { StatBlock } from "./DeliveryHealth";

/**
 * Change-request health.
 *
 * The hero number is SCHEDULE IMPACT rather than a count, because "12 change
 * requests" answers nothing anyone needs — the question this page exists to
 * answer is "how far has the plan moved from what we agreed?".
 *
 * Committed and pending are shown apart, never summed. An applied request's days
 * are already reflected in the roadmap's own dates, so adding the two and
 * comparing the total against the current schedule double-counts the applied
 * ones. Two honest numbers beat one wrong one.
 */
export function ChangeRequestHealth({
	stats,
	requests,
	projectId,
}: {
	stats: ChangeRequestStats;
	requests: ChangeRequest[];
	projectId: string;
}) {
	const waiting = awaitingLongest(requests, 4);
	const committed = timelineImpact(stats.committedTimelineDays);

	return (
		// Deliberately unboxed: these are page furniture, not a separate object,
		// and a card around them would compete with the request cards below for
		// "this is a thing". Matches DeliveryHealth's rhythm exactly.
		<div className="mb-8 border-b border-border px-1 pb-8">
			<div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-12">
				<div>
					<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<span className="text-5xl font-semibold tracking-tight text-foreground">
							{stats.committedTimelineDays === 0
								? "—"
								: `${stats.committedTimelineDays > 0 ? "+" : ""}${stats.committedTimelineDays}`}
						</span>
						<span className="text-sm text-muted-foreground">
							{stats.total === 0
								? "No change requests yet"
								: stats.committedTimelineDays === 0
									? "no schedule change from applied requests"
									: `${committed?.replace(/^\+/, "")} added to the schedule by approved changes already applied`}
						</span>
					</div>

					{stats.pendingTimelineDays !== 0 && (
						<p className="mt-2 text-sm text-warning">
							{timelineImpact(stats.pendingTimelineDays)} more approved and
							waiting to be applied.
						</p>
					)}

					{/* Share decided — the operational question behind the queue. */}
					{stats.decidedPercent !== null && (
						<div className="mt-4 h-2 max-w-3xl overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full bg-success transition-all duration-500"
								style={{ width: `${stats.decidedPercent}%` }}
							/>
						</div>
					)}
					{stats.decidedPercent !== null && (
						<p className="mt-2 text-[11px] text-muted-foreground">
							{stats.decidedPercent}% of requests have reached a decision
						</p>
					)}

					<div className="mt-7 flex flex-wrap gap-x-12 gap-y-5">
						<StatBlock value={stats.total} label="Total" />
						<StatBlock
							value={stats.awaitingDecision}
							label="Awaiting decision"
							tone={stats.awaitingDecision > 0 ? "warn" : undefined}
						/>
						<StatBlock
							value={stats.approvedNotApplied}
							label="Approved"
							tone={stats.approvedNotApplied > 0 ? "warn" : undefined}
						/>
						<StatBlock value={stats.applied} label="Applied" tone="good" />
						<StatBlock value={stats.draft} label="Draft" />
						<StatBlock value={stats.closed} label="Closed" />
					</div>
				</div>

				<div className="lg:border-l lg:border-border lg:pl-12">
					<p className="mb-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						<Hourglass className="h-3.5 w-3.5" />
						Waiting on a decision
					</p>
					{waiting.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							Nothing is waiting on anyone.
						</p>
					) : (
						<ul className="space-y-3.5">
							{waiting.map((request) => {
								const days = daysWaiting(request);
								return (
									<li key={request.id} className="relative pl-4">
										{/* Amber, not primary: this list exists to nag. */}
										<span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-warning" />
										<Link
											to="/project/$projectId/change-requests/$changeRequestId"
											params={{ projectId, changeRequestId: request.id }}
											className="block truncate text-sm text-foreground hover:text-primary hover:underline"
										>
											{request.title}
										</Link>
										<p className="text-[11px] text-muted-foreground">
											{changeRequestReference(request)} ·{" "}
											{days === 0
												? "today"
												: `${days} ${days === 1 ? "day" : "days"}`}
										</p>
									</li>
								);
							})}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}
