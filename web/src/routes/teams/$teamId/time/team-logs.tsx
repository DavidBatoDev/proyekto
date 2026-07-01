import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FolderKanban, Loader2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	buildCustomPeriodFromDateInputs,
	buildTeamLogPeriodSearch,
	type CutoffHalf,
	type LogPeriodPreset,
	loadStoredPeriodSearch,
	parseTeamLogPeriodSearch,
	resolveTeamLogPeriod,
	storePeriodSearch,
} from "@/components/team-time/log-period";
import { FilterSelect } from "@/components/team-time/FilterSelect";
import { LogStatusFilter } from "@/components/team-time/LogStatusFilter";
import { PayMemberModal } from "@/components/team-time/PayMemberModal";
import {
	type ReviewOnlyDecision,
	TeamApprovalsInbox,
} from "@/components/team-time/TeamApprovalsInbox";
import { TeamLogsPeriodFilter } from "@/components/team-time/TeamLogsPeriodFilter";
import {
	computeLogStats,
	TeamLogsStatsCard,
} from "@/components/team-time/TeamLogsStatsCard";
import { useToast } from "@/hooks/useToast";
import {
	type TaskTimeLog,
	type TimeLogStatus,
	teamTimeService,
} from "@/services/team-time.service";
import { useUser } from "@/stores/authStore";

export const Route = createFileRoute("/teams/$teamId/time/team-logs")({
	validateSearch: parseTeamLogPeriodSearch,
	component: TeamLogsRoute,
});

interface PayTarget {
	memberId: string;
	memberLabel: string;
	currency: string;
	logs: TaskTimeLog[];
}

function TeamLogsRoute() {
	const { teamId } = Route.useParams();
	const search = Route.useSearch();
	const user = useUser();
	const navigate = useNavigate({ from: Route.fullPath });
	const toast = useToast();
	const qc = useQueryClient();

	const period = useMemo(() => resolveTeamLogPeriod(search), [search]);

	useEffect(() => {
		// Once the URL carries a resolved period, mirror it to localStorage so
		// it survives navigating away to another Time tab and back.
		if (search.preset && search.from && search.to) {
			storePeriodSearch(teamId, search);
			return;
		}
		// No period in the URL yet — restore the last one used for this team
		// (e.g. a custom range), falling back to the default.
		const restored = loadStoredPeriodSearch(teamId);
		void navigate({
			to: "/teams/$teamId/time/team-logs",
			params: { teamId },
			search: restored ?? buildTeamLogPeriodSearch(period),
			replace: true,
		});
	}, [navigate, period, search, teamId]);

	const [statusSet, setStatusSet] = useState<Set<TimeLogStatus>>(new Set());
	const [projectFilter, setProjectFilter] = useState<string>("");
	const [memberFilter, setMemberFilter] = useState<string>("");
	const [busyLogIds, setBusyLogIds] = useState<Set<string>>(new Set());
	const [payTarget, setPayTarget] = useState<PayTarget | null>(null);

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
				projectFilter,
				memberFilter,
				from: period.fromIso,
				to: period.toIso,
			},
		],
		queryFn: () =>
			teamTimeService.listTeamLogs(teamId, {
				project_id: projectFilter || undefined,
				member_user_id: memberFilter || undefined,
				from: period.fromIso,
				to: period.toIso,
				limit: 200,
			}),
	});

	// Status is filtered client-side so any combination of statuses can be
	// selected at once (empty set = all statuses).
	const items = useMemo(() => {
		const all = logsQuery.data?.items ?? [];
		return statusSet.size === 0
			? all
			: all.filter((log) => statusSet.has(log.status));
	}, [logsQuery.data, statusSet]);
	const stats = useMemo(() => computeLogStats(items), [items]);

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

	const updatePeriod = (
		preset: LogPeriodPreset,
		overrides?: Partial<typeof period>,
	) => {
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

	const onApplyCustomRange = (fromDate: string, toDate: string) => {
		const next = buildCustomPeriodFromDateInputs(fromDate, toDate);
		if (!next) {
			toast.error("Enter a valid custom date range.");
			return;
		}
		updatePeriod("custom", { fromIso: next.fromIso, toIso: next.toIso });
	};

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
		const memberLog = logs[0];
		const memberLabel =
			memberLog.member?.display_name ||
			[memberLog.member?.first_name, memberLog.member?.last_name]
				.filter(Boolean)
				.join(" ")
				.trim() ||
			memberLog.member?.email ||
			memberId;
		setPayTarget({ memberId, memberLabel, currency, logs });
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
				onPresetChange={(preset) => updatePeriod(preset)}
				onCutoffMonthChange={(month) =>
					updatePeriod("cutoff", { cutoffMonth: month })
				}
				onCutoffHalfChange={(half: CutoffHalf) =>
					updatePeriod("cutoff", { cutoffHalf: half })
				}
				onApplyCustomRange={onApplyCustomRange}
			/>

			<TeamLogsStatsCard
				rate={null}
				stats={stats}
				fallbackCurrency="USD"
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
						...(projectsQuery.data ?? []).map((project) => ({
							value: project.id,
							label: project.title ?? "(untitled)",
						})),
					]}
				/>

				<FilterSelect
					value={memberFilter}
					onChange={setMemberFilter}
					icon={<Users className="h-3.5 w-3.5" />}
					placeholder="All members"
					options={[
						{ value: "", label: "All members" },
						...(membersQuery.data ?? []).map((member) => ({
							value: member.id,
							label: member.display_name || member.email || member.id,
						})),
					]}
				/>

				{(projectsQuery.isPending || membersQuery.isPending) && (
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
		</div>
	);
}
