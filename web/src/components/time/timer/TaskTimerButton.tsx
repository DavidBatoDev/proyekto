// web/src/components/time/timer/TaskTimerButton.tsx
//
// Start or stop the timer from one task row (canvas rows, task lists, the
// milestones panels). Moved from `components/team-time/` (W1-6).
//
// - Which task is timed comes from the shared running query, so every mount
//   site agrees without anyone threading a `runningTaskId` prop down.
// - A start goes through `useStartTimer`: the For step (0 / 1 / 2+ options),
//   the Switch prompt when another timer runs, and the locked-period Withdraw.
//   Its prompts open as a popover anchored to the button. The button is never
//   disabled because another task is running: the Switch prompt ("Stop Fix
//   login bug (1:12) and start this?") replaces that rule. There are never
//   two timers.
// - A project the person can't log on (0 options, ux.md › For Chip) renders
//   no button at all. Rows of one project share one `logging-for` read.
// - Rows read the running query without polling it (the page polls: see
//   `useRowRunningEntry`). The running row alone mounts `useActiveTimer` (its
//   mutations and its 1 Hz tick), through a bridge that renders nothing, so a
//   canvas of hundreds of tasks does not re-render every second and the button
//   keeps its focus when it flips between Start and Stop.

import { useQuery } from "@tanstack/react-query";
import { Coffee, Loader2, Play, Square } from "lucide-react";
import {
	type ReactNode,
	type RefObject,
	type SyntheticEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";
import { timeQueries } from "@/queries/time";
import type { LoggingForResult } from "@/services/time.types";
import { START_TIMER_LABEL } from "../for/forCopy";
import { type ForMode, forMode } from "../for/forOptions";
import { StartTimerPrompts } from "./SwitchTimerDialog";
import { useActiveTimer, useTimerUserId } from "./useActiveTimer";
import { type StartTimerFlow, useStartTimer } from "./useStartTimer";

/**
 * Stacking order of the timer prompts. A task row can sit in an AppDialog
 * (1200 and up) or in the roadmap SidePanel (up to 10000, see the ladder in
 * `AppDialog.tsx`), and the prompts must open above whichever holds it.
 */
export const TIMER_PROMPT_Z_INDEX = 10100;

export const STOP_TIMER_LABEL = "Stop timer";
export const STOP_TIMER_ON_BREAK_LABEL = "Stop timer (on break)";

// ── Shared by the timer surfaces ────────────────────────────────────────────

export interface TaskTimerOptions {
	/** The project's For options; null until known. */
	result: LoggingForResult | null;
	/** `none` = the person can't log here; null while loading, on error or signed out. */
	mode: ForMode | null;
}

/**
 * The For options of a project, for the timer surfaces. Signed-out callers
 * (guests on a shared roadmap) never ask: every time route answers them 404.
 */
export function useTaskTimerOptions(
	projectId: string | null | undefined,
): TaskTimerOptions {
	const userId = useTimerUserId();
	const query = useQuery({
		...timeQueries.loggingFor(projectId),
		enabled: Boolean(projectId && userId),
	});
	// The key is per project, not per person: never show a cached answer to a
	// signed-out viewer.
	const result = userId ? (query.data ?? null) : null;
	return { result, mode: result ? forMode(result) : null };
}

/**
 * While a timer prompt is open, Escape closes the prompt only. A capture
 * listener on `window` runs before everything else, so the panel or dialog
 * the trigger sits in (the roadmap SidePanel closes on Escape) stays open.
 */
export function useTimerPromptEscape(open: boolean, onEscape: () => void) {
	const onEscapeRef = useRef(onEscape);
	useEffect(() => {
		onEscapeRef.current = onEscape;
	});
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			onEscapeRef.current();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [open]);
}

const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();

/**
 * Keeps events from a portaled popover inside the timer. React bubbles portal
 * events through the component tree, so without this a click on "Switch"
 * would also reach the task row's own click handler (open the task, select
 * the canvas node, start a drag).
 */
export function TimerEventBoundary({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<span
			className={className ?? "contents"}
			onClick={stopPropagation}
			onDoubleClick={stopPropagation}
			onMouseDown={stopPropagation}
			onPointerDown={stopPropagation}
			onKeyDown={stopPropagation}
		>
			{children}
		</span>
	);
}

/** Every prompt of a start flow, anchored to its trigger. */
export function TimerPromptLayer({
	flow,
	anchorRef,
	zIndex = TIMER_PROMPT_Z_INDEX,
	projectWorkspaceName,
}: {
	flow: StartTimerFlow;
	anchorRef: RefObject<HTMLElement | null>;
	zIndex?: number;
	projectWorkspaceName?: string | null;
}) {
	useTimerPromptEscape(flow.isOpen, flow.cancel);
	return (
		<TimerEventBoundary>
			<StartTimerPrompts
				flow={flow}
				anchorRef={anchorRef}
				zIndex={zIndex}
				projectWorkspaceName={projectWorkspaceName}
			/>
		</TimerEventBoundary>
	);
}

// ── The button ──────────────────────────────────────────────────────────────

/**
 * The running entry, for one row. It follows the shared cache (and fetches on
 * mount like any reader) but does not poll: every polling observer runs its
 * own interval, and rows mount at different moments, so a canvas of rows
 * would multiply the 3 s poll. The page polls instead: RoadmapView's
 * `useRunningTaskId`, and the floating timer on every page with task rows.
 */
function useRowRunningEntry() {
	const userId = useTimerUserId();
	const query = useQuery({
		...timeQueries.running(userId),
		refetchInterval: false,
	});
	return userId ? (query.data ?? null) : null;
}

interface RunningControls {
	stop: () => void;
	isBusy: boolean;
}

/**
 * Mounted only while this row's task is the running one: owns the stop
 * mutation (and the tick) without re-rendering the button every second.
 */
function RunningTimerBridge({
	onChange,
}: {
	onChange: (controls: RunningControls | null) => void;
}) {
	const { stop, isBusy } = useActiveTimer();
	useEffect(() => {
		onChange({ stop, isBusy });
	}, [onChange, stop, isBusy]);
	useEffect(() => () => onChange(null), [onChange]);
	return null;
}

export interface TaskTimerButtonProps {
	projectId: string;
	taskId: string;
	/** "sm" for dense rows, "md" for roomier surfaces. */
	size?: "sm" | "md";
	className?: string;
	/** Defaults to {@link TIMER_PROMPT_Z_INDEX}. */
	promptZIndex?: number;
}

export function TaskTimerButton({
	projectId,
	taskId,
	size = "sm",
	className = "",
	promptZIndex,
}: TaskTimerButtonProps) {
	const entry = useRowRunningEntry();
	const { mode } = useTaskTimerOptions(projectId);
	const flow = useStartTimer();
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	const [running, setRunning] = useState<RunningControls | null>(null);

	if (!projectId || !taskId) return null;

	const isThisTask = entry?.task_id === taskId;
	// No option on this project: no button (ux.md › For Chip, 0 options).
	// A timer already running on this task still gets its Stop, and an open
	// prompt (the "can't log" card after a refusal) keeps its anchor.
	if (!isThisTask && !flow.isOpen && (mode === null || mode === "none")) {
		return null;
	}

	const isPaused = isThisTask && Boolean(entry?.paused_at);
	const busy = isThisTask ? Boolean(running?.isBusy) : flow.isPending;
	const label = isThisTask
		? isPaused
			? STOP_TIMER_ON_BREAK_LABEL
			: STOP_TIMER_LABEL
		: START_TIMER_LABEL;
	const icon = "h-4 w-4";
	const pad = size === "md" ? "px-2.5 py-1.5" : "p-1";

	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					if (isThisTask) {
						running?.stop();
						return;
					}
					void flow.start({ projectId, taskId });
				}}
				disabled={busy}
				aria-label={label}
				title={label}
				aria-haspopup={isThisTask ? undefined : "dialog"}
				aria-expanded={isThisTask ? undefined : flow.isOpen}
				data-timer-state={isThisTask ? "running" : "idle"}
				className={cn(
					"rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40",
					pad,
					isThisTask
						? "text-destructive hover:bg-destructive/10"
						: "text-success hover:bg-success/10",
					className,
				)}
			>
				{busy ? (
					<Loader2 className={`${icon} animate-spin`} aria-hidden="true" />
				) : isThisTask ? (
					isPaused ? (
						<Coffee className={icon} aria-hidden="true" />
					) : (
						<Square className={icon} aria-hidden="true" />
					)
				) : (
					<Play className={icon} aria-hidden="true" />
				)}
			</button>
			{isThisTask ? <RunningTimerBridge onChange={setRunning} /> : null}
			<TimerPromptLayer
				flow={flow}
				anchorRef={buttonRef}
				zIndex={promptZIndex}
			/>
		</>
	);
}
