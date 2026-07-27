import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { TASK_STATUS_FILTER_OPTIONS } from "@/components/team-time/taskStatusFilter";
import { formatHours, formatMoney } from "@/components/team-time/time-utils";
import { projectService } from "@/services/project.service";
import {
	type TaskTimeLog,
	type TimeLogStatus,
	teamTimeService,
} from "@/services/team-time.service";
import { listProjectTeams } from "@/services/teams.service";
import { useAuthStore, useUser } from "@/stores/authStore";

export const Route = createFileRoute("/project/$projectId/time")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: ProjectTimePage,
});

type Tab = "mine" | "team";

const LOG_STATUS_TABS: Array<{ key: TimeLogStatus | "all"; label: string }> = [
	{ key: "all", label: "All" },
	{ key: "pending", label: "Pending" },
	{ key: "approved", label: "Approved" },
	{ key: "paid", label: "Paid" },
	{ key: "rejected", label: "Rejected" },
];

function ProjectTimePage() {
	const { projectId } = Route.useParams();
	const user = useUser();
	const [tab, setTab] = useState<Tab>("mine");
	const [statusFilter, setStatusFilter] = useState<TimeLogStatus | "all">(
		"all",
	);
	const [taskStatus, setTaskStatus] = useState("");

	const projectQuery = useQuery({
		queryKey: ["project", projectId],
		queryFn: () => projectService.get(projectId),
	});
	const project = projectQuery.data;
	const isConsultant = Boolean(user?.id && project?.consultant_id === user.id);
	const projectCurrency = project?.currency ?? "USD";

	const teamsQuery = useQuery({
		queryKey: ["project", projectId, "teams"],
		queryFn: () => listProjectTeams(projectId),
	});
	const teams = teamsQuery.data ?? [];

	// One query per attached team, scoped to this project. My-tab uses the
	// caller's own logs; team-tab (consultant only) uses all team logs.
	const logQueries = useQueries({
		queries: teams.map((t) => ({
			queryKey: [
				"project-time",
				projectId,
				t.team_id,
				tab,
				statusFilter,
				taskStatus,
			],
			queryFn: () => {
				const query = {
					project_id: projectId,
					status: statusFilter === "all" ? undefined : statusFilter,
					task_status: taskStatus || undefined,
					limit: 200,
				};
				return tab === "team"
					? teamTimeService.listTeamLogs(t.team_id, query)
					: teamTimeService.listMyTeamLogs(t.team_id, query);
			},
			enabled: tab !== "team" || isConsultant,
		})),
	});

	const isLoading = teamsQuery.isPending || logQueries.some((q) => q.isPending);

	// Merge logs across the project's teams, newest first.
	const logs = useMemo(() => {
		const all: TaskTimeLog[] = logQueries.flatMap((q) => q.data?.items ?? []);
		return all.sort((a, b) => b.started_at.localeCompare(a.started_at));
	}, [logQueries]);

	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			<div className="mx-auto w-full max-w-5xl px-5 py-6 md:px-8 md:py-8">
				<AppSurfaceCard strong className="mb-6 p-6">
					<AppSectionHeader
						kicker="Time"
						title="Time logs"
						subtitle="Time tracked on this project. Approvals and payouts live under Team → Time."
					/>
				</AppSurfaceCard>

				{/* Tabs + filters */}
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<div className="inline-flex rounded-lg border border-border bg-card p-1">
						<TabButton active={tab === "mine"} onClick={() => setTab("mine")}>
							My logs
						</TabButton>
						{isConsultant && (
							<TabButton active={tab === "team"} onClick={() => setTab("team")}>
								Team logs
							</TabButton>
						)}
					</div>
					<select
						value={taskStatus}
						onChange={(e) => setTaskStatus(e.target.value)}
						className="rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground"
					>
						{TASK_STATUS_FILTER_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label || "All tasks"}
							</option>
						))}
					</select>
				</div>

				<div className="mb-4 inline-flex flex-wrap gap-1">
					{LOG_STATUS_TABS.map((s) => (
						<button
							type="button"
							key={s.key}
							onClick={() => setStatusFilter(s.key)}
							className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
								statusFilter === s.key
									? "bg-primary text-primary-foreground"
									: "border border-border bg-card text-muted-foreground hover:bg-muted"
							}`}
						>
							{s.label}
						</button>
					))}
				</div>

				{isLoading ? (
					<div className="flex justify-center py-16">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : teams.length === 0 ? (
					<EmptyRow text="No team is attached to this project yet." />
				) : logs.length === 0 ? (
					<EmptyRow text="No time logs match these filters yet." />
				) : (
					<div className="overflow-hidden rounded-2xl border border-border">
						<table className="w-full text-sm">
							<thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
								<tr>
									<th className="px-4 py-2.5">Task</th>
									{tab === "team" && <th className="px-4 py-2.5">Member</th>}
									<th className="px-4 py-2.5">Date</th>
									<th className="px-4 py-2.5 text-right">Hours</th>
									<th className="px-4 py-2.5">Status</th>
									<th className="px-4 py-2.5 text-right">Amount</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{logs.map((log) => (
									<LogRow
										key={log.id}
										log={log}
										showMember={tab === "team"}
										fallbackCurrency={projectCurrency}
									/>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}

function LogRow({
	log,
	showMember,
	fallbackCurrency,
}: {
	log: TaskTimeLog;
	showMember: boolean;
	fallbackCurrency: string;
}) {
	const currency = log.currency_snapshot || fallbackCurrency || "USD";
	const hours = formatHours(log.duration_seconds);
	const amount =
		((log.duration_seconds ?? 0) / 3600) * Number(log.rate_snapshot ?? 0);
	return (
		<tr className="text-foreground">
			<td className="px-4 py-3">{log.task?.title ?? "—"}</td>
			{showMember && (
				<td className="px-4 py-3">
					{log.member?.display_name ?? log.member?.email ?? "—"}
				</td>
			)}
			<td className="px-4 py-3 text-muted-foreground">
				{log.started_at.slice(0, 10)}
			</td>
			<td className="px-4 py-3 text-right tabular-nums">{hours}</td>
			<td className="px-4 py-3">
				<LogStatusChip status={log.status} />
			</td>
			<td className="px-4 py-3 text-right tabular-nums">
				{formatMoney(amount, currency)}
			</td>
		</tr>
	);
}

function LogStatusChip({ status }: { status: TimeLogStatus }) {
	const classes: Record<TimeLogStatus, string> = {
		pending: "bg-amber-500/15 text-amber-600",
		approved: "bg-emerald-500/15 text-emerald-600",
		paid: "bg-sky-500/15 text-sky-600",
		rejected: "bg-rose-500/15 text-rose-600",
	};
	return (
		<span
			className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${classes[status]}`}
		>
			{status}
		</span>
	);
}

function TabButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
				active
					? "bg-primary text-primary-foreground"
					: "text-muted-foreground hover:text-foreground"
			}`}
		>
			{children}
		</button>
	);
}

function EmptyRow({ text }: { text: string }) {
	return (
		<div className="rounded-2xl border border-dashed border-border bg-card/60 px-4 py-12 text-center text-sm text-muted-foreground">
			{text}
		</div>
	);
}
