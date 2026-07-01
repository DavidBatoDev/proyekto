import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, FolderKanban, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ScrollNavButtons } from "@/components/common/ScrollNavButtons";
import { FilterSelect } from "@/components/team-time/FilterSelect";
import { LogStatusFilter } from "@/components/team-time/LogStatusFilter";
import { PayMemberModal } from "@/components/team-time/PayMemberModal";
import {
	type ReviewOnlyDecision,
	TeamApprovalsInbox,
} from "@/components/team-time/TeamApprovalsInbox";
import {
	computeLogStats,
	TeamLogsStatsCard,
} from "@/components/team-time/TeamLogsStatsCard";
import { useToast } from "@/hooks/useToast";
import {
	type TaskTimeLog,
	teamTimeService,
	type TimeLogStatus,
} from "@/services/team-time.service";
import {
	listMemberRates,
	listTeamMembers,
	type TeamMember,
	type TeamMemberRate,
} from "@/services/teams.service";
import { useUser } from "@/stores/authStore";

export const Route = createFileRoute(
	"/teams/$teamId/time/manage-rates/$userId",
)({
	component: MemberLogsRoute,
});

interface PayTarget {
	memberId: string;
	memberLabel: string;
	currency: string;
	logs: TaskTimeLog[];
}

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

	const [statusSet, setStatusSet] = useState<Set<TimeLogStatus>>(new Set());
	const [projectFilter, setProjectFilter] = useState<string>("");
	const [busyLogIds, setBusyLogIds] = useState<Set<string>>(new Set());
	const [payTarget, setPayTarget] = useState<PayTarget | null>(null);

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
			{ projectFilter },
		],
		queryFn: () =>
			teamTimeService.listTeamLogs(teamId, {
				project_id: projectFilter || undefined,
				member_user_id: userId,
				limit: 200,
			}),
	});

	// Status is filtered client-side so any combination can be selected at once
	// (empty set = all statuses).
	const items = useMemo(() => {
		const all = logsQuery.data?.items ?? [];
		return statusSet.size === 0
			? all
			: all.filter((log) => statusSet.has(log.status));
	}, [logsQuery.data, statusSet]);
	const logStats = useMemo(() => computeLogStats(items), [items]);

	const markBusy = (ids: string[], busy: boolean) =>
		setBusyLogIds((prev) => {
			const next = new Set(prev);
			for (const id of ids) {
				if (busy) next.add(id);
				else next.delete(id);
			}
			return next;
		});

	const reviewMutation = useMutation({
		mutationFn: async (input: {
			ids: string[];
			decision: ReviewOnlyDecision;
		}) => {
			markBusy(input.ids, true);
			return teamTimeService.reviewLogsBulk(input.ids, input.decision);
		},
		onSuccess: (data, variables) => {
			toast.success(`Updated ${data.reviewed} log(s).`);
			markBusy(variables.ids, false);
			qc.invalidateQueries({ queryKey: ["team-time", teamId] });
		},
		onError: (e: Error, variables) => {
			markBusy(variables.ids, false);
			toast.error(e.message);
		},
	});

	const handleReviewLogs = async (
		ids: string[],
		decision: ReviewOnlyDecision,
	) => {
		if (ids.length === 0) return;
		await reviewMutation.mutateAsync({ ids, decision });
	};

	const handlePayMember = (
		memberId: string,
		logIds: string[],
		currency: string,
	) => {
		const idSet = new Set(logIds);
		const logs = items.filter((log) => idSet.has(log.id));
		if (logs.length === 0) return;
		setPayTarget({
			memberId,
			memberLabel: memberDisplayName(member),
			currency,
			logs,
		});
	};

	const handleOpenInRoadmap = (log: TaskTimeLog) => {
		if (!log.task_id) return;
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
							return `${title} Work ${Number(r.hourly_rate).toFixed(2)} / Training ${Number(r.training_hourly_rate).toFixed(2)} ${r.currency}/hr`;
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
				<LogStatusFilter value={statusSet} onChange={setStatusSet} />

				<FilterSelect
					value={projectFilter}
					onChange={setProjectFilter}
					icon={<FolderKanban className="h-3.5 w-3.5" />}
					placeholder="All projects"
					options={[
						{ value: "", label: "All projects" },
						...(projectsQuery.data ?? []).map((p) => ({
							value: p.id,
							label: p.title ?? "(untitled)",
						})),
					]}
				/>

				{(projectsQuery.isPending || logsQuery.isFetching) && (
					<Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
				)}
			</div>

			<TeamApprovalsInbox
				logs={items}
				loadingLogs={logsQuery.isPending}
				currentUserId={user?.id ?? null}
				busyLogIds={busyLogIds}
				onReviewLogs={handleReviewLogs}
				onPayMember={handlePayMember}
				onOpenTaskInRoadmap={handleOpenInRoadmap}
				canOpenTaskInRoadmap={(taskId) => Boolean(taskId)}
			/>

			{payTarget && (
				<PayMemberModal
					isOpen
					teamId={teamId}
					memberId={payTarget.memberId}
					memberLabel={payTarget.memberLabel}
					currency={payTarget.currency}
					logs={payTarget.logs}
					onClose={() => setPayTarget(null)}
					onSuccess={() => {
						setPayTarget(null);
						qc.invalidateQueries({ queryKey: ["team-time", teamId] });
						qc.invalidateQueries({ queryKey: ["payouts", teamId] });
					}}
				/>
			)}

			<ScrollNavButtons />
		</div>
	);
}
