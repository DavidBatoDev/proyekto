import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useToast } from "@/contexts/ToastContext";
import {
	type TaskTimeLog,
	teamTimeService,
} from "@/services/team-time.service";
import { useUser } from "@/stores/authStore";
import {
	confirmStopLongTimer,
	liveBreakSecondsFromLog,
	liveDurationSecondsFromLog,
	useLiveNowMs,
} from "./time-utils";

/**
 * The single source of truth for "is a timer running, and what is it doing".
 *
 * Everything that can start, break, or stop a timer goes through this hook —
 * the floating widget, the roadmap task rows, the task side panel, the My
 * Logs page. Sharing one query key means a task row knows it is the running
 * task without anyone threading a `runningTaskId` prop down to it, and one
 * shared stop path means break time can't be dropped by whichever button
 * happened to be clicked.
 *
 * Pause state lives on the server (`paused_at` / `break_seconds`), so a
 * break survives a refresh, a crash, or a move to another device.
 */
function useRunningLogQuery(enabled: boolean, userId: string | undefined) {
	return useQuery({
		queryKey: ["team-time", "running-log", userId ?? "anonymous"] as const,
		queryFn: () => teamTimeService.getMyRunningLog(),
		enabled: Boolean(userId) && enabled,
		refetchInterval: (query) => (query.state.data ? 3_000 : 30_000),
		refetchIntervalInBackground: false,
		retry: 1,
	});
}

/**
 * Read-only companion to {@link useActiveTimer} for callers that only need
 * to know which task is being timed (e.g. a row highlight). Shares the same
 * query, so it costs nothing extra, but skips the mutation observers.
 */
export function useRunningTaskId(): string | null {
	const user = useUser();
	return useRunningLogQuery(true, user?.id).data?.task_id ?? null;
}

export function useActiveTimer(options?: {
	enabled?: boolean;
	/**
	 * Callbacks so route-level UI (a toast, closing the picker) can react
	 * without re-implementing start/stop and losing the running-log cache
	 * update this hook owns.
	 */
	onStarted?: (log: TaskTimeLog) => void;
	onStopped?: () => void;
}) {
	const user = useUser();
	const toast = useToast();
	const queryClient = useQueryClient();
	const enabled = options?.enabled !== false;
	const { onStarted, onStopped } = options ?? {};

	const runningKey = useMemo(
		() => ["team-time", "running-log", user?.id ?? "anonymous"] as const,
		[user?.id],
	);

	const runningQuery = useRunningLogQuery(enabled, user?.id);

	const log = runningQuery.data ?? null;
	const isRunning = Boolean(log);
	const isPaused = Boolean(log?.paused_at);
	// Keep ticking while paused: the break counter needs the 1Hz pulse even
	// though the work clock is frozen.
	const nowMs = useLiveNowMs(isRunning);

	const setRunning = (next: TaskTimeLog | null) => {
		queryClient.setQueryData(runningKey, next);
	};

	const invalidateTime = () => {
		void queryClient.invalidateQueries({ queryKey: ["team-time"] });
	};

	const startMutation = useMutation({
		mutationFn: ({
			projectId,
			taskId,
		}: {
			projectId: string;
			taskId?: string | null;
		}) => teamTimeService.startLog(projectId, taskId),
		onSuccess: (row) => {
			setRunning(row);
			invalidateTime();
			if (row.contract_warning) toast.warning(row.contract_warning);
			onStarted?.(row);
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : "Failed to start timer",
			);
			invalidateTime();
		},
	});

	const pauseMutation = useMutation({
		mutationFn: (logId: string) => teamTimeService.pauseLog(logId),
		onMutate: async (logId) => {
			await queryClient.cancelQueries({ queryKey: runningKey });
			const previous = queryClient.getQueryData<TaskTimeLog | null>(runningKey);
			if (previous?.id === logId) {
				setRunning({ ...previous, paused_at: new Date().toISOString() });
			}
			return { previous };
		},
		onError: (error, _logId, context) => {
			if (context?.previous !== undefined) setRunning(context.previous);
			toast.error(
				error instanceof Error ? error.message : "Failed to start break",
			);
		},
		onSuccess: (row) => {
			setRunning(row);
			toast.success("On break — the work timer is paused.");
		},
	});

	const resumeMutation = useMutation({
		mutationFn: (logId: string) => teamTimeService.resumeLog(logId),
		onMutate: async (logId) => {
			await queryClient.cancelQueries({ queryKey: runningKey });
			const previous = queryClient.getQueryData<TaskTimeLog | null>(runningKey);
			if (previous?.id === logId) {
				setRunning({
					...previous,
					paused_at: null,
					break_seconds: liveBreakSecondsFromLog(previous, Date.now()),
				});
			}
			return { previous };
		},
		onError: (error, _logId, context) => {
			if (context?.previous !== undefined) setRunning(context.previous);
			toast.error(
				error instanceof Error ? error.message : "Failed to end break",
			);
		},
		onSuccess: (row) => {
			setRunning(row);
			const minutes = Math.round((row.break_seconds ?? 0) / 60);
			toast.success(
				minutes > 0
					? `Back to work — ${minutes}m of break logged.`
					: "Back to work.",
			);
		},
	});

	const stopMutation = useMutation({
		mutationFn: (logId: string) => teamTimeService.stopLog(logId),
		onMutate: async () => {
			await queryClient.cancelQueries({ queryKey: runningKey });
			const previous = queryClient.getQueryData<TaskTimeLog | null>(runningKey);
			setRunning(null);
			return { previous };
		},
		onError: (error, _logId, context) => {
			if (context?.previous !== undefined) setRunning(context.previous);
			toast.error(
				error instanceof Error ? error.message : "Failed to stop timer",
			);
			invalidateTime();
		},
		onSuccess: () => {
			setRunning(null);
			invalidateTime();
			toast.success("Timer stopped.");
			onStopped?.();
		},
	});

	const workSeconds = log ? liveDurationSecondsFromLog(log, nowMs) : 0;
	const breakSeconds = log ? liveBreakSecondsFromLog(log, nowMs) : 0;

	return {
		log,
		isRunning,
		isPaused,
		runningTaskId: log?.task_id ?? null,
		runningLogId: log?.id ?? null,
		/** Worked seconds, net of breaks and frozen while on break. */
		workSeconds,
		/** Break seconds, including the pause currently in progress. */
		breakSeconds,
		isBusy:
			startMutation.isPending ||
			pauseMutation.isPending ||
			resumeMutation.isPending ||
			stopMutation.isPending,
		isStopping: stopMutation.isPending,
		isStarting: startMutation.isPending,
		start: (projectId: string, taskId?: string | null) =>
			startMutation.mutate({ projectId, taskId }),
		pause: () => {
			if (log?.id) pauseMutation.mutate(log.id);
		},
		resume: () => {
			if (log?.id) resumeMutation.mutate(log.id);
		},
		toggleBreak: () => {
			if (!log?.id) return;
			if (log.paused_at) resumeMutation.mutate(log.id);
			else pauseMutation.mutate(log.id);
		},
		/** Stops the running timer, confirming first if it has run absurdly long. */
		stop: () => {
			if (!log?.id) return;
			if (!confirmStopLongTimer(workSeconds)) return;
			stopMutation.mutate(log.id);
		},
	};
}
