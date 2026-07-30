import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ExternalLink, ListChecks, Loader2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import { TimeLogCalendar } from "@/components/team-time/calendar/TimeLogCalendar";
import {
	loadTimeView,
	storeTimeView,
	type TimeViewMode,
	TimeViewToggle,
} from "@/components/team-time/calendar/TimeViewToggle";
import { FilterSelect } from "@/components/team-time/FilterSelect";
import { HourCapBanner } from "@/components/team-time/HourCapBanner";
import {
	buildCustomPeriodFromDateInputs,
	buildTeamLogPeriodSearch,
	type LogPeriodPreset,
	loadStoredPeriodSearch,
	parseTeamLogPeriodSearch,
	resolveTeamLogPeriod,
	storePeriodSearch,
} from "@/components/team-time/log-period";
import { PayMemberModal } from "@/components/team-time/PayMemberModal";
import {
	type ReviewOnlyDecision,
	TeamApprovalsInbox,
} from "@/components/team-time/TeamApprovalsInbox";
import { TeamLogsPeriodFilter } from "@/components/team-time/TeamLogsPeriodFilter";
import {
	EMPTY_LOG_STATS,
	TeamLogsStatsCard,
} from "@/components/team-time/TeamLogsStatsCard";
import {
	type StatusTab,
	TeamLogsStatusTabs,
} from "@/components/team-time/TeamLogsStatusTabs";
import { TeamMyLogsList } from "@/components/team-time/TeamMyLogsList";
import {
	AddLogModal,
	DeleteTimeLogModal,
	EditLogModal,
	ManualLogModal,
} from "@/components/team-time/TeamTimeModals";
import { TASK_STATUS_FILTER_OPTIONS } from "@/components/team-time/taskStatusFilter";
import {
	fromLocalDateTimeInput,
	seedManualLogRange,
	toLocalDateTimeInput,
} from "@/components/team-time/time-utils";
import { useActiveTimer } from "@/components/team-time/useActiveTimer";
import { useTimeTaskCreation } from "@/components/team-time/useTimeTaskCreation";
import { useProjectMyPermissionsQuery } from "@/hooks/useProjectQueries";
import { useToast } from "@/hooks/useToast";
import { projectService } from "@/services/project.service";
import {
	type TaskTimeLog,
	teamTimeService,
} from "@/services/team-time.service";
import {
	getTeam,
	listMemberRates,
	listProjectTeams,
	type TeamMemberRate,
} from "@/services/teams.service";
import { useAuthStore, useUser } from "@/stores/authStore";

export const Route = createFileRoute("/project/$projectId/time")({
	validateSearch: parseTeamLogPeriodSearch,
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: ProjectTimeRoute,
});

type Tab = "mine" | "team";

interface PayTarget {
	memberId: string;
	memberLabel: string;
	currency: string;
	logs: TaskTimeLog[];
}

function ProjectTimeRoute() {
	const { projectId } = Route.useParams();
	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			<RequireProjectAccess projectId={projectId} access="time">
				<ProjectTimePage />
			</RequireProjectAccess>
		</div>
	);
}

function ProjectTimePage() {
	const { projectId } = Route.useParams();
	const search = Route.useSearch();
	const user = useUser();
	const toast = useToast();
	const qc = useQueryClient();
	const navigate = useNavigate();

	// Opening Time only gets you your own logs; the team's time is a separate
	// grant (default: admin/owner and the consultant). Deriving the active tab
	// rather than trusting state means a revoked grant can't leave someone
	// parked on a tab that now 403s.
	const permissionsQuery = useProjectMyPermissionsQuery(projectId);
	const canViewTeamLogs = permissionsQuery.data?.time.view_team_logs === true;
	const [selectedTab, setTab] = useState<Tab>("mine");
	const tab: Tab = canViewTeamLogs ? selectedTab : "mine";
	const [activeStatus, setActiveStatus] = useState<StatusTab>("all");
	const [taskStatusFilter, setTaskStatusFilter] = useState("");
	const [memberFilter, setMemberFilter] = useState("");
	const [busyLogIds, setBusyLogIds] = useState<Set<string>>(new Set());
	const [payTarget, setPayTarget] = useState<PayTarget | null>(null);

	// ─── Scope ──────────────────────────────────────────────────────────────

	const projectQuery = useQuery({
		queryKey: ["project", projectId],
		queryFn: () => projectService.get(projectId),
	});
	const projectCurrency = projectQuery.data?.currency ?? "USD";

	const teamsQuery = useQuery({
		queryKey: ["project", projectId, "teams"],
		queryFn: () => listProjectTeams(projectId),
	});
	// Logs are read project-wide, but a few team-owned concerns (task pickers,
	// rate history, the pay-period calendar, links out to Payouts) still need
	// one team — use the primary attachment.
	const primaryTeamId = useMemo(() => {
		const teams = teamsQuery.data ?? [];
		return (teams.find((t) => t.is_primary) ?? teams[0])?.team_id ?? "";
	}, [teamsQuery.data]);

	const teamQuery = useQuery({
		queryKey: ["teams", "detail", primaryTeamId],
		queryFn: () => getTeam(primaryTeamId),
		enabled: Boolean(primaryTeamId),
	});
	const payPeriodConfig = teamQuery.data?.pay_period_config ?? null;

	// ─── Period ─────────────────────────────────────────────────────────────

	const period = useMemo(
		() => resolveTeamLogPeriod(search, payPeriodConfig),
		[search, payPeriodConfig],
	);
	// Project-keyed so it doesn't collide with the team Time pages' stored range.
	const periodScopeKey = `project:${projectId}`;

	useEffect(() => {
		if (search.preset && search.from && search.to) {
			storePeriodSearch(periodScopeKey, search);
			return;
		}
		const restored = loadStoredPeriodSearch(periodScopeKey);
		void navigate({
			to: "/project/$projectId/time",
			params: { projectId },
			search: restored ?? buildTeamLogPeriodSearch(period),
			replace: true,
		});
	}, [navigate, period, periodScopeKey, projectId, search]);

	const updatePeriod = (
		preset: LogPeriodPreset,
		overrides?: Partial<typeof period>,
	) => {
		const next = resolveTeamLogPeriod(
			{
				preset,
				from: overrides?.fromIso ?? period.fromIso,
				to: overrides?.toIso ?? period.toIso,
				cutoff_month: overrides?.cutoffMonth ?? period.cutoffMonth,
				cutoff_period: overrides?.cutoffPeriodId ?? period.cutoffPeriodId,
			},
			payPeriodConfig,
		);
		void navigate({
			to: "/project/$projectId/time",
			params: { projectId },
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

	const [viewMode, setViewMode] = useState<TimeViewMode>(() =>
		loadTimeView(`project:${projectId}`, "my"),
	);
	const changeViewMode = (mode: TimeViewMode) => {
		setViewMode(mode);
		storeTimeView(`project:${projectId}`, "my", mode);
	};

	// ─── Logs ───────────────────────────────────────────────────────────────
	//
	// One query per tab against the project-scoped endpoints — no fan-out over
	// attached teams, and the keys sit under ["team-time", …] so every existing
	// time mutation's invalidation reaches this page.

	const logsQuery = useQuery({
		queryKey: [
			"team-time",
			"project",
			projectId,
			"logs",
			tab,
			{
				status: activeStatus,
				taskStatusFilter,
				memberFilter,
				from: period.fromIso,
				to: period.toIso,
			},
		],
		queryFn: () => {
			const query = {
				status: activeStatus === "all" ? undefined : activeStatus,
				task_status: taskStatusFilter || undefined,
				from: period.fromIso,
				to: period.toIso,
				limit: 200,
			};
			return tab === "team"
				? teamTimeService.listProjectLogs(projectId, {
						...query,
						member_user_id: memberFilter || undefined,
					})
				: teamTimeService.listMyProjectLogs(projectId, query);
		},
	});
	const logs = logsQuery.data?.items ?? [];
	const listCapped = (logsQuery.data?.total ?? 0) > logs.length;

	// Accurate totals over the FULL filtered set, not the 200-row list cap. The
	// summary never sends a status filter, so the tab badges stay stable.
	const summaryQuery = useQuery({
		queryKey: [
			"team-time",
			"project",
			projectId,
			"summary",
			tab,
			{ memberFilter, from: period.fromIso, to: period.toIso },
		],
		queryFn: () => {
			const query = { from: period.fromIso, to: period.toIso };
			return tab === "team"
				? teamTimeService.getProjectLogsSummary(projectId, {
						...query,
						member_user_id: memberFilter || undefined,
					})
				: teamTimeService.getMyProjectLogsSummary(projectId, query);
		},
	});
	const stats = summaryQuery.data ?? EMPTY_LOG_STATS;
	const statusCounts = summaryQuery.data?.statusCounts;

	// Recent logs independent of the period, purely to dot worked days in the
	// period picker's calendar.
	const workedDaysQuery = useQuery({
		queryKey: ["team-time", "project", projectId, "worked-days", tab],
		queryFn: () =>
			tab === "team"
				? teamTimeService.listProjectLogs(projectId, { limit: 200 })
				: teamTimeService.listMyProjectLogs(projectId, { limit: 200 }),
	});
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

	const membersQuery = useQuery({
		queryKey: ["team-time", "project", projectId, "members"],
		queryFn: () => teamTimeService.listProjectLogMembers(projectId),
		enabled: tab === "team",
	});

	// Task options for the timer picker and the "change task" flow.
	// Project-scoped, so this no longer needs a primary team — a project with no
	// attached team used to get an empty task list here.
	const projectTasksKey = useMemo(
		() => ["team-time", "project", projectId, "tasks"] as const,
		[projectId],
	);
	const tasksQuery = useQuery({
		queryKey: projectTasksKey,
		queryFn: () => teamTimeService.listProjectTasks(projectId),
	});

	const myRatesQuery = useQuery({
		queryKey: ["team", primaryTeamId, "rates", "history", user?.id],
		queryFn: () => listMemberRates(primaryTeamId, user?.id ?? ""),
		enabled: Boolean(primaryTeamId && user?.id),
	});
	const myRates: TeamMemberRate[] = myRatesQuery.data ?? [];
	const ownRateByProjectId = useMemo(() => {
		const map: Record<string, { hourly_rate: number; currency: string }> = {};
		for (const r of myRates) {
			if (r.end_date !== null) continue;
			map[r.project_id] = {
				hourly_rate: Number(r.hourly_rate),
				currency: r.currency || "USD",
			};
		}
		return map;
	}, [myRates]);
	const activeRate = useMemo(
		() => myRates.find((r) => r.end_date === null) ?? null,
		[myRates],
	);

	// ─── Mutations ──────────────────────────────────────────────────────────

	const invalidate = () =>
		qc.invalidateQueries({ queryKey: ["team-time", "project", projectId] });

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
			invalidate();
		},
		onError: (e: Error, variables) => {
			markBusy(variables.ids, false);
			toast.error(e.message);
		},
	});

	// Start/stop go through useActiveTimer rather than calling the service
	// directly: it owns the ["team-time","running-log",userId] cache entry that
	// the floating widget reads, so the widget reflects the change immediately
	// instead of waiting out its 30s idle poll.
	// useActiveTimer already toasts start/stop — only the picker close is ours.
	const activeTimer = useActiveTimer({
		onStarted: () => setTimerPickerOpen(false),
	});

	const deleteMutation = useMutation({
		mutationFn: (id: string) => teamTimeService.deleteLog(id),
		onSuccess: () => {
			toast.success("Log deleted");
			invalidate();
			setDeletingLogId(null);
			setDeletingLogLabel(undefined);
		},
		onError: (e: Error) => {
			toast.error(e.message);
			setDeletingLogId(null);
		},
	});

	const editMutation = useMutation({
		mutationFn: (input: {
			id: string;
			started_at?: string;
			ended_at?: string;
			break_minutes?: number;
		}) =>
			teamTimeService.updateLog(input.id, {
				started_at: input.started_at,
				ended_at: input.ended_at,
				break_minutes: input.break_minutes,
			}),
		onSuccess: () => {
			toast.success("Log updated");
			invalidate();
			setEditingLog(null);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const taskChangeMutation = useMutation({
		mutationFn: (input: { id: string; task_id: string | null }) =>
			teamTimeService.updateLog(input.id, { task_id: input.task_id }),
		onSuccess: () => {
			toast.success("Task changed");
			invalidate();
			setTaskModalLog(null);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const manualLogMutation = useMutation({
		mutationFn: (input: {
			project_id: string;
			task_id: string | null;
			started_at: string;
			ended_at: string;
			break_minutes?: number;
		}) => teamTimeService.createManualLog(input),
		onSuccess: () => {
			toast.success("Log added");
			invalidate();
			setManualOpen(false);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	// ─── Row-action modal state ─────────────────────────────────────────────

	const [editingLog, setEditingLog] = useState<TaskTimeLog | null>(null);
	const [editStartedAt, setEditStartedAt] = useState("");
	const [editEndedAt, setEditEndedAt] = useState("");
	const [editBreakMinutes, setEditBreakMinutes] = useState(0);
	const [deletingLogId, setDeletingLogId] = useState<string | null>(null);
	const [deletingLogLabel, setDeletingLogLabel] = useState<
		string | undefined
	>();
	const [taskModalLog, setTaskModalLog] = useState<TaskTimeLog | null>(null);
	const [taskModalTaskId, setTaskModalTaskId] = useState("");
	const [manualOpen, setManualOpen] = useState(false);
	const [manualDateLabel, setManualDateLabel] = useState("");
	const [manualTaskId, setManualTaskId] = useState("");
	const [manualStart, setManualStart] = useState("");
	const [manualEnd, setManualEnd] = useState("");
	const [manualBreakMinutes, setManualBreakMinutes] = useState(0);
	const [timerPickerOpen, setTimerPickerOpen] = useState(false);
	const [timerTaskId, setTimerTaskId] = useState("");

	// Inline epic/feature/task creation from inside the timer picker. Shared
	// with the team Time page — it used to live only in that route file, which
	// is why this page never had a picker.
	const taskCreation = useTimeTaskCreation({
		projectId,
		tasks: tasksQuery.data ?? [],
		invalidateKeys: [projectTasksKey as unknown as unknown[]],
		onTaskCreated: (taskId) => setTimerTaskId(taskId),
	});

	const handleEdit = (log: TaskTimeLog) => {
		setEditingLog(log);
		setEditStartedAt(toLocalDateTimeInput(log.started_at));
		setEditEndedAt(toLocalDateTimeInput(log.ended_at));
		setEditBreakMinutes(log.break_minutes ?? 0);
	};

	const handleDelete = (logId: string) => {
		const log = logs.find((l) => l.id === logId);
		setDeletingLogLabel(log?.task?.title ?? undefined);
		setDeletingLogId(logId);
	};

	const handleOpenTaskModal = (log: TaskTimeLog) => {
		setTaskModalLog(log);
		setTaskModalTaskId(log.task_id ?? "");
	};

	const openManualForDay = (date: Date) => {
		const { start, end } = seedManualLogRange(date);
		setManualDateLabel(date.toLocaleDateString());
		setManualStart(start);
		setManualEnd(end);
		setManualBreakMinutes(0);
		setManualTaskId("");
		setManualOpen(true);
	};

	const handleOpenInRoadmap = (log: TaskTimeLog) => {
		if (!log.task_id) return;
		void navigate({
			to: "/project/$projectId/roadmap",
			params: { projectId: log.project_id },
			search: { taskId: log.task_id } as never,
		});
	};

	const handlePayMember = async (
		memberId: string,
		logIds: string[],
		currency: string,
		payAll?: boolean,
	) => {
		if (!primaryTeamId) {
			toast.error("Attach a team to this project before recording payouts.");
			return;
		}
		let target: TaskTimeLog[];
		if (payAll) {
			try {
				target = await teamTimeService.listAllMemberApprovedLogs(
					primaryTeamId,
					memberId,
					currency,
				);
			} catch (e) {
				toast.error((e as Error).message);
				return;
			}
		} else {
			const idSet = new Set(logIds);
			target = logs.filter((log) => idSet.has(log.id));
		}
		if (target.length === 0) return;
		const first = target[0];
		setPayTarget({
			memberId,
			memberLabel:
				first.member?.display_name || first.member?.email || memberId,
			currency,
			logs: target,
		});
	};

	const handleReviewLogs = async (
		ids: string[],
		decision: ReviewOnlyDecision,
	) => {
		if (ids.length === 0) return;
		await reviewMutation.mutateAsync({ ids, decision });
	};

	const rowPendingById = useMemo<Record<string, boolean>>(() => {
		const map: Record<string, boolean> = {};
		if (activeTimer.isStopping && activeTimer.runningLogId)
			map[activeTimer.runningLogId] = true;
		if (editMutation.isPending && editMutation.variables)
			map[editMutation.variables.id] = true;
		if (taskChangeMutation.isPending && taskChangeMutation.variables)
			map[taskChangeMutation.variables.id] = true;
		return map;
	}, [
		activeTimer.isStopping,
		activeTimer.runningLogId,
		editMutation.isPending,
		editMutation.variables,
		taskChangeMutation.isPending,
		taskChangeMutation.variables,
	]);

	const myBusyLogIds = useMemo(
		() =>
			new Set(Object.keys(rowPendingById).filter((id) => rowPendingById[id])),
		[rowPendingById],
	);

	// ─── Render ─────────────────────────────────────────────────────────────

	const noTeams = !teamsQuery.isPending && (teamsQuery.data ?? []).length === 0;

	return (
		<div className="w-full">
			<div className="mx-auto w-full max-w-[1200px] px-5 py-6 md:px-8 md:py-8">
				<AppSurfaceCard strong className="mb-6 p-6">
					<AppSectionHeader
						kicker="Time"
						title="Time logs"
						subtitle="Time tracked on this project — approve it, and see what it costs."
						rightSlot={
							primaryTeamId && canViewTeamLogs ? (
								<a
									href={`/teams/${primaryTeamId}/time/payouts`}
									className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
								>
									<ExternalLink className="h-3.5 w-3.5" />
									Payouts &amp; rates
								</a>
							) : undefined
						}
					/>
				</AppSurfaceCard>

				{noTeams ? (
					<div className="rounded-2xl border border-dashed border-border bg-card/60 px-4 py-12 text-center text-sm text-muted-foreground">
						No team is attached to this project yet, so there is no time to
						track. Attach one under Settings → Teams.
					</div>
				) : (
					<>
						{/* Scope + view */}
						<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
							<div className="inline-flex rounded-lg border border-border bg-card p-1">
								<TabButton
									active={tab === "mine"}
									onClick={() => setTab("mine")}
								>
									My logs
								</TabButton>
								{canViewTeamLogs && (
									<TabButton
										active={tab === "team"}
										onClick={() => setTab("team")}
									>
										Team logs
									</TabButton>
								)}
							</div>
							<TimeViewToggle value={viewMode} onChange={changeViewMode} />
						</div>

						{viewMode === "calendar" ? (
							<TimeLogCalendar
								projectId={projectId}
								mode={tab === "team" ? "team" : "my"}
								currentUserId={user?.id ?? null}
								busyLogIds={tab === "team" ? busyLogIds : myBusyLogIds}
								onReviewLogs={tab === "team" ? handleReviewLogs : undefined}
								onPayMember={tab === "team" ? handlePayMember : undefined}
								onStopLog={
									tab === "mine" ? () => activeTimer.stop() : undefined
								}
								onEditLog={tab === "mine" ? handleEdit : undefined}
								onDeleteLog={
									tab === "mine" ? (log) => handleDelete(log.id) : undefined
								}
								onChangeTask={tab === "mine" ? handleOpenTaskModal : undefined}
								onAddLogForDay={tab === "mine" ? openManualForDay : undefined}
								loadingTasks={tasksQuery.isFetching}
								onOpenTaskInRoadmap={handleOpenInRoadmap}
								canOpenTaskInRoadmap={(taskId) => Boolean(taskId)}
							/>
						) : (
							<>
								<div className="mb-3">
									<TeamLogsStatsCard
										rate={tab === "mine" ? activeRate : null}
										stats={stats}
										fallbackCurrency={
											(tab === "mine" ? activeRate?.currency : null) ||
											projectCurrency
										}
										loading={summaryQuery.isPending}
										includePaidColumn
										includeTrainingRate={false}
										rateLabel="Rate"
									/>
								</div>

								{tab === "mine" && logs.length > 0 && (
									<div className="mb-3">
										<HourCapBanner logs={logs} />
									</div>
								)}

								<div className="mb-4">
									<TeamLogsPeriodFilter
										period={period}
										payPeriodConfig={payPeriodConfig}
										onPresetChange={(preset) => updatePeriod(preset)}
										onCutoffMonthChange={(month) =>
											updatePeriod("cutoff", { cutoffMonth: month })
										}
										onCutoffPeriodChange={(periodId) =>
											updatePeriod("cutoff", { cutoffPeriodId: periodId })
										}
										onApplyCustomRange={onApplyCustomRange}
										workedDays={workedDays}
									/>
								</div>

								<div className="mb-3 space-y-2.5 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm">
									<TeamLogsStatusTabs
										value={activeStatus}
										onChange={setActiveStatus}
										counts={statusCounts}
									/>
									<div className="flex flex-wrap items-center gap-x-4 gap-y-3">
										{tab === "team" && (
											<FilterSelect
												value={memberFilter}
												onChange={setMemberFilter}
												icon={<Users className="h-3.5 w-3.5" />}
												placeholder="All members"
												options={[
													{ value: "", label: "All members" },
													...(membersQuery.data ?? []).map((member) => ({
														value: member.id,
														label:
															member.display_name || member.email || member.id,
														avatarUrl: member.avatar_url ?? null,
													})),
												]}
											/>
										)}
										<FilterSelect
											value={taskStatusFilter}
											onChange={setTaskStatusFilter}
											icon={<ListChecks className="h-3.5 w-3.5" />}
											placeholder="All task statuses"
											options={TASK_STATUS_FILTER_OPTIONS}
										/>
										{(logsQuery.isFetching || membersQuery.isLoading) && (
											<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
										)}
									</div>
								</div>

								{listCapped && (
									<p className="mb-2 px-1 text-xs text-muted-foreground">
										Showing the most recent 200 logs — narrow the period or
										filters to see the rest. Totals above cover the full range.
									</p>
								)}

								{tab === "team" ? (
									<TeamApprovalsInbox
										logs={logs}
										loadingLogs={logsQuery.isPending}
										currentUserId={user?.id ?? null}
										busyLogIds={busyLogIds}
										onReviewLogs={handleReviewLogs}
										onPayMember={handlePayMember}
										onOpenTaskInRoadmap={handleOpenInRoadmap}
										canOpenTaskInRoadmap={(taskId) => Boolean(taskId)}
									/>
								) : (
									<TeamMyLogsList
										logs={logs}
										tasks={tasksQuery.data ?? []}
										ownRateByProjectId={ownRateByProjectId}
										loadingLogs={logsQuery.isPending}
										loadingTasks={tasksQuery.isFetching}
										taskSyncById={{}}
										rowPendingById={rowPendingById}
										onOpenTaskModal={handleOpenTaskModal}
										onStopLog={() => activeTimer.stop()}
										onDeleteLog={handleDelete}
										onEditLog={handleEdit}
										onOpenTaskInRoadmap={handleOpenInRoadmap}
										canOpenTaskInRoadmap={(taskId) => Boolean(taskId)}
										// "Start a timer" now actually starts a timer. It used to
										// open the manual-log form, and this page had no start
										// path at all.
										onOpenAddLog={() => {
											setTimerTaskId("");
											setTimerPickerOpen(true);
										}}
										onOpenManualLog={() => openManualForDay(new Date())}
									/>
								)}
							</>
						)}
					</>
				)}
			</div>

			<EditLogModal
				isOpen={Boolean(editingLog)}
				startedAt={editStartedAt}
				endedAt={editEndedAt}
				breakMinutes={editBreakMinutes}
				saving={editMutation.isPending}
				onClose={() => setEditingLog(null)}
				onSave={() => {
					if (!editingLog) return;
					editMutation.mutate({
						id: editingLog.id,
						started_at: fromLocalDateTimeInput(editStartedAt),
						ended_at: fromLocalDateTimeInput(editEndedAt),
						break_minutes: editBreakMinutes,
					});
				}}
				onChangeStartedAt={setEditStartedAt}
				onChangeEndedAt={setEditEndedAt}
				onChangeBreakMinutes={setEditBreakMinutes}
			/>

			<DeleteTimeLogModal
				isOpen={Boolean(deletingLogId)}
				deleting={deleteMutation.isPending}
				taskLabel={deletingLogLabel}
				onClose={() => setDeletingLogId(null)}
				onConfirm={() => {
					if (deletingLogId) deleteMutation.mutate(deletingLogId);
				}}
			/>

			<ManualLogModal
				isOpen={manualOpen}
				dateLabel={manualDateLabel}
				projects={[
					{ id: projectId, title: projectQuery.data?.title ?? "This project" },
				]}
				tasks={tasksQuery.data ?? []}
				loadingTasks={tasksQuery.isFetching}
				selectedProjectId={projectId}
				selectedTaskId={manualTaskId}
				startedAt={manualStart}
				endedAt={manualEnd}
				breakMinutes={manualBreakMinutes}
				saving={manualLogMutation.isPending}
				retroactiveLogDays={teamQuery.data?.retroactive_log_days ?? null}
				onClose={() => setManualOpen(false)}
				onSave={() => {
					const startedAt = fromLocalDateTimeInput(manualStart);
					const endedAt = fromLocalDateTimeInput(manualEnd);
					if (!startedAt || !endedAt) {
						toast.error("Enter a valid start and end time.");
						return;
					}
					manualLogMutation.mutate({
						project_id: projectId,
						task_id: manualTaskId || null,
						started_at: startedAt,
						ended_at: endedAt,
						break_minutes: manualBreakMinutes,
					});
				}}
				onChangeProjectId={() => {}}
				onChangeTaskId={setManualTaskId}
				onChangeStartedAt={setManualStart}
				onChangeEndedAt={setManualEnd}
				onChangeBreakMinutes={setManualBreakMinutes}
			/>

			{/* Start a timer. Same four-column picker the team Time page uses —
			    this page previously had no way to start one at all. */}
			<AddLogModal
				isOpen={timerPickerOpen}
				projects={[
					{ id: projectId, title: projectQuery.data?.title ?? "This project" },
				]}
				tasks={tasksQuery.data ?? []}
				loadingTasks={tasksQuery.isFetching}
				selectedProjectId={projectId}
				selectedTaskId={timerTaskId}
				saving={activeTimer.isStarting}
				onClose={() => setTimerPickerOpen(false)}
				onSave={() => activeTimer.start(projectId, timerTaskId || null)}
				onChangeProjectId={() => {}}
				onChangeTaskId={setTimerTaskId}
				pendingEpics={taskCreation.pendingEpics}
				pendingFeatures={taskCreation.pendingFeatures}
				onCreateEpic={taskCreation.createEpic}
				onCreateFeature={taskCreation.createFeature}
				creatingEpic={taskCreation.creatingEpic}
				creatingFeature={taskCreation.creatingFeature}
			/>

			{/* Change the task a log is attributed to — the same picker again,
			    relabelled, instead of the hand-rolled <select> that used to live
			    in this file. */}
			<AddLogModal
				isOpen={Boolean(taskModalLog)}
				title="Change task"
				description="Move this log to a different task."
				saveLabel="Change task"
				projects={[
					{ id: projectId, title: projectQuery.data?.title ?? "This project" },
				]}
				tasks={tasksQuery.data ?? []}
				loadingTasks={tasksQuery.isFetching}
				selectedProjectId={projectId}
				selectedTaskId={taskModalTaskId}
				saving={taskChangeMutation.isPending}
				onClose={() => setTaskModalLog(null)}
				onSave={() => {
					if (!taskModalLog) return;
					taskChangeMutation.mutate({
						id: taskModalLog.id,
						task_id: taskModalTaskId || null,
					});
				}}
				onChangeProjectId={() => {}}
				onChangeTaskId={setTaskModalTaskId}
			/>

			{payTarget && primaryTeamId && (
				<PayMemberModal
					isOpen
					teamId={primaryTeamId}
					memberId={payTarget.memberId}
					memberLabel={payTarget.memberLabel}
					currency={payTarget.currency}
					logs={payTarget.logs}
					onClose={() => setPayTarget(null)}
					onSuccess={() => {
						setPayTarget(null);
						invalidate();
						void qc.invalidateQueries({ queryKey: ["payouts", primaryTeamId] });
					}}
				/>
			)}
		</div>
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
