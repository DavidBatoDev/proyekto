import { Coffee, Loader2, Play, Square } from "lucide-react";
import { useActiveTimer } from "./useActiveTimer";

function hhmmss(totalSeconds: number): string {
	const safe = Math.max(0, Math.floor(totalSeconds));
	const h = Math.floor(safe / 3600)
		.toString()
		.padStart(2, "0");
	const m = Math.floor((safe % 3600) / 60)
		.toString()
		.padStart(2, "0");
	const s = (safe % 60).toString().padStart(2, "0");
	return `${h}:${m}:${s}`;
}

/**
 * Full start / break / stop cluster with a live readout, for surfaces with
 * room for it (the task detail panel). Dense rows use
 * {@link TaskTimerButton} instead.
 */
export function TaskTimerInline({
	projectId,
	taskId,
	className = "",
}: {
	projectId: string;
	taskId: string;
	className?: string;
}) {
	const {
		runningTaskId,
		isRunning,
		isPaused,
		workSeconds,
		breakSeconds,
		isBusy,
		isStarting,
		start,
		stop,
		toggleBreak,
	} = useActiveTimer();

	if (!projectId || !taskId) return null;

	const isThisTask = runningTaskId === taskId;
	const otherTaskRunning = isRunning && !isThisTask;

	if (!isThisTask) {
		return (
			<button
				type="button"
				onClick={() => start(projectId, taskId)}
				disabled={isBusy || otherTaskRunning}
				title={
					otherTaskRunning
						? "Another timer is running — stop it first"
						: "Start tracking time on this task"
				}
				className={`inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
			>
				{isStarting ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin" />
				) : (
					<Play className="h-3.5 w-3.5 fill-current" />
				)}
				Start timer
			</button>
		);
	}

	return (
		<div className={`inline-flex items-center gap-2 ${className}`}>
			<span
				className={`tabular-nums text-xs font-bold ${
					isPaused ? "text-slate-400" : "text-emerald-700"
				}`}
				title={isPaused ? "Work clock paused" : "Time worked on this task"}
			>
				{hhmmss(workSeconds)}
			</span>
			{breakSeconds > 0 && (
				<span
					className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900"
					title="Break time logged on this session"
				>
					<Coffee className="h-3 w-3" />
					{Math.round(breakSeconds / 60)}m
				</span>
			)}
			<button
				type="button"
				onClick={toggleBreak}
				disabled={isBusy}
				title={isPaused ? "End break" : "Start a break — the timer pauses"}
				className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
					isPaused
						? "border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-700"
						: "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
				}`}
			>
				{isPaused ? (
					<Play className="h-3 w-3 fill-current" />
				) : (
					<Coffee className="h-3 w-3" />
				)}
				{isPaused ? "Resume" : "Break"}
			</button>
			<button
				type="button"
				onClick={stop}
				disabled={isBusy}
				title="Stop timer and record the log"
				className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
			>
				<Square className="h-3 w-3" />
				Stop
			</button>
		</div>
	);
}
