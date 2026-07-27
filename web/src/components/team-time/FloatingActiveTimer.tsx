import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
	ChevronDown,
	ChevronUp,
	ExternalLink,
	Loader2,
	Pause,
	Play,
	Square,
	Timer,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import { teamTimeService } from "@/services/team-time.service";
import { useUser } from "@/stores/authStore";
import { useRoadmapStore } from "@/stores/roadmapStore";
import {
	confirmStopLongTimer,
	liveDurationSecondsFromLog,
	useLiveNowMs,
} from "./time-utils";

const TIMER_VISIBLE_PATH_PREFIXES = [
	"/dashboard",
	"/inbox",
	"/command-center",
	"/teams",
	"/project",
	"/projects",
];

const TIMER_ANCHOR_STORAGE_KEY = "floating-timer-anchor";
const TIMER_COLLAPSED_STORAGE_KEY = "floating-timer-collapsed";
const TIMER_ANCHORS = [
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right",
] as const;
type TimerAnchor = (typeof TIMER_ANCHORS)[number];

function shouldShowOnPath(pathname: string): boolean {
	return TIMER_VISIBLE_PATH_PREFIXES.some((prefix) =>
		pathname.startsWith(prefix),
	);
}

function formatTimer(totalSeconds: number): string {
	const safe = Math.max(0, Math.floor(totalSeconds));
	const hours = Math.floor(safe / 3600)
		.toString()
		.padStart(2, "0");
	const minutes = Math.floor((safe % 3600) / 60)
		.toString()
		.padStart(2, "0");
	const seconds = (safe % 60).toString().padStart(2, "0");
	return `${hours}:${minutes}:${seconds}`;
}

function formatCountdown(seconds: number): string {
	const safe = Math.max(0, Math.floor(seconds));
	const mins = Math.floor(safe / 60)
		.toString()
		.padStart(2, "0");
	const secs = (safe % 60).toString().padStart(2, "0");
	return `${mins}:${secs}`;
}

function workTypeLabel(value: "real_work" | "training"): string {
	return value === "training" ? "Training" : "Work";
}

export function FloatingActiveTimer() {
	const user = useUser();
	const toast = useToast();
	const queryClient = useQueryClient();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const shouldRender = shouldShowOnPath(pathname);
	const [anchor, setAnchor] = useState<TimerAnchor>("bottom-right");
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [breakMinutesInput, setBreakMinutesInput] = useState<number>(0);

	// Pause / Resume Dial State
	const [pauseStartMs, setPauseStartMs] = useState<number | null>(null);

	const runningQuery = useQuery({
		queryKey: ["team-time", "running-log", user?.id ?? "anonymous"] as const,
		queryFn: () => teamTimeService.getMyRunningLog(),
		enabled: Boolean(user?.id) && shouldRender,
		refetchInterval: (query) => (query.state.data ? 3_000 : 30_000),
		refetchIntervalInBackground: false,
		retry: 1,
	});

	const stopMutation = useMutation({
		mutationFn: ({
			logId,
			breakMinutes,
		}: {
			logId: string;
			breakMinutes?: number;
		}) => teamTimeService.stopLog(logId, undefined, breakMinutes),
		onMutate: async () => {
			if (!user?.id) return;
			await queryClient.cancelQueries({
				queryKey: ["team-time", "running-log", user.id] as const,
			});
			queryClient.setQueryData(
				["team-time", "running-log", user.id] as const,
				null,
			);
		},
		onSuccess: () => {
			if (log?.id) {
				localStorage.removeItem(`active_timer_break_${log.id}`);
				localStorage.removeItem(`active_timer_pause_${log.id}`);
			}
			setBreakMinutesInput(0);
			setPauseStartMs(null);
			if (user?.id) {
				queryClient.setQueryData(
					["team-time", "running-log", user.id] as const,
					null,
				);
			}
			void queryClient.invalidateQueries({ queryKey: ["team-time"] });
			toast.success("Timer stopped.");
		},
		onError: (error) => {
			const message =
				error instanceof Error ? error.message : "Failed to stop timer";
			toast.error(message);
			void queryClient.invalidateQueries({ queryKey: ["team-time"] });
		},
	});

	const log = runningQuery.data ?? null;
	const isRunning = Boolean(log);
	const nowMs = useLiveNowMs(isRunning);

	// Calculate elapsed pause seconds when paused
	const pauseElapsedSeconds = useMemo(() => {
		if (!pauseStartMs) return 0;
		return Math.max(0, Math.floor((nowMs - pauseStartMs) / 1000));
	}, [pauseStartMs, nowMs]);

	// Sync & Restore live break state from localStorage or log object across browser refreshes
	useEffect(() => {
		if (!log?.id) {
			setBreakMinutesInput(0);
			setPauseStartMs(null);
			return;
		}
		const storedBreakMins = localStorage.getItem(`active_timer_break_${log.id}`);
		if (storedBreakMins !== null) {
			setBreakMinutesInput(Number(storedBreakMins));
		} else {
			setBreakMinutesInput(log.break_minutes ?? 0);
		}

		const storedPauseMs = localStorage.getItem(`active_timer_pause_${log.id}`);
		if (storedPauseMs) {
			setPauseStartMs(Number(storedPauseMs));
		}
	}, [log?.id, log?.break_minutes]);

	// Save break input to localStorage whenever updated
	useEffect(() => {
		if (!log?.id) return;
		localStorage.setItem(`active_timer_break_${log.id}`, String(breakMinutesInput));
	}, [log?.id, breakMinutesInput]);

	// Save pause state to localStorage whenever updated
	useEffect(() => {
		if (!log?.id) return;
		if (pauseStartMs) {
			localStorage.setItem(`active_timer_pause_${log.id}`, String(pauseStartMs));
		} else {
			localStorage.removeItem(`active_timer_pause_${log.id}`);
		}
	}, [log?.id, pauseStartMs]);

	const elapsedSeconds = useMemo(
		() => (log ? liveDurationSecondsFromLog(log, nowMs) : 0),
		[log, nowMs],
	);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const storedAnchor = window.localStorage.getItem(TIMER_ANCHOR_STORAGE_KEY);
		if (storedAnchor && TIMER_ANCHORS.includes(storedAnchor as TimerAnchor)) {
			setAnchor(storedAnchor as TimerAnchor);
		}
		const storedCollapsed = window.localStorage.getItem(
			TIMER_COLLAPSED_STORAGE_KEY,
		);
		if (storedCollapsed) {
			setIsCollapsed(storedCollapsed === "true");
		}
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(TIMER_ANCHOR_STORAGE_KEY, anchor);
	}, [anchor]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(
			TIMER_COLLAPSED_STORAGE_KEY,
			String(isCollapsed),
		);
	}, [isCollapsed]);

	if (!user?.id || !shouldRender || !log) return null;

	const anchorClass =
		anchor === "top-left"
			? "absolute top-4 left-4"
			: anchor === "top-right"
				? "absolute top-4 right-4"
				: anchor === "bottom-left"
					? "absolute bottom-4 left-4"
					: "absolute bottom-4 right-4";

	const handleTogglePause = () => {
		if (!pauseStartMs) {
			// Start Pausing / Break
			const now = Date.now();
			setPauseStartMs(now);
			if (log?.id) {
				localStorage.setItem(`active_timer_pause_${log.id}`, String(now));
			}
			toast.success("⏸ Timer Paused. Click Resume when back!");
		} else {
			// Resume Work Timer
			const elapsedMs = Date.now() - pauseStartMs;
			const addedMins = Math.floor(elapsedMs / 60000);
			setPauseStartMs(null);
			if (log?.id) {
				localStorage.removeItem(`active_timer_pause_${log.id}`);
			}
			if (addedMins > 0) {
				const newTotal = breakMinutesInput + addedMins;
				setBreakMinutesInput(newTotal);
				if (log?.id) {
					teamTimeService.updateLog(log.id, { break_minutes: newTotal }).catch(() => {});
				}
				toast.success(`▶ Timer Resumed! Logged ${addedMins}m break time.`);
			} else {
				toast.success("▶ Timer Resumed!");
			}
		}
	};

	return (
		<div className="pointer-events-none fixed inset-0 z-80">
			<div
				className={`pointer-events-auto flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-xl shadow-slate-900/10 ${anchorClass}`}
			>
				<div className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${pauseStartMs ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
					{pauseStartMs ? <Pause className="h-4 w-4 text-amber-600 animate-pulse" /> : <Timer className="h-4 w-4" />}
				</div>
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className={`inline-block h-2 w-2 rounded-full ${pauseStartMs ? "bg-amber-500 animate-ping" : "bg-emerald-500 animate-pulse"}`} />
						<p className={`text-[11px] font-semibold uppercase tracking-wide ${pauseStartMs ? "text-amber-700 font-bold" : "text-emerald-700"}`}>
							{pauseStartMs ? "⏸ Paused (On Break)" : "Timer running"}
						</p>
					</div>
					<div className="flex items-baseline gap-2">
						<p className="tabular-nums text-sm font-bold text-slate-900">
							{formatTimer(elapsedSeconds)}
						</p>
						{pauseStartMs ? (
							<span className="inline-flex items-center gap-1 rounded bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-900 animate-pulse">
								<Pause className="h-3 w-3" />
								Paused: {formatCountdown(pauseElapsedSeconds)}
							</span>
						) : breakMinutesInput > 0 ? (
							<span className="inline-flex items-center gap-1 rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700" title="Break logged to session">
								✓ {breakMinutesInput}m break logged
							</span>
						) : null}
					</div>
					{!isCollapsed ? (
						<>
							<p className="max-w-[220px] truncate text-xs text-slate-600">
								{log.task?.title?.trim() || "General Time / No Task"}
							</p>
							<p className="max-w-[220px] truncate text-[11px] text-slate-500">
								{log.project?.title?.trim() || "Untitled project"} |{" "}
								{workTypeLabel(log.work_type_snapshot)}
							</p>
						</>
					) : null}
				</div>
				<div className="relative flex items-center gap-2" data-no-drag>
					<div
						className={`grid grid-cols-2 gap-1 transition duration-300 ease-out ${
							isCollapsed
								? "pointer-events-none -translate-y-1 scale-95 opacity-0"
								: "translate-y-0 scale-100 opacity-100"
						}`}
						role="group"
						aria-label="Timer position"
					>
						{TIMER_ANCHORS.map((option) => (
							<button
								key={option}
								type="button"
								onClick={() => setAnchor(option)}
								className={`h-4 w-4 rounded border transition-colors ${
									anchor === option
										? "border-emerald-500 bg-emerald-200"
										: "border-slate-300 bg-white hover:bg-slate-50"
								}`}
								title={option.replace("-", " ")}
								aria-pressed={anchor === option}
								aria-label={option.replace("-", " ")}
							/>
						))}
					</div>
					<button
						type="button"
						onClick={() => setIsCollapsed((prev) => !prev)}
						className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
						aria-label={isCollapsed ? "Expand timer" : "Collapse timer"}
					>
						{isCollapsed ? (
							<ChevronUp className="h-4 w-4" />
						) : (
							<ChevronDown className="h-4 w-4" />
						)}
					</button>

					{!isCollapsed && log.team_id ? (
						<Link
							to="/teams/$teamId/time/my-logs"
							params={{ teamId: log.team_id }}
							className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
						>
							My Logs
						</Link>
					) : null}
					{!isCollapsed ? (
						log.task_id ? (
							<Link
								to="/project/$projectId/roadmap"
								params={{ projectId: log.project_id }}
								search={
									{
										nodeId: log.task_id,
										view: "roadmapView",
									} as never
								}
								onClick={() => {
									if (log.task_id)
										useRoadmapStore.getState().openTaskDetail(log.task_id);
								}}
								className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
							>
								<ExternalLink className="h-3.5 w-3.5" />
								Roadmap
							</Link>
						) : (
							<Link
								to="/project/$projectId/roadmap"
								params={{ projectId: log.project_id }}
								className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
								title="No task linked yet. Open roadmap."
							>
								<ExternalLink className="h-3.5 w-3.5" />
								Roadmap
							</Link>
						)
					) : null}
					<button
						type="button"
						onClick={handleTogglePause}
						className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-all ${
							pauseStartMs
								? "border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-700 shadow-md animate-pulse"
								: "border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200"
						}`}
						title={pauseStartMs ? "Resume work timer" : "Pause work timer (Go on break)"}
					>
						{pauseStartMs ? (
							<>
								<Play className="h-3.5 w-3.5 fill-current" />
								Resume
							</>
						) : (
							<>
								<Pause className="h-3.5 w-3.5 fill-current" />
								Pause
							</>
						)}
					</button>
					<button
						type="button"
						onClick={() => {
							if (!confirmStopLongTimer(elapsedSeconds)) return;
							stopMutation.mutate({
								logId: log.id,
								breakMinutes: breakMinutesInput,
							});
						}}
						disabled={stopMutation.isPending}
						className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
					>
						{stopMutation.isPending ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Square className="h-3.5 w-3.5" />
						)}
						Stop
					</button>
				</div>
			</div>
		</div>
	);
}
