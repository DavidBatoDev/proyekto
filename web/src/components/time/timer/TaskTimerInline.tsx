// web/src/components/time/timer/TaskTimerInline.tsx
//
// The task detail panel's timer: a "Start timer" button with the For chip when
// idle, and the live clock with Pause / Resume and Stop while this task runs.
// Dense rows use `TaskTimerButton` instead. Moved from `components/team-time/`
// (W1-6).
//
// - 0 options (a viewer or commenter): "You can't log time on this project"
//   with a Why? popover (ux.md › For Chip, Personas P10).
// - 1 option: the read-only chip, "Only option on this project"; Start starts
//   at once.
// - 2+ options: Start opens the For picker; the remembered default is
//   preselected but never applied silently (L38).
// - Another task running: Start is not disabled; it asks to Switch.

import { Ban, Coffee, Loader2, Pause, Play, Square } from "lucide-react";
import { useRef, useState } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import { cn } from "@/lib/utils";
import { ForChip } from "../for/ForChip";
import {
	CANT_LOG_TITLE,
	ON_BREAK_LABEL,
	ONLY_OPTION_NOTE,
	PAUSE_LABEL,
	RESUME_LABEL,
	START_TIMER_LABEL,
	STOP_LABEL,
	TIMER_RUNNING_LABEL,
	WHY_LABEL,
	whyNoOptionsText,
} from "../for/forCopy";
import { forChipOptionFromEntry } from "../for/forOptions";
import { formatBreak, formatClock } from "./liveDuration";
import {
	TIMER_PROMPT_Z_INDEX,
	TimerEventBoundary,
	TimerPromptLayer,
	useTaskTimerOptions,
	useTimerPromptEscape,
} from "./TaskTimerButton";
import { type ActiveTimer, useActiveTimer } from "./useActiveTimer";
import { useStartTimer } from "./useStartTimer";

const BUTTON =
	"inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export interface TaskTimerInlineProps {
	projectId: string;
	taskId: string;
	className?: string;
	/** Prompts and popovers; defaults above the roadmap SidePanel. */
	promptZIndex?: number;
	projectWorkspaceName?: string | null;
}

export function TaskTimerInline({
	projectId,
	taskId,
	className,
	promptZIndex = TIMER_PROMPT_Z_INDEX,
	projectWorkspaceName,
}: TaskTimerInlineProps) {
	const timer = useActiveTimer();
	const { result, mode } = useTaskTimerOptions(projectId);
	const flow = useStartTimer();
	const startRef = useRef<HTMLButtonElement | null>(null);

	if (!projectId || !taskId) return null;

	if (timer.entry && timer.runningTaskId === taskId) {
		return (
			<RunningCluster
				timer={timer}
				className={className}
				zIndex={promptZIndex}
				projectWorkspaceName={projectWorkspaceName}
			/>
		);
	}

	// Unknown yet (loading, a failed read, signed out): nothing rather than a
	// button that might not apply.
	if (mode === null && !flow.isOpen) return null;
	if (mode === "none" && !flow.isOpen) {
		return <CantLogNotice className={className} zIndex={promptZIndex} />;
	}

	const only = mode === "single" ? (result?.selected ?? null) : null;
	return (
		<div
			className={cn("inline-flex items-center gap-2", className)}
			data-timer-state="idle"
		>
			{only ? (
				<ForChip
					showPrefix
					option={only}
					note={ONLY_OPTION_NOTE}
					projectId={projectId}
					projectWorkspaceName={projectWorkspaceName}
					personalReason={result?.personal_reason ?? null}
					popoverZIndex={promptZIndex}
				/>
			) : null}
			<button
				ref={startRef}
				type="button"
				onClick={() => void flow.start({ projectId, taskId })}
				disabled={flow.isPending}
				aria-haspopup="dialog"
				aria-expanded={flow.isOpen}
				className={cn(
					BUTTON,
					"border border-success/40 bg-success/10 text-foreground hover:bg-success/20",
				)}
			>
				{flow.isPending ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
				) : (
					<Play
						className="h-3.5 w-3.5 fill-current text-success"
						aria-hidden="true"
					/>
				)}
				{START_TIMER_LABEL}
			</button>
			<TimerPromptLayer
				flow={flow}
				anchorRef={startRef}
				zIndex={promptZIndex}
				projectWorkspaceName={projectWorkspaceName}
			/>
		</div>
	);
}

// ── This task is running ────────────────────────────────────────────────────

function RunningCluster({
	timer,
	className,
	zIndex,
	projectWorkspaceName,
}: {
	timer: ActiveTimer;
	className?: string;
	zIndex: number;
	projectWorkspaceName?: string | null;
}) {
	const {
		entry,
		isPaused,
		workSeconds,
		breakSeconds,
		isBusy,
		isPausing,
		isStopping,
		toggleBreak,
		stop,
	} = timer;
	if (!entry) return null;
	const status = isPaused ? ON_BREAK_LABEL : TIMER_RUNNING_LABEL;
	return (
		<section
			aria-label={status}
			data-timer-state="running"
			className={cn("inline-flex items-center gap-2", className)}
		>
			<span className="inline-flex items-center gap-1.5">
				<span
					aria-hidden="true"
					className={cn(
						"inline-block h-2 w-2 shrink-0 rounded-full",
						isPaused ? "bg-warning" : "animate-pulse bg-success",
					)}
				/>
				<span
					className={cn(
						"tabular-nums text-xs font-bold",
						isPaused ? "text-muted-foreground" : "text-foreground",
					)}
					title={status}
					data-testid="timer-clock"
				>
					{formatClock(workSeconds)}
				</span>
			</span>
			{isPaused || breakSeconds > 0 ? (
				<span
					className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-foreground"
					data-testid="timer-break"
				>
					<Coffee className="h-3 w-3" aria-hidden="true" />
					{isPaused
						? formatBreak(breakSeconds)
						: `${Math.round(breakSeconds / 60)}m`}
				</span>
			) : null}
			<ForChip
				option={forChipOptionFromEntry(entry)}
				projectId={entry.content === "hidden" ? null : entry.project_id}
				projectWorkspaceName={projectWorkspaceName}
				popoverZIndex={zIndex}
			/>
			<button
				type="button"
				onClick={toggleBreak}
				disabled={isBusy}
				className={cn(
					BUTTON,
					"px-2 py-1",
					isPaused
						? "border border-success/50 bg-success/15 text-success-foreground hover:bg-success/25"
						: "border border-border text-foreground hover:bg-muted",
				)}
			>
				{isPausing ? (
					<Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
				) : isPaused ? (
					<Play className="h-3 w-3 fill-current" aria-hidden="true" />
				) : (
					<Pause className="h-3 w-3" aria-hidden="true" />
				)}
				{isPaused ? RESUME_LABEL : PAUSE_LABEL}
			</button>
			<button
				type="button"
				onClick={stop}
				disabled={isBusy}
				className={cn(
					BUTTON,
					"px-2 py-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 dark:text-background",
				)}
			>
				{isStopping ? (
					<Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
				) : (
					<Square className="h-3 w-3" aria-hidden="true" />
				)}
				{STOP_LABEL}
			</button>
		</section>
	);
}

// ── 0 options ───────────────────────────────────────────────────────────────

function CantLogNotice({
	className,
	zIndex,
}: {
	className?: string;
	zIndex: number;
}) {
	const whyRef = useRef<HTMLButtonElement | null>(null);
	const [open, setOpen] = useState(false);
	useTimerPromptEscape(open, () => setOpen(false));
	return (
		<div
			className={cn(
				"inline-flex items-center gap-1.5 text-xs text-muted-foreground",
				className,
			)}
			data-timer-state="blocked"
		>
			<Ban className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
			<span>{CANT_LOG_TITLE}</span>
			<button
				ref={whyRef}
				type="button"
				aria-haspopup="dialog"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
				className="font-semibold text-primary underline-offset-2 hover:underline"
			>
				{WHY_LABEL}
			</button>
			<TimerEventBoundary>
				<AnchoredPopover
					anchorRef={whyRef}
					open={open}
					onClose={() => setOpen(false)}
					width={280}
					maxHeight={200}
					zIndex={zIndex}
					ariaLabel={CANT_LOG_TITLE}
				>
					<p className="p-3 text-xs leading-relaxed text-foreground">
						{whyNoOptionsText("viewer")}
					</p>
				</AnchoredPopover>
			</TimerEventBoundary>
		</div>
	);
}
