import { Coffee, Loader2, Play, Square } from "lucide-react";
import { useActiveTimer } from "./useActiveTimer";

/**
 * Start/stop the work timer for one task.
 *
 * Running state comes from the shared running-log query rather than a prop,
 * so every mount site — canvas rows, task lists, modals, the side panel —
 * agrees on which task is being timed without anyone threading a
 * `runningTaskId` down the tree. When a *different* task is running the
 * button disables itself instead of firing a request the API would reject.
 */
export function TaskTimerButton({
	projectId,
	taskId,
	size = "sm",
	className = "",
}: {
	projectId: string;
	taskId: string;
	/** "sm" for dense rows, "md" for the task side panel. */
	size?: "sm" | "md";
	className?: string;
}) {
	const { runningTaskId, isRunning, isPaused, isBusy, start, stop } =
		useActiveTimer();

	if (!projectId) return null;

	const isThisTask = runningTaskId === taskId;
	const otherTaskRunning = isRunning && !isThisTask;
	const icon = size === "md" ? "h-4 w-4" : "h-4 w-4";
	const pad = size === "md" ? "px-2.5 py-1.5" : "p-1";

	const title = isThisTask
		? isPaused
			? "On break — stop this timer"
			: "Stop timer"
		: otherTaskRunning
			? "Another timer is running — stop it first"
			: "Start timer";

	return (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				if (isThisTask) stop();
				else start(projectId, taskId);
			}}
			disabled={isBusy || otherTaskRunning}
			aria-label={title}
			title={title}
			className={`rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${pad} ${
				isThisTask
					? "text-red-600 hover:bg-red-100"
					: "text-emerald-600 hover:bg-emerald-100"
			} ${className}`}
		>
			{isBusy ? (
				<Loader2 className={`${icon} animate-spin`} />
			) : isThisTask ? (
				isPaused ? (
					<Coffee className={icon} />
				) : (
					<Square className={icon} />
				)
			) : (
				<Play className={icon} />
			)}
		</button>
	);
}
