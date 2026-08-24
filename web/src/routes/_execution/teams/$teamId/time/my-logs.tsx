import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollNavButtons } from "@/components/common/ScrollNavButtons";
import { SidePanel } from "@/components/roadmap/panels/SidePanel";
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
import { TeamLogsPeriodFilter } from "@/components/team-time/TeamLogsPeriodFilter";
import {
	EMPTY_LOG_STATS,
	TeamLogsStatsCard,
} from "@/components/team-time/TeamLogsStatsCard";
import { TeamMemberRateHistoryDrawer } from "@/components/team-time/TeamMemberRateHistoryDrawer";
import { TeamMyLogsList } from "@/components/team-time/TeamMyLogsList";
import {
	AddLogModal,
	DeleteTimeLogModal,
	EditLogModal,
	ManualLogModal,
} from "@/components/team-time/TeamTimeModals";
import { TimeLogDetailModal } from "@/components/team-time/TimeLogDetailModal";
import { TASK_STATUS_FILTER_OPTIONS } from "@/components/team-time/taskStatusFilter";
import {
	fromLocalDateTimeInput,
	seedManualLogRange,
	toLocalDateTimeInput,
} from "@/components/team-time/time-utils";
import { useActiveTimer } from "@/components/team-time/useActiveTimer";
import { useTimeTaskCreation } from "@/components/team-time/useTimeTaskCreation";
import { useToast } from "@/hooks/useToast";
import {
	type TaskTimeLog,
	teamTimeService,
} from "@/services/team-time.service";
import {
	getTeam,
	listMemberRates,
	type TeamMember,
	type TeamMemberRate,
} from "@/services/teams.service";
import { useUser } from "@/stores/authStore";
import type { RoadmapTask } from "@/types/roadmap";

export const Route = createFileRoute("/_execution/teams/$teamId/time/my-logs")({
	validateSearch: parseTeamLogPeriodSearch,
	component: MyLogsTab,
	beforeLoad: async ({ params }) => {
		void params;
	},
});

function MyLogsTab() {
	const { teamId } = Route.useParams();
	const search = Route.useSearch();
	const user = useUser();
	const toast = useToast();
	const qc = useQueryClient();
	const navigate = useNavigate();

	const teamQuery = useQuery({
		queryKey: ["teams", "detail", teamId],
		queryFn: () => getTeam(teamId),
	});
	const payPeriodConfig = teamQuery.data?.pay_period_config ?? null;

	const period = useMemo(
		() => resolveTeamLogPeriod(search, payPeriodConfig),
		[search, payPeriodConfig],
	);

	const [viewMode, setViewMode] = useState<TimeViewMode>(() =>
		loadTimeView(teamId, "my"),
	);
	const [taskStatusFilter, setTaskStatusFilter] = useState("");
	const changeViewMode = (mode: TimeViewMode) => {
		setViewMode(mode);
		storeTimeView(teamId, "my", mode);
	};

	useEffect(() => {
		// Keep the chosen period in localStorage (shared with Team Logs, keyed by
		// team) so a custom range survives moving between Time tabs and back.
		if (search.preset && search.from && search.to) {
			storePeriodSearch(teamId, search);
			return;
		}
		const restored = loadStoredPeriodSearch(teamId);
		void navigate({
			to: "/teams/$teamId/time/my-logs",
			params: { teamId },
			// Keep any open detail target — a deep link arrives with `log` but no
			// period, and restoring the period must not close the dialog.
			search: {
				...(restored ?? buildTeamLogPeriodSearch(period)),
				log: search.log,
			},
			replace: true,
		});
	}, [navigate, period, search, teamId]);

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
			to: "/teams/$teamId/time/my-logs",
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
	// ─── Modal / form state ─────────────────────────────────────────────────
	const [addOpen, setAddOpen] = useState(false);
	const [addProjectId, setAddProjectId] = useState("");
	const [addTaskId, setAddTaskId] = useState("");
	const [isCreateTaskPanelOpen, setIsCreateTaskPanelOpen] = useState(false);
	const [createTaskFeatureId, setCreateTaskFeatureId] = useState<string | null>(
		null,
	);
	const [createTaskContext, setCreateTaskContext] = useState<{
		featureId: string | null;
		epicTitle: string | null;
		featureTitle: string | null;
	} | null>(null);
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
	const [historyOpen, setHistoryOpen] = useState(false);
	// Manual (dated) log — "add a log for a day I forgot".
	const [manualOpen, setManualOpen] = useState(false);
	const [manualDateLabel, setManualDateLabel] = useState("");
	const [manualProjectId, setManualProjectId] = useState("");
	const [manualTaskId, setManualTaskId] = useState("");
	const [manualStart, setManualStart] = useState("");
	const [manualEnd, setManualEnd] = useState("");
	const [manualBreakMinutes, setManualBreakMinutes] = useState(0);

	// ─── Data ───────────────────────────────────────────────────────────────

	const myRateHistoryQuery = useQuery({
		queryKey: ["team", teamId, "rates", "history", user?.id],
		queryFn: () => listMemberRates(teamId, user!.id),
		enabled: Boolean(user?.id),
	});

	const logsQuery = useQuery({
		queryKey: [
			"team-time",
			teamId,
			"my-logs",
			user?.id,
			{ from: period.fromIso, to: period.toIso, taskStatusFilter },
		],
		queryFn: () =>
			teamTimeService.listMyTeamLogs(teamId, {
				from: period.fromIso,
				to: period.toIso,
				task_status: taskStatusFilter || undefined,
				limit: 200,
			}),
		enabled: Boolean(user?.id),
	});

	const projectsQuery = useQuery({
		queryKey: ["team-time", teamId, "projects"],
		queryFn: () => teamTimeService.listTeamLogProjects(teamId),
	});

	// Recent logs independent of the selected period, purely to dot the days you
	// worked in the calendar. Without a from/to the API returns your most recent
	// logs (capped at 200), so the indicator survives narrow period selections.
	const workedDaysQuery = useQuery({
		queryKey: ["team-time", teamId, "my-logs", "worked-days", user?.id],
		queryFn: () => teamTimeService.listMyTeamLogs(teamId, { limit: 200 }),
		enabled: Boolean(user?.id),
	});

	const tasksForAddQuery = useQuery({
		queryKey: ["team-time", teamId, "project-tasks", addProjectId],
		queryFn: () => teamTimeService.listTeamProjectTasks(teamId, addProjectId),
		enabled: Boolean(addProjectId),
	});

	const tasksForRowQuery = useQuery({
		queryKey: [
			"team-time",
			teamId,
			"project-tasks",
			taskModalLog?.project_id ?? "",
		],
		queryFn: () =>
			teamTimeService.listTeamProjectTasks(teamId, taskModalLog!.project_id),
		enabled: Boolean(taskModalLog),
	});

	const tasksForManualQuery = useQuery({
		queryKey: ["team-time", teamId, "project-tasks", manualProjectId],
		queryFn: () =>
			teamTimeService.listTeamProjectTasks(teamId, manualProjectId),
		enabled: Boolean(manualProjectId),
	});

	const myAllRates: TeamMemberRate[] = myRateHistoryQuery.data ?? [];
	const ownRateByProjectId = useMemo(() => {
		const map: Record<string, { hourly_rate: number; currency: string }> = {};
		for (const r of myAllRates) {
			if (r.end_date !== null) continue;
			map[r.project_id] = {
				hourly_rate: Number(r.hourly_rate),
				currency: r.currency || "USD",
			};
		}
		return map;
	}, [myAllRates]);

	const firstActiveRate = useMemo<TeamMemberRate | null>(
		() => myAllRates.find((r) => r.end_date === null) ?? null,
		[myAllRates],
	);

	const allLogs = logsQuery.data?.items ?? [];

	// Accurate totals over the full period, not just the 200-row list cap.
	const summaryQuery = useQuery({
		queryKey: [
			"team-time",
			teamId,
			"my-logs",
			"summary",
			user?.id,
			{ from: period.fromIso, to: period.toIso },
		],
		queryFn: () =>
			teamTimeService.getMyTeamLogsSummary(teamId, {
				from: period.fromIso,
				to: period.toIso,
			}),
		enabled: Boolean(user?.id),
	});
	const stats = summaryQuery.data ?? EMPTY_LOG_STATS;
	const listCapped =
		(logsQuery.data?.total ?? 0) > (logsQuery.data?.items.length ?? 0);

	// Local `yyyy-MM-dd` keys for every day with a log, so the period calendar
	// can dot the days you actually worked (period-independent — see query above).
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

	// Prefill project when add modal opens
	useEffect(() => {
		if (!addOpen || addProjectId) return;
		const sortedByRecent = [...allLogs].sort(
			(a, b) =>
				new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
		);
		const next = sortedByRecent[0]?.project_id ?? projectsQuery.data?.[0]?.id;
		if (next) setAddProjectId(next);
	}, [addOpen, addProjectId, allLogs, projectsQuery.data]);

	// ─── Mutations ──────────────────────────────────────────────────────────

	// Start/stop go through useActiveTimer, which owns the
	// ["team-time","running-log",userId] cache entry the floating widget reads.
	// These used to call the service directly and invalidate only
	// ["team-time", teamId, "my-logs"] — a key that does NOT prefix-match the
	// running-log one, so the widget lagged up to 30s behind its idle poll.
	const activeTimer = useActiveTimer({
		onStarted: () => {
			setAddOpen(false);
			setAddTaskId("");
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (id: string) => teamTimeService.deleteLog(id),
		onSuccess: () => {
			toast.success("Log deleted");
			qc.invalidateQueries({ queryKey: ["team-time", teamId, "my-logs"] });
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
			qc.invalidateQueries({ queryKey: ["team-time", teamId, "my-logs"] });
			setEditingLog(null);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const taskChangeMutation = useMutation({
		mutationFn: (input: { id: string; task_id: string | null }) =>
			teamTimeService.updateLog(input.id, { task_id: input.task_id }),
		onSuccess: () => {
			toast.success("Task changed");
			qc.invalidateQueries({ queryKey: ["team-time", teamId, "my-logs"] });
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
			qc.invalidateQueries({ queryKey: ["team-time", teamId, "my-logs"] });
			setManualOpen(false);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	// Inline epic/feature/task creation from the timer picker. This used to be
	// ~140 lines of route-local mutations here, which is the only reason the
	// project Time page could not render the same picker.
	const taskCreation = useTimeTaskCreation({
		projectId: addProjectId || null,
		tasks: tasksForAddQuery.data ?? [],
		invalidateKeys: [
			["team-time", teamId, "project-tasks", addProjectId],
			["team-time", "project", addProjectId, "tasks"],
		],
		onTaskCreated: (taskId) => setAddTaskId(taskId),
		onTaskSettled: () => {
			setIsCreateTaskPanelOpen(false);
			setCreateTaskFeatureId(null);
			setCreateTaskContext(null);
		},
	});

	// ─── Handlers ───────────────────────────────────────────────────────────

	// activeTimer.stop() carries the forgotten-timer confirmation itself, so the
	// duplicate elapsed-time guard that used to live here is gone.
	const handleStop = useCallback(() => {
		activeTimer.stop();
	}, [activeTimer]);
	const handleDelete = useCallback(
		(id: string) => {
			const label = allLogs.find((l) => l.id === id)?.task?.title ?? undefined;
			setDeletingLogLabel(label);
			setDeletingLogId(id);
			return Promise.resolve();
		},
		[allLogs],
	);
	const handleEdit = useCallback((log: TaskTimeLog) => {
		setEditingLog(log);
		setEditStartedAt(toLocalDateTimeInput(log.started_at));
		setEditEndedAt(toLocalDateTimeInput(log.ended_at));
		setEditBreakMinutes(log.break_minutes ?? 0);
	}, []);
	const handleOpenTaskModal = useCallback((log: TaskTimeLog) => {
		setTaskModalLog(log);
		setTaskModalTaskId(log.task_id ?? "");
	}, []);
	const handleAddLogForDay = useCallback(
		(date: Date) => {
			// For today this seeds the hour that just ended rather than a fixed
			// 09:00–10:00 block, which was wrong for anyone logging after lunch.
			const { start, end } = seedManualLogRange(date);
			setManualDateLabel(
				new Intl.DateTimeFormat(undefined, {
					weekday: "long",
					month: "long",
					day: "numeric",
					year: "numeric",
				}).format(date),
			);
			setManualStart(start);
			setManualEnd(end);
			setManualBreakMinutes(0);
			// Default the project to the most recently used one.
			const recent = [...allLogs].sort(
				(a, b) =>
					new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
			)[0]?.project_id;
			setManualProjectId(recent ?? projectsQuery.data?.[0]?.id ?? "");
			setManualTaskId("");
			setManualOpen(true);
		},
		[allLogs, projectsQuery.data],
	);
	// The detail lives in the URL so it survives a refresh and can be linked to,
	// but it renders as a dialog over this list — not as its own page.
	const detailLogId = search.log ?? null;
	const setDetailLogId = useCallback(
		(logId: string | null) => {
			void navigate({
				to: "/teams/$teamId/time/my-logs",
				params: { teamId },
				search: { ...search, log: logId ?? undefined },
				replace: true,
			});
		},
		[navigate, search, teamId],
	);
	const handleOpenInRoadmap = useCallback(
		(log: TaskTimeLog) => {
			if (!log.task_id) return;
			void navigate({
				to: "/project/$projectId/roadmap",
				params: { projectId: log.project_id },
				search: { taskId: log.task_id } as never,
			});
		},
		[navigate],
	);
	const handleOpenCreateTaskPanel = useCallback(
		(ctx: {
			featureId: string | null;
			epicTitle: string | null;
			featureTitle: string | null;
		}) => {
			if (!ctx.featureId && !ctx.featureTitle) {
				toast.error("Select a feature before creating a task.");
				return;
			}
			setCreateTaskContext(ctx);
			setCreateTaskFeatureId(ctx.featureId?.trim() || null);
			setIsCreateTaskPanelOpen(true);
		},
		[toast],
	);
	const handleCreateTaskFromTimer = useCallback(
		async (taskData: Partial<RoadmapTask>) => {
			await taskCreation.createTask({
				taskData,
				featureId: createTaskFeatureId,
				context: createTaskContext,
			});
		},
		[createTaskContext, createTaskFeatureId, taskCreation],
	);

	// New epics/features are scoped to the selected project; drop them when the
	// project changes so a different project never shows another's pending nodes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: addProjectId is a trigger-only dep — the body just clears state on project switch.
	useEffect(() => {
		taskCreation.reset();
	}, [addProjectId]);

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

	// Calendar day-modal spinners reuse the list's per-row pending map, as a Set.
	const myBusyLogIds = useMemo(
		() =>
			new Set(Object.keys(rowPendingById).filter((id) => rowPendingById[id])),
		[rowPendingById],
	);
	const hasActiveLog = useMemo(
		() => allLogs.some((l) => !l.ended_at),
		[allLogs],
	);

	const activeRate = firstActiveRate;
	const rateHistory = myAllRates;
	const hasRateHistory =
		rateHistory.filter((r) => r.end_date === null).length < rateHistory.length;

	// ─── Render ─────────────────────────────────────────────────────────────

	return (
		<>
			<div className="mb-3 flex flex-wrap items-center justify-end gap-3">
				<FilterSelect
					value={taskStatusFilter}
					onChange={setTaskStatusFilter}
					icon={<ListChecks className="h-3.5 w-3.5" />}
					placeholder="All task statuses"
					options={TASK_STATUS_FILTER_OPTIONS}
				/>
				<TimeViewToggle value={viewMode} onChange={changeViewMode} />
			</div>

			{viewMode === "calendar" ? (
				<TimeLogCalendar
					teamId={teamId}
					mode="my"
					currentUserId={user?.id ?? null}
					busyLogIds={myBusyLogIds}
					hasActiveLog={hasActiveLog}
					loadingTasks={tasksForRowQuery.isFetching}
					onStopLog={() => handleStop()}
					onEditLog={handleEdit}
					onDeleteLog={(log) => {
						setDeletingLogLabel(log.task?.title ?? undefined);
						setDeletingLogId(log.id);
					}}
					onChangeTask={handleOpenTaskModal}
					onStartTimer={() => setAddOpen(true)}
					onAddLogForDay={handleAddLogForDay}
					onOpenTaskInRoadmap={handleOpenInRoadmap}
					canOpenTaskInRoadmap={(taskId) => Boolean(taskId)}
				/>
			) : (
				<>
					{/* Rate + balance summary */}
					<div className="mb-3">
						<TeamLogsStatsCard
							rate={activeRate}
							stats={stats}
							fallbackCurrency={activeRate?.currency || "USD"}
							loading={summaryQuery.isPending}
							canShowHistory={hasRateHistory}
							onOpenHistory={
								hasRateHistory ? () => setHistoryOpen(true) : undefined
							}
							includePaidColumn
							includeTrainingRate={false}
							rateLabel="Rate"
						/>
					</div>
					{/* Hour-cap progress (only when a rate has a weekly/monthly cap) */}
					{allLogs.length > 0 && (
						<div className="mb-3">
							<HourCapBanner logs={allLogs} />
						</div>
					)}
					{/* Date range filter (below the summary) */}
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
					{listCapped && (
						<p className="mb-2 px-1 text-xs text-slate-400">
							Showing your most recent 200 logs for this period — narrow the
							range to see the rest. Totals above cover the full period.
						</p>
					)}
					{/* Activity — e-wallet style transaction list */}
					<TeamMyLogsList
						logs={allLogs}
						tasks={tasksForRowQuery.data ?? []}
						ownRateByProjectId={ownRateByProjectId}
						loadingLogs={logsQuery.isPending}
						loadingTasks={tasksForRowQuery.isFetching}
						taskSyncById={{}}
						rowPendingById={rowPendingById}
						onOpenTaskModal={handleOpenTaskModal}
						onStopLog={handleStop}
						onDeleteLog={handleDelete}
						onEditLog={handleEdit}
						onOpenTaskInRoadmap={handleOpenInRoadmap}
						canOpenTaskInRoadmap={(taskId) => Boolean(taskId)}
						onViewTimeline={(log) => setDetailLogId(log.id)}
						onOpenAddLog={() => setAddOpen(true)}
						// Manual entry used to be reachable only through the calendar.
						onOpenManualLog={() => handleAddLogForDay(new Date())}
					/>
				</>
			)}

			{/* Rate history drawer */}
			<TeamMemberRateHistoryDrawer
				isOpen={historyOpen}
				member={meAsMember(user?.id, user?.email)}
				rates={rateHistory}
				projectTitleById={Object.fromEntries(
					(projectsQuery.data ?? []).map((p) => [p.id, p.title]),
				)}
				loadingRates={myRateHistoryQuery.isPending}
				canManage={false}
				rowPendingByRateId={{}}
				onClose={() => setHistoryOpen(false)}
				onAddRate={() => {}}
				onEditRate={() => {}}
				onDeleteRate={() => {}}
			/>

			{/* Start timer / Add log modal */}
			<AddLogModal
				isOpen={addOpen}
				projects={projectsQuery.data ?? []}
				tasks={tasksForAddQuery.data ?? []}
				loadingTasks={tasksForAddQuery.isFetching}
				selectedProjectId={addProjectId}
				selectedTaskId={addTaskId}
				saving={activeTimer.isStarting}
				saveLabel="Start Timer"
				title="Start a timer"
				description="Pick a project, then a task to start logging."
				onClose={() => {
					if (activeTimer.isStarting) return;
					setAddOpen(false);
					setAddTaskId("");
				}}
				onSave={() => activeTimer.start(addProjectId, addTaskId || null)}
				onChangeProjectId={(v) => setAddProjectId(v)}
				onChangeTaskId={(v) => setAddTaskId(v)}
				onRequestCreateTask={handleOpenCreateTaskPanel}
				creatingTask={taskCreation.creatingTask}
				pendingEpics={taskCreation.pendingEpics}
				pendingFeatures={taskCreation.pendingFeatures}
				onCreateEpic={taskCreation.createEpic}
				onCreateFeature={taskCreation.createFeature}
				creatingEpic={taskCreation.creatingEpic}
				creatingFeature={taskCreation.creatingFeature}
			/>

			{/* Create task panel */}
			<SidePanel
				task={null}
				isOpen={isCreateTaskPanelOpen}
				isCreating
				projectId={addProjectId}
				onClose={() => {
					if (taskCreation.creatingTask) return;
					setIsCreateTaskPanelOpen(false);
					setCreateTaskFeatureId(null);
					setCreateTaskContext(null);
				}}
				onUpdateTask={() => {}}
				onDeleteTask={() => {}}
				onCreateTask={handleCreateTaskFromTimer}
				isLoading={taskCreation.creatingTask}
				zIndexBase={10000}
			/>

			{/* Edit log modal */}
			<EditLogModal
				isOpen={Boolean(editingLog)}
				startedAt={editStartedAt}
				endedAt={editEndedAt}
				breakMinutes={editBreakMinutes}
				saving={editMutation.isPending}
				onClose={() => {
					if (editMutation.isPending) return;
					setEditingLog(null);
				}}
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

			{/* Delete modal */}
			<DeleteTimeLogModal
				isOpen={Boolean(deletingLogId)}
				deleting={deleteMutation.isPending}
				taskLabel={deletingLogLabel}
				onClose={() => {
					if (deleteMutation.isPending) return;
					setDeletingLogId(null);
				}}
				onConfirm={() => {
					if (deletingLogId) deleteMutation.mutate(deletingLogId);
				}}
			/>

			{/* Change task modal */}
			<AddLogModal
				isOpen={Boolean(taskModalLog)}
				projects={
					taskModalLog
						? [
								{
									id: taskModalLog.project_id,
									title: taskModalLog.project?.title ?? "Current project",
								},
							]
						: []
				}
				tasks={tasksForRowQuery.data ?? []}
				loadingTasks={tasksForRowQuery.isFetching}
				selectedProjectId={taskModalLog?.project_id ?? ""}
				selectedTaskId={taskModalTaskId}
				saving={taskChangeMutation.isPending}
				title="Change task"
				description="Reassign this log to another task in the same project."
				saveLabel="Change task"
				onClose={() => {
					if (taskChangeMutation.isPending) return;
					setTaskModalLog(null);
				}}
				onSave={() => {
					if (!taskModalLog) return;
					const next = taskModalTaskId || null;
					if (next === taskModalLog.task_id) return;
					taskChangeMutation.mutate({ id: taskModalLog.id, task_id: next });
				}}
				onChangeProjectId={() => {}}
				onChangeTaskId={(v) => setTaskModalTaskId(v)}
			/>

			{/* Manual dated log (add for a past day) */}
			<ManualLogModal
				isOpen={manualOpen}
				dateLabel={manualDateLabel}
				projects={projectsQuery.data ?? []}
				tasks={tasksForManualQuery.data ?? []}
				loadingTasks={tasksForManualQuery.isFetching}
				selectedProjectId={manualProjectId}
				selectedTaskId={manualTaskId}
				startedAt={manualStart}
				endedAt={manualEnd}
				breakMinutes={manualBreakMinutes}
				saving={manualLogMutation.isPending}
				retroactiveLogDays={teamQuery.data?.retroactive_log_days ?? null}
				onClose={() => {
					if (manualLogMutation.isPending) return;
					setManualOpen(false);
				}}
				onSave={() => {
					const started = fromLocalDateTimeInput(manualStart);
					const ended = fromLocalDateTimeInput(manualEnd);
					if (!manualProjectId || !started || !ended) return;
					manualLogMutation.mutate({
						project_id: manualProjectId,
						task_id: manualTaskId || null,
						started_at: started,
						ended_at: ended,
						break_minutes: manualBreakMinutes,
					});
				}}
				onChangeProjectId={(v) => {
					setManualProjectId(v);
					setManualTaskId("");
				}}
				onChangeTaskId={setManualTaskId}
				onChangeStartedAt={setManualStart}
				onChangeEndedAt={setManualEnd}
				onChangeBreakMinutes={setManualBreakMinutes}
			/>

			{/* Log detail (work & break timeline, review thread) */}
			<TimeLogDetailModal
				teamId={teamId}
				logId={detailLogId}
				onClose={() => setDetailLogId(null)}
			/>

			<ScrollNavButtons />
		</>
	);
}

function meAsMember(
	userId: string | undefined,
	email: string | null | undefined,
): TeamMember | null {
	if (!userId) return null;
	return {
		id: userId,
		team_id: "",
		user_id: userId,
		role: "member",
		position: null,
		joined_at: "",
		user: {
			id: userId,
			display_name: "You",
			avatar_url: null,
			email: email ?? null,
			first_name: null,
			last_name: null,
		},
	};
}
