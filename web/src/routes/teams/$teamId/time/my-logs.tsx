import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/useToast";
import { useUser } from "@/stores/authStore";
import { listTeamMembers } from "@/services/teams.service";
import {
	teamTimeService,
	type TaskTimeLog,
} from "@/services/team-time.service";
import { TeamMyLogsGrid } from "@/components/team-time/TeamMyLogsGrid";
import {
	AddLogModal,
	DeleteTimeLogModal,
	EditLogModal,
} from "@/components/team-time/TeamTimeModals";
import { TeamTaskTreePicker } from "@/components/team-time/TeamTaskTreePicker";
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

	const membersQuery = useQuery({
		queryKey: ["team", teamId, "members"],
		queryFn: () => listTeamMembers(teamId),
	});
	const myMembership = membersQuery.data?.find((m) => m.user_id === user?.id);

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

	const ownRate = useMemo(() => {
		if (!myMembership || myMembership.hourly_rate == null) return null;
		return {
			team_id: teamId,
			hourly_rate: Number(myMembership.hourly_rate),
			currency: myMembership.currency ?? "USD",
		};
	}, [myMembership, teamId]);

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

	return (
		<>
			<TeamMyLogsGrid
				logs={allLogs}
				tasks={tasksForGrid}
				ownRate={ownRate}
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

			{taskModalLog ? (
				<div
					className="fixed inset-0 z-165 flex items-center justify-center bg-slate-900/55 backdrop-blur-[2px] p-4"
					onClick={() => {
						if (taskChangeMutation.isPending) return;
						setTaskModalLog(null);
					}}
				>
					<div
						className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="border-b border-gray-200 px-5 py-4">
							<h3 className="text-base font-semibold text-gray-900">
								Change task
							</h3>
							<p className="text-xs text-gray-500 mt-1">
								Reassign this log to another task in{" "}
								{taskModalLog.project?.title ?? "this project"}.
							</p>
						</div>
						<div className="p-5 space-y-3">
							<TeamTaskTreePicker
								tasks={tasksForRowQuery.data ?? []}
								value={taskModalTaskId}
								enableFind
								selectedLabelMode="path"
								onChange={(taskId) => setTaskModalTaskId(taskId)}
							/>
						</div>
						<div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4 bg-gray-50">
							<button
								type="button"
								onClick={() => setTaskModalLog(null)}
								disabled={taskChangeMutation.isPending}
								className="px-3 py-2 text-xs font-semibold rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50"
							>
								Cancel
							</button>
							<button
								type="button"
								disabled={
									taskChangeMutation.isPending ||
									!taskModalTaskId ||
									taskModalTaskId === taskModalLog.task_id
								}
								onClick={() =>
									taskChangeMutation.mutate({
										id: taskModalLog.id,
										task_id: taskModalTaskId,
									})
								}
								className="px-3 py-2 text-xs font-semibold rounded-md border border-slate-700 bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
							>
								Change task
							</button>
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
