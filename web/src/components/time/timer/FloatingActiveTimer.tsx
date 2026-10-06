// web/src/components/time/timer/FloatingActiveTimer.tsx
//
// The floating timer card shown while a timer runs, on the pages listed in
// `TIMER_VISIBLE_PATH_PREFIXES` (ux.md › Chrome). Moved from
// `components/team-time/` (W1-6).
//
// - The list is an allowlist, matched by whole path segments after
//   `stripWorkspacePrefix`, so `/w/acme/dashboard` matches `/dashboard`.
// - `/time` is never on it: that page has its own timer bar. `/work-items`
//   only redirects. Timeline pages keep the card through `/project` (E80).
// - "Open in Time" links to `/time?entry=<id>` for every context (it was a
//   team-only "My Logs" link).
// - Pause, resume and stop go through `useActiveTimer`, the same optimistic
//   path as the timer bar and the task rows.

import { Link, useRouterState } from "@tanstack/react-router";
import {
	ChevronDown,
	ChevronUp,
	Clock,
	Coffee,
	ExternalLink,
	Loader2,
	Pause,
	Play,
	Square,
	Timer,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { stripWorkspacePrefix } from "@/lib/workspacePaths";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { ForChip } from "../for/ForChip";
import {
	entryWorkLabel,
	ON_BREAK_LABEL,
	PAUSE_LABEL,
	RESUME_LABEL,
	STOP_LABEL,
	TIMER_RUNNING_LABEL,
} from "../for/forCopy";
import { forChipOptionFromEntry } from "../for/forOptions";
import { formatBreak, formatClock } from "./liveDuration";
import { useActiveTimer } from "./useActiveTimer";

/**
 * Where the card shows (after `stripWorkspacePrefix`). Never add `/time`
 * (the page has its own bar) or `/work-items` (it only redirects).
 */
export const TIMER_VISIBLE_PATH_PREFIXES = [
	"/dashboard",
	"/inbox",
	"/command-center",
	"/meetings",
	"/task-board",
	"/notifications",
	"/teams",
	"/project",
	"/projects",
] as const;

export const OPEN_IN_TIME_LABEL = "Open in Time";
export const ROADMAP_LINK_LABEL = "Roadmap";

/** True when the floating timer belongs on this page. */
export function shouldShowOnPath(pathname: string): boolean {
	const path = stripWorkspacePrefix(pathname || "/").replace(/[?#].*$/, "");
	return TIMER_VISIBLE_PATH_PREFIXES.some(
		(prefix) => path === prefix || path.startsWith(`${prefix}/`),
	);
}

export const TIMER_ANCHOR_STORAGE_KEY = "floating-timer-anchor";
export const TIMER_COLLAPSED_STORAGE_KEY = "floating-timer-collapsed";
const TIMER_ANCHORS = [
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right",
] as const;
type TimerAnchor = (typeof TIMER_ANCHORS)[number];

const ANCHOR_CLASS: Record<TimerAnchor, string> = {
	"top-left": "absolute top-4 left-4",
	"top-right": "absolute top-4 right-4",
	"bottom-left": "absolute bottom-4 left-4",
	"bottom-right": "absolute bottom-4 right-4",
};

// Storage can be missing or throw (private windows, blocked site data): the
// card then starts bottom-right and expanded, and the choice lasts the visit.
function readStorage(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: string): void {
	try {
		window.localStorage.setItem(key, value);
	} catch {
		// Not persisted; nothing else to do.
	}
}

function readAnchor(): TimerAnchor {
	const stored = readStorage(TIMER_ANCHOR_STORAGE_KEY);
	return stored && (TIMER_ANCHORS as readonly string[]).includes(stored)
		? (stored as TimerAnchor)
		: "bottom-right";
}

const LINK_CLASS =
	"inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted";
const BUTTON =
	"inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export function FloatingActiveTimer() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	// The card (and its 1 Hz tick) mounts only on the pages that show it.
	if (!shouldShowOnPath(pathname)) return null;
	return <FloatingTimerCard />;
}

function FloatingTimerCard() {
	const [anchor, setAnchor] = useState<TimerAnchor>(readAnchor);
	const [isCollapsed, setIsCollapsed] = useState(
		() => readStorage(TIMER_COLLAPSED_STORAGE_KEY) === "true",
	);
	const {
		entry,
		isPaused,
		workSeconds,
		breakSeconds,
		toggleBreak,
		stop,
		isBusy,
		isPausing,
		isStopping,
	} = useActiveTimer();

	useEffect(() => {
		writeStorage(TIMER_ANCHOR_STORAGE_KEY, anchor);
	}, [anchor]);

	useEffect(() => {
		writeStorage(TIMER_COLLAPSED_STORAGE_KEY, String(isCollapsed));
	}, [isCollapsed]);

	if (!entry) return null;

	const status = isPaused ? ON_BREAK_LABEL : TIMER_RUNNING_LABEL;
	const hidden = entry.content === "hidden";
	const work = entryWorkLabel(entry);
	const project = hidden
		? ""
		: entry.project?.title?.trim() || entry.content_label?.trim() || "";
	const projectId = hidden ? null : entry.project_id;

	return (
		<div className="pointer-events-none fixed inset-0 z-80">
			<section
				aria-label={status}
				data-anchor={anchor}
				className={cn(
					"pointer-events-auto flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2 text-card-foreground shadow-xl",
					ANCHOR_CLASS[anchor],
				)}
			>
				<div
					className={cn(
						"inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
						isPaused
							? "bg-warning/15 text-warning"
							: "bg-success/15 text-success",
					)}
				>
					{isPaused ? (
						<Coffee className="h-4 w-4 animate-pulse" aria-hidden="true" />
					) : (
						<Timer className="h-4 w-4" aria-hidden="true" />
					)}
				</div>
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span
							aria-hidden="true"
							className={cn(
								"inline-block h-2 w-2 rounded-full",
								isPaused
									? "animate-ping bg-warning"
									: "animate-pulse bg-success",
							)}
						/>
						<p
							className={cn(
								"text-[11px] font-semibold uppercase tracking-wide",
								isPaused ? "text-warning" : "text-success",
							)}
						>
							{status}
						</p>
					</div>
					<div className="flex items-baseline gap-2">
						<p
							className={cn(
								"tabular-nums text-sm font-bold",
								isPaused ? "text-muted-foreground" : "text-foreground",
							)}
							data-testid="timer-clock"
						>
							{formatClock(workSeconds)}
						</p>
						{isPaused ? (
							<span
								className="inline-flex animate-pulse items-center gap-1 rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold text-foreground"
								data-testid="timer-break"
							>
								<Coffee className="h-3 w-3" aria-hidden="true" />
								{formatBreak(breakSeconds)}
							</span>
						) : breakSeconds > 0 ? (
							<span
								className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
								data-testid="timer-break"
							>
								<Coffee className="h-3 w-3" aria-hidden="true" />
								{Math.round(breakSeconds / 60)}m
							</span>
						) : null}
					</div>
					{!isCollapsed ? (
						<>
							<p
								className="max-w-[220px] truncate text-xs text-foreground"
								title={work}
							>
								{!entry.task_id && !hidden ? "◦ " : ""}
								{work}
							</p>
							<div className="mt-0.5 flex max-w-[260px] items-center gap-1.5">
								{project && project !== work ? (
									<span
										className="min-w-0 truncate text-[11px] text-muted-foreground"
										title={project}
									>
										{project}
									</span>
								) : null}
								<ForChip
									option={forChipOptionFromEntry(entry)}
									projectId={projectId}
									className="shrink-0"
								/>
							</div>
						</>
					) : null}
				</div>
				<div
					className="relative flex flex-wrap items-center gap-2"
					data-no-drag
				>
					{/* Collapsed, the corner picker leaves the tab order too. */}
					{!isCollapsed ? (
						<div
							className="grid grid-cols-2 gap-1"
							role="group"
							aria-label="Timer position"
						>
							{TIMER_ANCHORS.map((option) => (
								<button
									key={option}
									type="button"
									onClick={() => setAnchor(option)}
									className={cn(
										"h-4 w-4 rounded border transition-colors",
										anchor === option
											? "border-primary bg-primary/20"
											: "border-border bg-card hover:bg-muted",
									)}
									title={option.replace("-", " ")}
									aria-pressed={anchor === option}
									aria-label={option.replace("-", " ")}
								/>
							))}
						</div>
					) : null}
					<button
						type="button"
						onClick={() => setIsCollapsed((prev) => !prev)}
						className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
						aria-label={isCollapsed ? "Expand timer" : "Collapse timer"}
						aria-expanded={!isCollapsed}
					>
						{isCollapsed ? (
							<ChevronUp className="h-4 w-4" aria-hidden="true" />
						) : (
							<ChevronDown className="h-4 w-4" aria-hidden="true" />
						)}
					</button>

					{!isCollapsed ? (
						<Link
							to="/time"
							search={{ entry: entry.id }}
							className={LINK_CLASS}
						>
							<Clock className="h-3.5 w-3.5" aria-hidden="true" />
							{OPEN_IN_TIME_LABEL}
						</Link>
					) : null}
					{!isCollapsed && projectId ? (
						<RoadmapLink projectId={projectId} taskId={entry.task_id} />
					) : null}
					<button
						type="button"
						onClick={toggleBreak}
						disabled={isBusy}
						className={cn(
							BUTTON,
							isPaused
								? "border border-success/50 bg-success/15 text-success-foreground shadow-md hover:bg-success/25"
								: "border border-warning/50 bg-warning/15 text-foreground hover:bg-warning/25",
						)}
					>
						{isPausing ? (
							<Loader2
								className="h-3.5 w-3.5 animate-spin"
								aria-hidden="true"
							/>
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
							// White on dark mode's lighter `destructive` reads under 3:1.
							"bg-destructive text-destructive-foreground hover:bg-destructive/90 dark:text-background",
						)}
					>
						{isStopping ? (
							<Loader2
								className="h-3.5 w-3.5 animate-spin"
								aria-hidden="true"
							/>
						) : (
							<Square className="h-3.5 w-3.5" aria-hidden="true" />
						)}
						{STOP_LABEL}
					</button>
				</div>
			</section>
		</div>
	);
}

/** The task on its roadmap (or the roadmap, for preset time). */
function RoadmapLink({
	projectId,
	taskId,
}: {
	projectId: string;
	taskId: string | null;
}) {
	if (taskId) {
		return (
			<Link
				to="/project/$projectId/roadmap"
				params={{ projectId }}
				search={{ nodeId: taskId, view: "roadmapView" } as never}
				onClick={() => useRoadmapStore.getState().openTaskDetail(taskId)}
				className={LINK_CLASS}
			>
				<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
				{ROADMAP_LINK_LABEL}
			</Link>
		);
	}
	return (
		<Link
			to="/project/$projectId/roadmap"
			params={{ projectId }}
			className={LINK_CLASS}
			title="No task on this time. Open the roadmap."
		>
			<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
			{ROADMAP_LINK_LABEL}
		</Link>
	);
}
