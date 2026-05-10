import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/useToast";
import { useUser } from "@/stores/authStore";
import { listTeamMembers, type TeamMember } from "@/services/teams.service";
import {
	teamTimeService,
	type TaskTimeLog,
	type TimeLogReviewDecision,
	type TimeLogStatus,
} from "@/services/team-time.service";
import { TeamApprovalsGrid } from "@/components/team-time/TeamApprovalsGrid";

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
		"pending",
	);
	const [projectFilter, setProjectFilter] = useState<string>("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [timerNowMs, setTimerNowMs] = useState(Date.now());

	useEffect(() => {
		const interval = window.setInterval(() => setTimerNowMs(Date.now()), 1000);
		return () => window.clearInterval(interval);
	}, []);

	const membersQuery = useQuery({
		queryKey: ["team", teamId, "members"],
		queryFn: () => listTeamMembers(teamId),
	});
	const member = membersQuery.data?.find((m) => m.user_id === userId);

	const projectsQuery = useQuery({
		queryKey: ["team-time", teamId, "projects"],
		queryFn: () => teamTimeService.listTeamLogProjects(teamId),
	});

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
					{member?.hourly_rate != null && (
						<p className="text-xs text-slate-500">
							Current rate: {Number(member.hourly_rate).toFixed(2)}{" "}
							{member.currency || "USD"} / hour
						</p>
					)}
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
				<select
					value={statusFilter}
					onChange={(e) =>
						setStatusFilter(e.target.value as TimeLogStatus | "all")
					}
					className="rounded-md border border-slate-300 px-2 py-1 text-sm"
				>
					<option value="all">All statuses</option>
					<option value="pending">Pending</option>
					<option value="approved">Approved</option>
					<option value="rejected">Rejected</option>
				</select>
				<select
					value={projectFilter}
					onChange={(e) => setProjectFilter(e.target.value)}
					className="rounded-md border border-slate-300 px-2 py-1 text-sm"
				>
					<option value="">All projects</option>
					{(projectsQuery.data ?? []).map((p) => (
						<option key={p.id} value={p.id}>
							{p.title ?? "(untitled)"}
						</option>
					))}
				</select>
				<div className="ml-auto flex items-center gap-2">
					<button
						type="button"
						disabled={selected.size === 0 || reviewBulkMutation.isPending}
						onClick={() => submitDecision("approved")}
						className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
					>
						Approve ({selected.size})
					</button>
					<button
						type="button"
						disabled={selected.size === 0 || reviewBulkMutation.isPending}
						onClick={() => submitDecision("rejected")}
						className="rounded-md bg-rose-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
					>
						Reject ({selected.size})
					</button>
					<button
						type="button"
						disabled={selected.size === 0 || reviewBulkMutation.isPending}
						onClick={() => submitDecision("pending")}
						className="rounded-md border border-slate-300 px-3 py-1 text-sm"
					>
						Reset
					</button>
				</div>
			</div>

			<TeamApprovalsGrid
				logs={items}
				loadingLogs={logsQuery.isPending}
				timerNowMs={timerNowMs}
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
