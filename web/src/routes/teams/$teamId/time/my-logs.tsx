import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/useToast";
import { useUser } from "@/stores/authStore";
import {
	listMemberRates,
	type TeamMember,
	type TeamMemberRate,
} from "@/services/teams.service";
import {
	teamTimeService,
	type TaskTimeLog,
} from "@/services/team-time.service";
import { TeamMyLogsGrid } from "@/components/team-time/TeamMyLogsGrid";
import { TeamMemberRateHistoryDrawer } from "@/components/team-time/TeamMemberRateHistoryDrawer";
import {
	TeamLogsStatsCard,
	computeLogStats,
} from "@/components/team-time/TeamLogsStatsCard";
import {
	AddLogModal,
	DeleteTimeLogModal,
	EditLogModal,
} from "@/components/team-time/TeamTimeModals";
import {
	fromLocalDateTimeInput,
	toLocalDateTimeInput,
} from "@/components/team-time/time-utils";

export const Route = createFileRoute("/teams/$teamId/time/my-logs")({
	component: MyLogsTab,
	beforeLoad: async ({ params }) => {
		// Visibility gate is the team-time/route.tsx layout, but it can't
		// see the caller's rate before the membership query resolves; an
		// unrated member who deep-links here gets bounced by the layout's
		// tabs list rendering (no My Logs tab). Soft check: nothing here.
		void params;
	},
});

function MyLogsTab() {
	const { teamId } = Route.useParams();
	const user = useUser();
	const toast = useToast();
	const qc = useQueryClient();
	const navigate = useNavigate();

	const [addOpen, setAddOpen] = useState(false);
	const [addProjectId, setAddProjectId] = useState("");
	const [addTaskId, setAddTaskId] = useState("");

	const [editingLog, setEditingLog] = useState<TaskTimeLog | null>(null);
	const [editStartedAt, setEditStartedAt] = useState("");
	const [editEndedAt, setEditEndedAt] = useState("");

	const [deletingLogId, setDeletingLogId] = useState<string | null>(null);

	const [taskModalLog, setTaskModalLog] = useState<TaskTimeLog | null>(null);
	const [taskModalTaskId, setTaskModalTaskId] = useState("");

	// ─── data ─────────────────────────────────────────────────────────

	// All rate rows for the caller. Active rows (end_date IS NULL) drive the
	// per-project fallback used by the live "Fees" column; the full list
	// powers the rate-history drawer and the "View history" affordance.
	const myRateHistoryQuery = useQuery({
		queryKey: ["team", teamId, "rates", "history", user?.id],
		queryFn: () => listMemberRates(teamId, user!.id),
		enabled: Boolean(user?.id),
	});

	const [historyOpen, setHistoryOpen] = useState(false);

	const logsQuery = useQuery({
		queryKey: ["team-time", teamId, "my-logs", user?.id],
		queryFn: () =>
			teamTimeService.listMyTeamLogs(teamId, { limit: 200 }),
	});

	const projectsQuery = useQuery({
		queryKey: ["team-time", teamId, "projects"],
		queryFn: () => teamTimeService.listTeamLogProjects(teamId),
	});

	const tasksForAddQuery = useQuery({
		queryKey: ["team-time", teamId, "project-tasks", addProjectId],
		queryFn: () =>
			teamTimeService.listTeamProjectTasks(teamId, addProjectId),
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
			teamTimeService.listTeamProjectTasks(
				teamId,
				taskModalLog!.project_id,
			),
		enabled: Boolean(taskModalLog),
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

	// When the Start Timer modal opens with no project selected, prefill
	// with the project of the user's most recent log; fall back to the
	// first project the team is attached to. Lets repeat-loggers go straight
	// to the task picker without a project click.
	useEffect(() => {
		if (!addOpen || addProjectId) return;
		const sortedByRecent = [...allLogs].sort(
			(a, b) =>
				new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
		);
		const recentProjectId = sortedByRecent[0]?.project_id;
		const fallbackProjectId = projectsQuery.data?.[0]?.id;
		const next = recentProjectId ?? fallbackProjectId;
		if (next) setAddProjectId(next);
	}, [addOpen, addProjectId, allLogs, projectsQuery.data]);

	// ─── mutations ─────────────────────────────────────────────────────

	const startMutation = useMutation({
		mutationFn: (input: { projectId: string; taskId: string }) =>
			teamTimeService.startLog(input.projectId, input.taskId),
		onSuccess: () => {
			toast.success("Timer started");
			qc.invalidateQueries({ queryKey: ["team-time", teamId, "my-logs"] });
			setAddOpen(false);
			setAddTaskId("");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const stopMutation = useMutation({
		mutationFn: (id: string) => teamTimeService.stopLog(id),
		onSuccess: () => {
			toast.success("Timer stopped");
			qc.invalidateQueries({ queryKey: ["team-time", teamId, "my-logs"] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const deleteMutation = useMutation({
		mutationFn: (id: string) => teamTimeService.deleteLog(id),
		onSuccess: () => {
			toast.success("Log deleted");
			qc.invalidateQueries({ queryKey: ["team-time", teamId, "my-logs"] });
			setDeletingLogId(null);
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
		}) =>
			teamTimeService.updateLog(input.id, {
				started_at: input.started_at,
				ended_at: input.ended_at,
			}),
		onSuccess: () => {
			toast.success("Log updated");
			qc.invalidateQueries({ queryKey: ["team-time", teamId, "my-logs"] });
			setEditingLog(null);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const taskChangeMutation = useMutation({
		mutationFn: (input: { id: string; task_id: string }) =>
			teamTimeService.updateLog(input.id, { task_id: input.task_id }),
		onSuccess: () => {
			toast.success("Task changed");
			qc.invalidateQueries({ queryKey: ["team-time", teamId, "my-logs"] });
			setTaskModalLog(null);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	// ─── handlers ─────────────────────────────────────────────────────

	const handleStop = useCallback(
		async (id: string) => {
			await stopMutation.mutateAsync(id);
		},
		[stopMutation],
	);
	const handleDelete = useCallback((id: string) => {
		setDeletingLogId(id);
		return Promise.resolve();
	}, []);
	const handleEdit = useCallback((log: TaskTimeLog) => {
		setEditingLog(log);
		setEditStartedAt(toLocalDateTimeInput(log.started_at));
		setEditEndedAt(toLocalDateTimeInput(log.ended_at));
	}, []);
	const handleOpenTaskModal = useCallback((log: TaskTimeLog) => {
		setTaskModalLog(log);
		setTaskModalTaskId(log.task_id);
	}, []);
	const handleOpenInRoadmap = useCallback(
		(log: TaskTimeLog) => {
			void navigate({
				to: "/project/$projectId/roadmap",
				params: { projectId: log.project_id },
				search: { taskId: log.task_id } as never,
			});
		},
		[navigate],
	);

	const rowPendingById = useMemo<Record<string, boolean>>(() => {
		const map: Record<string, boolean> = {};
		if (stopMutation.isPending && stopMutation.variables)
			map[stopMutation.variables as string] = true;
		if (editMutation.isPending && editMutation.variables)
			map[editMutation.variables.id] = true;
		if (taskChangeMutation.isPending && taskChangeMutation.variables)
			map[taskChangeMutation.variables.id] = true;
		return map;
	}, [
		stopMutation.isPending,
		stopMutation.variables,
		editMutation.isPending,
		editMutation.variables,
		taskChangeMutation.isPending,
		taskChangeMutation.variables,
	]);

	const taskSyncById = useMemo<Record<string, boolean>>(() => {
		if (!taskChangeMutation.isPending || !taskChangeMutation.variables)
			return {};
		return { [taskChangeMutation.variables.id]: true };
	}, [taskChangeMutation.isPending, taskChangeMutation.variables]);

	// Keep an empty fallback so the grid header still renders.
	const tasksForGrid = useMemo(() => {
		const seen = new Map<
			string,
			{
				id: string;
				title: string;
				feature_id: string;
				feature_title: string | null;
				epic_id: string | null;
				epic_title: string | null;
			}
		>();
		for (const log of allLogs) {
			if (log.task && !seen.has(log.task.id)) {
				seen.set(log.task.id, {
					id: log.task.id,
					title: log.task.title,
					feature_id: "",
					feature_title: null,
					epic_id: null,
					epic_title: null,
				});
			}
		}
		return Array.from(seen.values());
	}, [allLogs]);

	const logStats = useMemo(() => computeLogStats(allLogs), [allLogs]);

	const activeRate = firstActiveRate;
	const rateHistory = myAllRates;
	const activeRateCount = rateHistory.filter((r) => r.end_date === null).length;
	// Show the "View history" button when there's at least one closed row
	// beyond the currently active set.
	const hasRateHistory = rateHistory.length > activeRateCount;

	return (
		<>
			<TeamLogsStatsCard
				rate={activeRate}
				canShowHistory={hasRateHistory}
				onOpenHistory={() => setHistoryOpen(true)}
				stats={logStats}
				fallbackCurrency={activeRate?.currency ?? "USD"}
				loading={logsQuery.isPending}
			/>

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

			<TeamMyLogsGrid
				logs={allLogs}
				tasks={tasksForGrid}
				ownRateByProjectId={ownRateByProjectId}
				loadingLogs={logsQuery.isPending}
				loadingTasks={tasksForRowQuery.isFetching}
				taskSyncById={taskSyncById}
				rowPendingById={rowPendingById}
				onOpenTaskModal={handleOpenTaskModal}
				onStopLog={handleStop}
				onDeleteLog={handleDelete}
				onEditLog={handleEdit}
				onOpenTaskInRoadmap={handleOpenInRoadmap}
				canOpenTaskInRoadmap={() => true}
				onOpenAddLog={() => setAddOpen(true)}
			/>

			<AddLogModal
				isOpen={addOpen}
				projects={projectsQuery.data ?? []}
				tasks={tasksForAddQuery.data ?? []}
				loadingTasks={tasksForAddQuery.isFetching}
				selectedProjectId={addProjectId}
				selectedTaskId={addTaskId}
				saving={startMutation.isPending}
				saveLabel="Start Timer"
				title="Start a timer"
				description="Pick a project, then a task to start logging."
				onClose={() => {
					if (startMutation.isPending) return;
					setAddOpen(false);
					setAddTaskId("");
				}}
				onSave={() =>
					startMutation.mutate({
						projectId: addProjectId,
						taskId: addTaskId,
					})
				}
				onChangeProjectId={(v) => setAddProjectId(v)}
				onChangeTaskId={(v) => setAddTaskId(v)}
			/>

			<EditLogModal
				isOpen={Boolean(editingLog)}
				startedAt={editStartedAt}
				endedAt={editEndedAt}
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
					});
				}}
				onChangeStartedAt={setEditStartedAt}
				onChangeEndedAt={setEditEndedAt}
			/>

			<DeleteTimeLogModal
				isOpen={Boolean(deletingLogId)}
				deleting={deleteMutation.isPending}
				taskLabel={
					allLogs.find((l) => l.id === deletingLogId)?.task?.title ?? undefined
				}
				onClose={() => {
					if (deleteMutation.isPending) return;
					setDeletingLogId(null);
				}}
				onConfirm={() => {
					if (deletingLogId) deleteMutation.mutate(deletingLogId);
				}}
			/>

			<AddLogModal
				isOpen={Boolean(taskModalLog)}
				projects={
					taskModalLog
						? [
								{
									id: taskModalLog.project_id,
									title:
										taskModalLog.project?.title ?? "Current project",
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
					if (!taskModalTaskId || taskModalTaskId === taskModalLog.task_id)
						return;
					taskChangeMutation.mutate({
						id: taskModalLog.id,
						task_id: taskModalTaskId,
					});
				}}
				onChangeProjectId={() => {
					/* project is locked to the log's project */
				}}
				onChangeTaskId={(v) => setTaskModalTaskId(v)}
			/>
		</>
	);
}

/**
 * The history drawer expects a TeamMember to render the header. The
 * caller viewing their own rates isn't loaded into the team_members
 * query here (that's a separate fetch in the parent layout); fabricate
 * a minimal record from the auth user so the drawer can show a name.
 */
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
