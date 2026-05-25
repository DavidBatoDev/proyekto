import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Loader2, Users } from "lucide-react";
import { useToast } from "@/hooks/useToast";
import { useUser } from "@/stores/authStore";
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
import { TeamLogsPeriodFilter } from "@/components/team-time/TeamLogsPeriodFilter";
import {
	buildCustomPeriodFromDateInputs,
	buildTeamLogPeriodSearch,
	parseTeamLogPeriodSearch,
	resolveTeamLogPeriod,
	type CutoffHalf,
	type LogPeriodPreset,
} from "@/components/team-time/log-period";

export const Route = createFileRoute("/teams/$teamId/time/team-logs")({
	validateSearch: parseTeamLogPeriodSearch,
	component: TeamLogsRoute,
});

function TeamLogsRoute() {
	const { teamId } = Route.useParams();
	const search = Route.useSearch();
	const user = useUser();
	const navigate = useNavigate({ from: Route.fullPath });
	const toast = useToast();
	const qc = useQueryClient();

	const period = useMemo(() => resolveTeamLogPeriod(search), [search]);

	useEffect(() => {
		if (search.preset && search.from && search.to) return;
		void navigate({
			to: "/teams/$teamId/time/team-logs",
			params: { teamId },
			search: buildTeamLogPeriodSearch(period),
			replace: true,
		});
	}, [navigate, period, search.from, search.preset, search.to, teamId]);

	const [statusFilter, setStatusFilter] = useState<TimeLogStatus | "all">("all");
	const [projectFilter, setProjectFilter] = useState<string>("");
	const [memberFilter, setMemberFilter] = useState<string>("");
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const projectsQuery = useQuery({
		queryKey: ["team-time", teamId, "projects"],
		queryFn: () => teamTimeService.listTeamLogProjects(teamId),
	});

	const membersQuery = useQuery({
		queryKey: ["team-time", teamId, "members"],
		queryFn: () => teamTimeService.listTeamLogMembers(teamId),
	});

	const logsQuery = useQuery({
		queryKey: [
			"team-time",
			teamId,
			"team-logs",
			{
				statusFilter,
				projectFilter,
				memberFilter,
				from: period.fromIso,
				to: period.toIso,
			},
		],
		queryFn: () =>
			teamTimeService.listTeamLogs(teamId, {
				status: statusFilter === "all" ? undefined : statusFilter,
				project_id: projectFilter || undefined,
				member_user_id: memberFilter || undefined,
				from: period.fromIso,
				to: period.toIso,
				limit: 200,
			}),
	});

	const items = logsQuery.data?.items ?? [];
	const stats = useMemo(() => computeLogStats(items), [items]);

	useEffect(() => {
		const available = new Set(items.map((log) => log.id));
		setSelected((prev) => {
			const next = new Set(Array.from(prev).filter((id) => available.has(id)));
			return next.size === prev.size ? prev : next;
		});
	}, [items]);

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

	const rowPendingById = useMemo<Record<string, boolean>>(() => {
		const map: Record<string, boolean> = {};
		if (reviewSingleMutation.isPending && reviewSingleMutation.variables) {
			map[reviewSingleMutation.variables.logId] = true;
		}
		return map;
	}, [reviewSingleMutation.isPending, reviewSingleMutation.variables]);

	const updatePeriod = (preset: LogPeriodPreset, overrides?: Partial<typeof period>) => {
		const next = resolveTeamLogPeriod({
			preset,
			from: overrides?.fromIso ?? period.fromIso,
			to: overrides?.toIso ?? period.toIso,
			cutoff_month: overrides?.cutoffMonth ?? period.cutoffMonth,
			cutoff_half: overrides?.cutoffHalf ?? period.cutoffHalf,
		});
		void navigate({
			to: "/teams/$teamId/time/team-logs",
			params: { teamId },
			search: buildTeamLogPeriodSearch(next),
			replace: true,
		});
	};

	const onPresetChange = (preset: LogPeriodPreset) => {
		updatePeriod(preset);
	};

	const onCutoffMonthChange = (month: string) => {
		updatePeriod("cutoff", { cutoffMonth: month });
	};

	const onCutoffHalfChange = (half: CutoffHalf) => {
		updatePeriod("cutoff", { cutoffHalf: half });
	};

	const onApplyCustomRange = (fromDate: string, toDate: string) => {
		const next = buildCustomPeriodFromDateInputs(fromDate, toDate);
		if (!next) {
			toast.error("Enter a valid custom date range.");
			return;
		}
		updatePeriod("custom", {
			fromIso: next.fromIso,
			toIso: next.toIso,
		});
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

	const submitDecision = (decision: TimeLogReviewDecision) => {
		if (selected.size === 0) return;
		reviewBulkMutation.mutate({ ids: Array.from(selected), decision });
	};

	const handleOpenInRoadmap = (log: TaskTimeLog) => {
		if (!log.task_id) return;
		void navigate({
			to: "/project/$projectId/roadmap",
			params: { projectId: log.project_id },
			search: { taskId: log.task_id } as never,
		});
	};

	return (
		<div className="space-y-3">
			<TeamLogsPeriodFilter
				period={period}
				onPresetChange={onPresetChange}
				onCutoffMonthChange={onCutoffMonthChange}
				onCutoffHalfChange={onCutoffHalfChange}
				onApplyCustomRange={onApplyCustomRange}
			/>

			<TeamLogsStatsCard
				rate={null}
				stats={stats}
				fallbackCurrency="USD"
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
						{(projectsQuery.data ?? []).map((project) => (
							<option key={project.id} value={project.id}>
								{project.title ?? "(untitled)"}
							</option>
						))}
					</select>
				</label>

				<label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white pl-2.5 pr-1 focus-within:border-sky-400 focus-within:ring-1 focus-within:ring-sky-200">
					<Users className="h-3.5 w-3.5 text-slate-400" />
					<select
						value={memberFilter}
						onChange={(e) => setMemberFilter(e.target.value)}
						className="border-0 bg-transparent py-1 pr-2 text-xs text-slate-700 focus:outline-none focus:ring-0"
					>
						<option value="">All members</option>
						{(membersQuery.data ?? []).map((member) => (
							<option key={member.id} value={member.id}>
								{member.display_name || member.email || member.id}
							</option>
						))}
					</select>
				</label>

				{(projectsQuery.isPending || membersQuery.isPending) && (
					<Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
				)}
			</div>

			<TeamApprovalsGrid
				logs={items}
				loadingLogs={logsQuery.isPending}
				canApprove
				showMemberColumn
				currentUserId={user?.id ?? null}
				selectedLogIds={selected}
				rowPendingById={rowPendingById}
				reviewSyncById={rowPendingById}
				onToggleSelectLog={toggleOne}
				onToggleSelectAll={toggleAll}
				onReviewLog={(logId, decision) =>
					reviewSingleMutation.mutate({ logId, decision })
				}
				onOpenTaskInRoadmap={handleOpenInRoadmap}
				canOpenTaskInRoadmap={(taskId) => Boolean(taskId)}
				onApproveSelected={() => submitDecision("approved")}
				onRejectSelected={() => submitDecision("rejected")}
				onResetSelected={() => submitDecision("pending")}
				approvingSelected={reviewBulkMutation.isPending}
			/>
		</div>
	);
}
