import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	Check,
	FolderKanban,
	Loader2,
	RotateCcw,
	X,
} from "lucide-react";
import { useToast } from "@/hooks/useToast";
import { useUser } from "@/stores/authStore";
import {
	listMemberRates,
	listTeamMembers,
	type TeamMember,
	type TeamMemberRate,
} from "@/services/teams.service";
import {
	teamTimeService,
	type TaskTimeLog,
	type TimeLogReviewDecision,
	type TimeLogStatus,
} from "@/services/team-time.service";
import { TeamApprovalsGrid } from "@/components/team-time/TeamApprovalsGrid";
import {
	TeamLogsStatsCard,
	computeLogStats,
} from "@/components/team-time/TeamLogsStatsCard";

export const Route = createFileRoute("/teams/$teamId/time/manage-rates/$userId")({
	component: MemberLogsRoute,
});

function memberDisplayName(m: TeamMember | undefined): string {
	if (!m) return "—";
	const composed = [m.user?.first_name, m.user?.last_name]
		.filter(Boolean)
		.join(" ")
		.trim();
	return m.user?.display_name || composed || m.user?.email || m.user_id;
}

function MemberLogsRoute() {
	const { teamId, userId } = Route.useParams();
	const user = useUser();
	const toast = useToast();
	const qc = useQueryClient();
	const navigate = useNavigate();

	const [statusFilter, setStatusFilter] = useState<TimeLogStatus | "all">(
		"all",
	);
	const [projectFilter, setProjectFilter] = useState<string>("");
	const [selected, setSelected] = useState<Set<string>>(new Set());


	const membersQuery = useQuery({
		queryKey: ["team", teamId, "members"],
		queryFn: () => listTeamMembers(teamId),
	});
	const member = membersQuery.data?.find((m) => m.user_id === userId);

	const ratesQuery = useQuery({
		queryKey: ["team", teamId, "rates", "history", userId],
		queryFn: () => listMemberRates(teamId, userId),
	});
	const allRates: TeamMemberRate[] = ratesQuery.data ?? [];
	const activeRates = allRates.filter((r) => r.end_date === null);
	const firstActiveRate = activeRates[0] ?? null;

	const projectsQuery = useQuery({
		queryKey: ["team-time", teamId, "projects"],
		queryFn: () => teamTimeService.listTeamLogProjects(teamId),
	});
	const projectTitleById = useMemo(() => {
		const map: Record<string, string | null> = {};
		for (const p of projectsQuery.data ?? []) map[p.id] = p.title;
		return map;
	}, [projectsQuery.data]);

	const logsQuery = useQuery({
		queryKey: [
			"team-time",
			teamId,
			"member-logs",
			userId,
			{ statusFilter, projectFilter },
		],
		queryFn: () =>
			teamTimeService.listTeamLogs(teamId, {
				status: statusFilter === "all" ? undefined : statusFilter,
				project_id: projectFilter || undefined,
				member_user_id: userId,
				limit: 200,
			}),
	});

	const items = logsQuery.data?.items ?? [];
	const logStats = useMemo(() => computeLogStats(items), [items]);

	const reviewBulkMutation = useMutation({
		mutationFn: async (input: {
			ids: string[];
			decision: TimeLogReviewDecision;
		}) => teamTimeService.reviewLogsBulk(input.ids, input.decision),
		onSuccess: (data) => {
			toast.success(`Reviewed ${data.reviewed} log(s).`);
			setSelected(new Set());
			qc.invalidateQueries({ queryKey: ["team-time", teamId] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const reviewSingleMutation = useMutation({
		mutationFn: (input: {
			logId: string;
			decision: TimeLogReviewDecision;
		}) => teamTimeService.reviewLog(input.logId, input.decision),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["team-time", teamId] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const submitDecision = (decision: TimeLogReviewDecision) => {
		if (selected.size === 0) return;
		reviewBulkMutation.mutate({ ids: Array.from(selected), decision });
	};

	const toggleOne = (id: string, checked: boolean) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
	};
	const toggleAll = (checked: boolean, eligibleIds: string[]) => {
		setSelected(checked ? new Set(eligibleIds) : new Set());
	};

	const rowPendingById = useMemo<Record<string, boolean>>(() => {
		const map: Record<string, boolean> = {};
		if (
			reviewSingleMutation.isPending &&
			reviewSingleMutation.variables
		) {
			map[reviewSingleMutation.variables.logId] = true;
		}
		return map;
	}, [reviewSingleMutation.isPending, reviewSingleMutation.variables]);

	const reviewSyncById = rowPendingById;

	const handleOpenInRoadmap = (log: TaskTimeLog) => {
		void navigate({
			to: "/project/$projectId/roadmap",
			params: { projectId: log.project_id },
			search: { taskId: log.task_id } as never,
		});
	};

	if (membersQuery.isPending) {
		return (
			<div className="flex justify-center p-12">
				<Loader2 className="h-6 w-6 animate-spin text-slate-400" />
			</div>
		);
	}

	const memberName = memberDisplayName(member);

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-3">
				<div className="space-y-1">
					<Link
						to="/teams/$teamId/time/manage-rates"
						params={{ teamId }}
						className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline"
					>
						<ArrowLeft className="h-3.5 w-3.5" />
						Back to rates
					</Link>
					<h3 className="text-lg font-semibold text-slate-900">
						{memberName}'s logs
					</h3>
				</div>
			</div>

			{activeRates.length > 1 && (
				<div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
					<span className="font-semibold text-slate-500">Active rates:</span>{" "}
					{activeRates
						.map((r) => {
							const title = projectTitleById[r.project_id] ?? "Project";
							return `${title} ${Number(r.hourly_rate).toFixed(2)} ${r.currency}/hr`;
						})
						.join(" · ")}
				</div>
			)}

			<TeamLogsStatsCard
				rate={firstActiveRate}
				stats={logStats}
				fallbackCurrency={firstActiveRate?.currency ?? "USD"}
				loading={logsQuery.isPending}
			/>

			<div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
				<div
					role="tablist"
					aria-label="Filter by status"
					className="inline-flex items-center rounded-lg bg-slate-100 p-0.5"
				>
					{(
						[
							{ value: "all", label: "All" },
							{ value: "pending", label: "Pending" },
							{ value: "approved", label: "Approved" },
							{ value: "rejected", label: "Rejected" },
						] as const
					).map((opt) => {
						const active = statusFilter === opt.value;
						return (
							<button
								key={opt.value}
								type="button"
								role="tab"
								aria-selected={active}
								onClick={() => setStatusFilter(opt.value)}
								className={
									active
										? "rounded-md bg-white px-3 py-1 text-xs font-medium text-slate-900 shadow-sm"
										: "rounded-md px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-700"
								}
							>
								{opt.label}
							</button>
						);
					})}
				</div>

				<label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white pl-2.5 pr-1 focus-within:border-sky-400 focus-within:ring-1 focus-within:ring-sky-200">
					<FolderKanban className="h-3.5 w-3.5 text-slate-400" />
					<select
						value={projectFilter}
						onChange={(e) => setProjectFilter(e.target.value)}
						className="border-0 bg-transparent py-1 pr-2 text-xs text-slate-700 focus:outline-none focus:ring-0"
					>
						<option value="">All projects</option>
						{(projectsQuery.data ?? []).map((p) => (
							<option key={p.id} value={p.id}>
								{p.title ?? "(untitled)"}
							</option>
						))}
					</select>
				</label>

				<div className="ml-auto flex items-center gap-2">
					<span
						className={
							selected.size === 0
								? "hidden text-xs text-slate-400 sm:inline"
								: "inline-flex items-center rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-200"
						}
					>
						{selected.size === 0
							? "Select rows to review"
							: `${selected.size} selected`}
					</span>
					<div className="inline-flex items-center overflow-hidden rounded-lg border border-slate-200 shadow-sm">
						<button
							type="button"
							disabled={selected.size === 0 || reviewBulkMutation.isPending}
							onClick={() => submitDecision("approved")}
							className="inline-flex items-center gap-1.5 border-r border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:bg-white disabled:text-slate-300 disabled:hover:bg-white"
						>
							<Check className="h-3.5 w-3.5" />
							Approve
						</button>
						<button
							type="button"
							disabled={selected.size === 0 || reviewBulkMutation.isPending}
							onClick={() => submitDecision("rejected")}
							className="inline-flex items-center gap-1.5 border-r border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:bg-white disabled:text-slate-300 disabled:hover:bg-white"
						>
							<X className="h-3.5 w-3.5" />
							Reject
						</button>
						<button
							type="button"
							disabled={selected.size === 0 || reviewBulkMutation.isPending}
							onClick={() => submitDecision("pending")}
							className="inline-flex items-center gap-1.5 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
						>
							<RotateCcw className="h-3.5 w-3.5" />
							Reset
						</button>
					</div>
				</div>
			</div>

			<TeamApprovalsGrid
				logs={items}
				loadingLogs={logsQuery.isPending}
				canApprove
				currentUserId={user?.id ?? null}
				selectedLogIds={selected}
				rowPendingById={rowPendingById}
				reviewSyncById={reviewSyncById}
				onToggleSelectLog={toggleOne}
				onToggleSelectAll={toggleAll}
				onReviewLog={async (logId, decision) => {
					await reviewSingleMutation.mutateAsync({ logId, decision });
				}}
				onOpenTaskInRoadmap={handleOpenInRoadmap}
				canOpenTaskInRoadmap={() => true}
			/>
		</div>
	);
}
