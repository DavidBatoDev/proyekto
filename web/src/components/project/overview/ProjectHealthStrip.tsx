import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, CircleDot, Inbox } from "lucide-react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import {
	HEALTH_LABEL,
	type HealthVerdict,
	type ProjectHealth,
} from "./projectHealth";

/**
 * The "are we going to succeed?" strip at the top of Overview.
 *
 * Every number here is derived from roadmap, deliverable, and risk data — there
 * is no stored status field, and no money. The verdict discloses the inputs
 * that produced it rather than asserting a colour.
 */

const VERDICT_STYLES: Record<
	HealthVerdict,
	{ chip: string; dot: string; icon: typeof CheckCircle2 }
> = {
	on_track: {
		chip: "bg-emerald-50 text-emerald-800 ring-emerald-200",
		dot: "bg-emerald-500",
		icon: CheckCircle2,
	},
	at_risk: {
		chip: "bg-amber-50 text-amber-900 ring-amber-200",
		dot: "bg-amber-500",
		icon: AlertTriangle,
	},
	off_track: {
		chip: "bg-red-50 text-red-800 ring-red-200",
		dot: "bg-red-500",
		icon: AlertTriangle,
	},
};

function Stat({
	label,
	value,
	hint,
	to,
	params,
	tone,
}: {
	label: string;
	value: string;
	hint?: string;
	to?: string;
	params?: Record<string, string>;
	tone?: "warn";
}) {
	const body = (
		<>
			<p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
				{label}
			</p>
			<p
				className={`mt-1 text-xl font-semibold ${
					tone === "warn" ? "text-amber-700" : "text-slate-900"
				}`}
			>
				{value}
			</p>
			{hint && (
				<p className="mt-0.5 truncate text-xs text-slate-500" title={hint}>
					{hint}
				</p>
			)}
		</>
	);

	const className =
		"rounded-xl border border-slate-200 bg-white/70 p-3 transition-colors";

	// Only the counts that represent work to do are worth a click.
	if (to && params) {
		return (
			<Link
				to={to}
				params={params}
				className={`${className} block hover:border-slate-300 hover:bg-white`}
			>
				{body}
			</Link>
		);
	}
	return <div className={className}>{body}</div>;
}

export function ProjectHealthStrip({
	health,
	projectId,
}: {
	health: ProjectHealth;
	projectId: string;
}) {
	const style = VERDICT_STYLES[health.verdict];
	const Icon = style.icon;
	const headline = health.reasons[0];

	return (
		<AppSurfaceCard strong className="mb-6 p-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div
					className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${style.chip}`}
				>
					<Icon className="h-4 w-4" />
					{HEALTH_LABEL[health.verdict]}
				</div>
				<p className="text-xs text-slate-500">{headline}</p>
			</div>

			<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<Stat
					label="Progress"
					value={health.progressPct === null ? "—" : `${health.progressPct}%`}
					hint={
						health.tasksTotal > 0
							? `${health.tasksDone} of ${health.tasksTotal} tasks done`
							: "No tasks planned yet"
					}
				/>
				<Stat
					label="Current milestone"
					value={health.currentMilestone?.title ?? "—"}
					hint={
						health.nextMilestone
							? `Next: ${health.nextMilestone.title}`
							: "No milestone after this one"
					}
				/>
				<Stat
					label="Blocked"
					value={String(health.blockedCount)}
					hint={
						health.blockedCount > 0 ? "Needs unblocking" : "Nothing blocked"
					}
					tone={health.blockedCount > 0 ? "warn" : undefined}
					to={
						health.blockedCount > 0
							? "/project/$projectId/work-items"
							: undefined
					}
					params={health.blockedCount > 0 ? { projectId } : undefined}
				/>
				<Stat
					label="Pending approval"
					value={String(health.pendingApprovals)}
					hint={
						health.pendingApprovals > 0
							? "Waiting on a decision"
							: "Nothing awaiting sign-off"
					}
					tone={health.pendingApprovals > 0 ? "warn" : undefined}
					to={
						health.pendingApprovals > 0
							? "/project/$projectId/deliverables"
							: undefined
					}
					params={health.pendingApprovals > 0 ? { projectId } : undefined}
				/>
			</div>

			{/* The verdict has to be accountable, so list what produced it. */}
			{health.reasons.length > 1 && (
				<ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
					{health.reasons.slice(1).map((reason) => (
						<li
							key={reason}
							className="flex items-center gap-1.5 text-xs text-slate-500"
						>
							<CircleDot className="h-3 w-3 shrink-0 text-slate-400" />
							{reason}
						</li>
					))}
				</ul>
			)}

			{health.overdueMilestones > 0 && (
				<p className="mt-3 flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
					<Inbox className="h-3.5 w-3.5 shrink-0" />
					{health.overdueMilestones === 1
						? "A milestone has passed its target date."
						: `${health.overdueMilestones} milestones have passed their target dates.`}{" "}
					Re-plan them on the Timeline, or mark them complete.
				</p>
			)}
		</AppSurfaceCard>
	);
}
