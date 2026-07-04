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
import { TimeLogCalendar } from "@/components/team-time/calendar/TimeLogCalendar";
import {
	loadTimeView,
	storeTimeView,
	type TimeViewMode,
	TimeViewToggle,
} from "@/components/team-time/calendar/TimeViewToggle";
import { TeamLogsPeriodFilter } from "@/components/team-time/TeamLogsPeriodFilter";
import {
	EMPTY_LOG_STATS,
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

	const [viewMode, setViewMode] = useState<TimeViewMode>(() =>
		loadTimeView(teamId, "team"),
	);
	const changeViewMode = (mode: TimeViewMode) => {
		setViewMode(mode);
		storeTimeView(teamId, "team", mode);
	};
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

	// Recent logs independent of the selected period (but respecting the
	// project/member filters), purely to dot the days the team worked in the
	// calendar. Without a from/to the API returns the most recent logs (capped
	// at 200), so the indicator survives narrow period selections.
	const workedDaysQuery = useQuery({
		queryKey: [
			"team-time",
			teamId,
			"team-logs",
			"worked-days",
			{ projectFilter, memberFilter },
		],
		queryFn: () =>
			teamTimeService.listTeamLogs(teamId, {
				project_id: projectFilter || undefined,
				member_user_id: memberFilter || undefined,
				limit: 200,
			}),
	});

	// Local `yyyy-MM-dd` keys for every day with a log, so the period calendar
	// can dot the days the team worked (period-independent — see query above).
	const workedDays = useMemo(() => {
		const set = new Set<string>();
		for (const log of workedDaysQuery.data?.items ?? []) {
			const d = new Date(log.started_at);
			set.add(
				`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
					d.getDate(),
				).padStart(2, "0")}`,
			);
		}
		return set;
	}, [workedDaysQuery.data]);

	// Accurate hours/fees over the FULL filtered set (not the 200-row list cap),
	// computed server-side. The status filter below only narrows the list — the
	// stats card always shows the complete pending/approved/paid/rejected picture.
	const summaryQuery = useQuery({
		queryKey: [
			"team-time",
			teamId,
			"team-logs",
			"summary",
			{ projectFilter, memberFilter, from: period.fromIso, to: period.toIso },
		],
		queryFn: () =>
			teamTimeService.getTeamLogsSummary(teamId, {
				project_id: projectFilter || undefined,
				member_user_id: memberFilter || undefined,
				from: period.fromIso,
				to: period.toIso,
			}),
	});
	const stats = summaryQuery.data ?? EMPTY_LOG_STATS;

	// Status is filtered client-side so any combination of statuses can be
	// selected at once (empty set = all statuses).
	const items = useMemo(() => {
		const all = logsQuery.data?.items ?? [];
		return statusSet.size === 0
			? all
			: all.filter((log) => statusSet.has(log.status));
	}, [logsQuery.data, statusSet]);

	// The list is capped at 200 rows; surface it so the (filtered) list below is
	// never mistaken for the complete set. Totals above are unaffected (summary).
	const listCapped = (logsQuery.data?.total ?? 0) > (logsQuery.data?.items.length ?? 0);

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

	const memberLabelFromLog = (log: TaskTimeLog, memberId: string) =>
		log.member?.display_name ||
		[log.member?.first_name, log.member?.last_name]
			.filter(Boolean)
			.join(" ")
			.trim() ||
		log.member?.email ||
		memberId;

	const handlePayMember = async (
		memberId: string,
		logIds: string[],
		currency: string,
		payAll?: boolean,
	) => {
		// "Pay all approved" for a member must cover EVERY approved log in that
		// currency — not just the ≤200 currently loaded — or a busy member is
		// silently under-paid. Explicit per-row/selection pays use the given ids.
		let logs: TaskTimeLog[];
		if (payAll) {
			try {
				const all = await teamTimeService.listAllMemberApprovedLogs(
					teamId,
					memberId,
					currency,
				);
				logs = all;
			} catch (e) {
				toast.error((e as Error).message);
				return;
			}
		} else {
			const idSet = new Set(logIds);
			logs = items.filter((log) => idSet.has(log.id));
		}
		if (logs.length === 0) return;
		setPayTarget({
			memberId,
			memberLabel: memberLabelFromLog(logs[0], memberId),
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

	return (
		<div className="space-y-3">
			<div className="flex justify-end">
				<TimeViewToggle value={viewMode} onChange={changeViewMode} />
			</div>

			{viewMode === "calendar" ? (
				<TimeLogCalendar
					teamId={teamId}
					mode="team"
					currentUserId={user?.id ?? null}
					busyLogIds={busyLogIds}
					onReviewLogs={handleReviewLogs}
					onPayMember={handlePayMember}
					onOpenTaskInRoadmap={handleOpenInRoadmap}
					canOpenTaskInRoadmap={(taskId) => Boolean(taskId)}
				/>
			) : (
				<>
			<TeamLogsStatsCard
				rate={null}
				stats={stats}
				fallbackCurrency="USD"
				loading={summaryQuery.isPending}
			/>

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
				workedDays={workedDays}
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

			{listCapped && (
				<p className="px-1 text-xs text-slate-400">
					Showing the most recent 200 logs — narrow the period, project, or
					member to see the rest. Totals above cover the full range.
				</p>
			)}

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
				</>
			)}

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
