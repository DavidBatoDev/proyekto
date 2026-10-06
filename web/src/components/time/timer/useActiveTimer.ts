// web/src/components/time/timer/useActiveTimer.ts
//
// The single source of truth for "is a timer running, and what is it doing".
//
// Everything that can break or stop a timer goes through this hook: the timer
// bar on /time, the floating timer, task rows, the task side panel. They all
// read one query (`timeQueries.running(userId)`, polled every 3 s while a timer
// runs and every 30 s otherwise), so a task row knows it is the running task
// without anyone threading a prop down to it, and one stop path means break
// time can't be dropped by whichever button was clicked. Starting goes through
// `useStartTimer` (the For step, the Switch prompt, the locked-period retry).
//
// Pause, resume and stop are optimistic, as before: the cache moves first and
// rolls back if the server refuses. On a stop, a 409 TIMER_NOT_RUNNING means
// the timer already stopped elsewhere (another device, the 24-hour cron, an
// agreement ending), so the cache follows the server instead of rolling back.
// On a pause or resume the same code also answers a timer that is still
// running ("This timer is already on break." / "…is not on break."), so the
// cache rolls back and refetches instead of dropping the timer.

import {
	type QueryClient,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "@/hooks/useToast";
import { serverNow } from "@/lib/serverClock";
import { invalidateTime, timeKeys, timeQueries } from "@/queries/time";
import { isTimeApiError, timeService } from "@/services/time.service";
import type { TimeEntryView } from "@/services/time.types";
import { useUser } from "@/stores/authStore";
import {
	TIMER_PAUSED_TOAST,
	TIMER_STOPPED_TOAST,
	timerErrorText,
	timerResumedToast,
} from "../for/forCopy";
import {
	liveBreakSeconds,
	liveWorkSeconds,
	useLiveNowMs,
} from "./liveDuration";

/** The signed-in user's id (the running key is user-scoped). */
export function useTimerUserId(): string | null {
	return useUser()?.id ?? null;
}

/** Writes the running entry into the cache (`null` = no timer). */
export function setRunningEntry(
	queryClient: QueryClient,
	userId: string | null | undefined,
	entry: TimeEntryView | null,
): void {
	queryClient.setQueryData<TimeEntryView | null>(
		timeKeys.running(userId),
		entry ? stripWarnings(entry) : null,
	);
}

/** A start or create answer carries `warnings`; the running cache holds the entry only. */
function stripWarnings(entry: TimeEntryView): TimeEntryView {
	if (!("warnings" in entry)) return entry;
	const { warnings: _warnings, ...rest } = entry as TimeEntryView & {
		warnings?: unknown;
	};
	return rest as TimeEntryView;
}

/**
 * The running entry, shared by every caller. `enabled: false` (a floating
 * timer on a page that hides it) keeps this caller from driving the poll;
 * any enabled caller still does.
 */
export function useRunningEntry(options: { enabled?: boolean } = {}) {
	const userId = useTimerUserId();
	const query = useQuery({
		...timeQueries.running(userId),
		enabled: Boolean(userId) && options.enabled !== false,
	});
	return { entry: query.data ?? null, query, userId };
}

/**
 * Read-only companion for callers that only need the running task (a row
 * highlight). Same query, no mutation observers.
 */
export function useRunningTaskId(): string | null {
	return useRunningEntry().entry?.task_id ?? null;
}

export interface ActiveTimerOptions {
	enabled?: boolean;
	/** After a stop the server accepted (the entry as stopped). */
	onStopped?: (entry: TimeEntryView | null) => void;
}

export function useActiveTimer(options: ActiveTimerOptions = {}) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const { entry, query, userId } = useRunningEntry({
		enabled: options.enabled,
	});
	const runningKey = timeKeys.running(userId);
	const { onStopped } = options;

	const isRunning = Boolean(entry);
	const isPaused = Boolean(entry?.paused_at);
	// Keep ticking while paused: the break counter needs the pulse even though
	// the work clock is frozen.
	const nowMs = useLiveNowMs(isRunning);

	const readRunning = () =>
		queryClient.getQueryData<TimeEntryView | null>(runningKey) ?? null;

	const afterWrite = () => {
		void invalidateTime(queryClient, "entry");
	};

	/** The timer stopped elsewhere: follow the server, never roll back to a ghost. */
	const followServer = () => {
		setRunningEntry(queryClient, userId, null);
		afterWrite();
	};

	const pauseMutation = useMutation({
		mutationFn: (entryId: string) => timeService.pauseEntry(entryId),
		onMutate: async (entryId) => {
			await queryClient.cancelQueries({ queryKey: runningKey });
			const previous = readRunning();
			if (previous?.id === entryId && !previous.paused_at) {
				setRunningEntry(queryClient, userId, {
					...previous,
					paused_at: new Date(serverNow()).toISOString(),
				});
			}
			return { previous };
		},
		onError: (error, _entryId, context) => {
			if (context) setRunningEntry(queryClient, userId, context.previous);
			if (isTimeApiError(error, "TIMER_NOT_RUNNING")) {
				// Its break state (or the timer itself) moved elsewhere: the
				// refetch shows which; the timer is not dropped meanwhile.
				afterWrite();
				toast.info(timerErrorText(error));
				return;
			}
			toast.error(timerErrorText(error));
		},
		onSuccess: (row) => {
			setRunningEntry(queryClient, userId, row.ended_at ? null : row);
			afterWrite();
			toast.success(TIMER_PAUSED_TOAST);
		},
	});

	const resumeMutation = useMutation({
		mutationFn: (entryId: string) => timeService.resumeEntry(entryId),
		onMutate: async (entryId) => {
			await queryClient.cancelQueries({ queryKey: runningKey });
			const previous = readRunning();
			if (previous?.id === entryId && previous.paused_at) {
				const banked = liveBreakSeconds(previous, serverNow());
				setRunningEntry(queryClient, userId, {
					...previous,
					paused_at: null,
					break_seconds: banked,
					break_minutes: Math.round(banked / 60),
				});
			}
			return { previous };
		},
		onError: (error, _entryId, context) => {
			if (context) setRunningEntry(queryClient, userId, context.previous);
			if (isTimeApiError(error, "TIMER_NOT_RUNNING")) {
				// Its break state (or the timer itself) moved elsewhere: the
				// refetch shows which; the timer is not dropped meanwhile.
				afterWrite();
				toast.info(timerErrorText(error));
				return;
			}
			toast.error(timerErrorText(error));
		},
		onSuccess: (row) => {
			setRunningEntry(queryClient, userId, row.ended_at ? null : row);
			afterWrite();
			toast.success(timerResumedToast(row.break_seconds ?? 0));
		},
	});

	const stopMutation = useMutation({
		mutationFn: (entryId: string) => timeService.stopEntry(entryId),
		onMutate: async () => {
			await queryClient.cancelQueries({ queryKey: runningKey });
			const previous = readRunning();
			setRunningEntry(queryClient, userId, null);
			return { previous };
		},
		onError: (error, _entryId, context) => {
			if (isTimeApiError(error, "TIMER_NOT_RUNNING")) {
				followServer();
				toast.info(timerErrorText(error));
				return;
			}
			if (context) setRunningEntry(queryClient, userId, context.previous);
			afterWrite();
			toast.error(timerErrorText(error));
		},
		onSuccess: (row) => {
			setRunningEntry(queryClient, userId, null);
			afterWrite();
			toast.success(TIMER_STOPPED_TOAST);
			onStopped?.(row ?? null);
		},
	});

	const workSeconds = entry ? liveWorkSeconds(entry, nowMs) : 0;
	const breakSeconds = entry ? liveBreakSeconds(entry, nowMs) : 0;
	const isBusy =
		pauseMutation.isPending ||
		resumeMutation.isPending ||
		stopMutation.isPending;

	const entryId = entry?.id ?? null;
	const paused = Boolean(entry?.paused_at);

	const pause = useCallback(() => {
		if (entryId && !paused) pauseMutation.mutate(entryId);
	}, [entryId, paused, pauseMutation.mutate]);

	const resume = useCallback(() => {
		if (entryId && paused) resumeMutation.mutate(entryId);
	}, [entryId, paused, resumeMutation.mutate]);

	const toggleBreak = useCallback(() => {
		if (!entryId) return;
		if (paused) resumeMutation.mutate(entryId);
		else pauseMutation.mutate(entryId);
	}, [entryId, paused, pauseMutation.mutate, resumeMutation.mutate]);

	const stop = useCallback(() => {
		if (entryId) stopMutation.mutate(entryId);
	}, [entryId, stopMutation.mutate]);

	/** Resolves true once the server stopped it (or it was already stopped). */
	const stopAsync = useCallback(async (): Promise<boolean> => {
		if (!entryId) return true;
		try {
			await stopMutation.mutateAsync(entryId);
			return true;
		} catch (error) {
			return isTimeApiError(error, "TIMER_NOT_RUNNING");
		}
	}, [entryId, stopMutation.mutateAsync]);

	return {
		entry,
		query,
		isRunning,
		isPaused,
		runningTaskId: entry?.task_id ?? null,
		runningProjectId: entry?.project_id ?? null,
		runningEntryId: entryId,
		/** Worked seconds, net of breaks and frozen while on break. */
		workSeconds,
		/** Break seconds, including the pause in progress. */
		breakSeconds,
		isBusy,
		isPausing: pauseMutation.isPending || resumeMutation.isPending,
		isStopping: stopMutation.isPending,
		pause,
		resume,
		toggleBreak,
		stop,
		stopAsync,
	};
}

export type ActiveTimer = ReturnType<typeof useActiveTimer>;
