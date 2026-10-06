// web/src/components/time/timer/TimerBar.tsx
//
// The Time page's timer bar (ux.md › The Time Page):
//
//   ● 01:12:44  Fix login bug · Acme Website   For: [Prodigitality Servic… ▾]
//                                                          [❚❚ Pause] [■ Stop]
//   [▶ Start timer]  [+ Add time]               (idle; page controls on the right)
//
// - `full`: the bar above. Below 640 px it is a sticky top card.
// - `pill`: approver mode collapses the bar to one "Start timer" pill, or a
//   compact running pill while a timer runs.
//
// Running state comes from `useActiveTimer`; starting is the caller's
// (`useStartTimer` behind `onStartTimer`), so the page's picker, the For step
// and the Switch prompt stay in one place.

import { Coffee, Loader2, Pause, Play, Plus, Square } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { TimeEntryView } from "@/services/time.types";
import { ForChip } from "../for/ForChip";
import {
	ADD_TIME_LABEL,
	entryWorkLabel,
	ON_BREAK_LABEL,
	PAUSE_LABEL,
	RESUME_LABEL,
	START_TIMER_LABEL,
	STOP_LABEL,
	TIMER_RUNNING_LABEL,
} from "../for/forCopy";
import { forChipOptionFromEntry } from "../for/forOptions";
import { formatBreak, formatClock } from "./liveDuration";
import { type ActiveTimer, useActiveTimer } from "./useActiveTimer";

export interface TimerBarProps {
	variant?: "full" | "pill";
	/** Idle: the "Start timer" button (the caller runs the start flow). */
	onStartTimer?: () => void;
	/** Idle (full only): the "Add time" button. */
	onAddTime?: () => void;
	/** The start flow is busy (picker resolving, starting). */
	starting?: boolean;
	/** Idle (full only): page controls on the right (For filter, List | Month). */
	idleExtra?: ReactNode;
	projectWorkspaceName?: string | null;
	/**
	 * The running chip's ▾: change who the running time is for (a PATCH with
	 * `logging_for`, W1-3's Change For dialog). Without it the chip is
	 * read-only and opens "Who approves this time".
	 */
	onChangeFor?: (entry: TimeEntryView) => void;
	/** Below 640 px the full bar sticks to the top (default on). */
	stickyOnMobile?: boolean;
	className?: string;
	/** Injected for tests and stories; defaults to the shared timer. */
	timer?: ActiveTimer;
}

export function TimerBar(props: TimerBarProps) {
	if (props.timer) return <TimerBarView {...props} timer={props.timer} />;
	return <ConnectedTimerBar {...props} />;
}

function ConnectedTimerBar(props: TimerBarProps) {
	const timer = useActiveTimer();
	return <TimerBarView {...props} timer={timer} />;
}

const BUTTON =
	"inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

function TimerBarView({
	variant = "full",
	onStartTimer,
	onAddTime,
	starting = false,
	idleExtra,
	projectWorkspaceName,
	onChangeFor,
	stickyOnMobile = true,
	className,
	timer,
}: TimerBarProps & { timer: ActiveTimer }) {
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

	const startButton = onStartTimer ? (
		<button
			type="button"
			onClick={onStartTimer}
			disabled={starting}
			className={cn(
				BUTTON,
				"bg-primary text-primary-foreground hover:bg-primary/90",
				variant === "pill" && "rounded-full",
			)}
		>
			{starting ? (
				<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
			) : (
				<Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
			)}
			{START_TIMER_LABEL}
		</button>
	) : null;

	const controls = entry ? (
		<div className="flex shrink-0 items-center gap-2">
			<button
				type="button"
				onClick={toggleBreak}
				disabled={isBusy}
				className={cn(
					BUTTON,
					isPaused
						? "bg-success text-success-foreground hover:bg-success/90"
						: "border border-border text-foreground hover:bg-muted",
				)}
			>
				{isPausing ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
				) : isPaused ? (
					<Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
				) : (
					<Pause className="h-3.5 w-3.5" aria-hidden="true" />
				)}
				{isPaused ? RESUME_LABEL : PAUSE_LABEL}
			</button>
			<button
				type="button"
				onClick={stop}
				disabled={isBusy}
				className={cn(
					BUTTON,
					"bg-destructive text-destructive-foreground hover:bg-destructive/90",
				)}
			>
				{isStopping ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
				) : (
					<Square className="h-3.5 w-3.5" aria-hidden="true" />
				)}
				{STOP_LABEL}
			</button>
		</div>
	) : null;

	const status = isPaused ? ON_BREAK_LABEL : TIMER_RUNNING_LABEL;
	const dot = (
		<span
			aria-hidden="true"
			className={cn(
				"inline-block h-2.5 w-2.5 shrink-0 rounded-full",
				isPaused ? "bg-warning" : "animate-pulse bg-success",
			)}
		/>
	);
	const clock = (
		<span
			className={cn(
				"tabular-nums font-bold",
				variant === "pill" ? "text-sm" : "text-lg",
				isPaused ? "text-muted-foreground" : "text-foreground",
			)}
			title={status}
			data-testid="timer-clock"
		>
			{formatClock(workSeconds)}
		</span>
	);
	const breakBadge =
		entry && (isPaused || breakSeconds > 0) ? (
			<span
				className="inline-flex shrink-0 items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-foreground"
				data-testid="timer-break"
			>
				<Coffee className="h-3 w-3" aria-hidden="true" />
				{isPaused
					? formatBreak(breakSeconds)
					: `${Math.round(breakSeconds / 60)}m`}
			</span>
		) : null;

	// ── Pill (approver mode) ─────────────────────────────────────────────────
	if (variant === "pill") {
		if (!entry) {
			return startButton ? (
				<div className={className} data-variant="pill">
					{startButton}
				</div>
			) : null;
		}
		return (
			<section
				aria-label={status}
				data-variant="pill"
				className={cn(
					"inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-sm",
					className,
				)}
			>
				<span className="sr-only">{status}</span>
				{dot}
				{clock}
				{breakBadge}
				{controls}
			</section>
		);
	}

	// ── Full bar ─────────────────────────────────────────────────────────────
	const sticky = stickyOnMobile ? "max-sm:sticky max-sm:top-0 max-sm:z-30" : "";

	if (!entry) {
		if (!startButton && !onAddTime && !idleExtra) return null;
		return (
			<section
				aria-label={START_TIMER_LABEL}
				data-variant="full"
				className={cn(
					"flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm",
					sticky,
					className,
				)}
			>
				{startButton}
				{onAddTime ? (
					<button
						type="button"
						onClick={onAddTime}
						className={cn(
							BUTTON,
							"border border-border text-foreground hover:bg-muted",
						)}
					>
						<Plus className="h-3.5 w-3.5" aria-hidden="true" />
						{ADD_TIME_LABEL}
					</button>
				) : null}
				{idleExtra ? (
					<div className="ml-auto flex flex-wrap items-center gap-2">
						{idleExtra}
					</div>
				) : null}
			</section>
		);
	}

	const work = entryWorkLabel(entry);
	const project = entry.project?.title?.trim() || "";
	return (
		<section
			aria-label={status}
			data-variant="full"
			className={cn(
				"rounded-2xl border border-border bg-card px-4 py-3 shadow-sm",
				sticky,
				className,
			)}
		>
			<span className="sr-only">{status}</span>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<div className="flex shrink-0 items-center gap-2">
					{dot}
					{clock}
					{breakBadge}
				</div>
				<p className="min-w-0 flex-1 truncate text-sm text-foreground">
					<span className="font-semibold">
						{!entry.task_id ? "◦ " : ""}
						{work}
					</span>
					{project && project !== work ? (
						<span className="text-muted-foreground"> · {project}</span>
					) : null}
				</p>
				<ForChip
					showPrefix
					variant={onChangeFor ? "menu" : "readonly"}
					onOpenMenu={onChangeFor ? () => onChangeFor(entry) : undefined}
					option={forChipOptionFromEntry(entry)}
					projectId={entry.project_id}
					projectWorkspaceName={projectWorkspaceName}
					className="max-sm:order-last max-sm:basis-full"
				/>
				{controls}
			</div>
		</section>
	);
}
