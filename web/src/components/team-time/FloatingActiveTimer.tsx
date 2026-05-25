import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
	ChevronDown,
	ChevronUp,
	ExternalLink,
	Loader2,
	Square,
	Timer,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import { teamTimeService } from "@/services/team-time.service";
import { useUser } from "@/stores/authStore";
import { liveDurationSecondsFromLog, useLiveNowMs } from "./time-utils";

const TIMER_VISIBLE_PATH_PREFIXES = [
	"/dashboard",
	"/inbox",
	"/work-items",
	"/teams",
	"/project",
	"/projects",
];

const TIMER_POSITION_STORAGE_KEY = "floating-timer-position";
const TIMER_COLLAPSED_STORAGE_KEY = "floating-timer-collapsed";
const TIMER_DRAG_MARGIN = 12;

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

function workTypeLabel(value: "real_work" | "training"): string {
	return value === "training" ? "Training" : "Work";
}

export function FloatingActiveTimer() {
	const user = useUser();
	const toast = useToast();
	const queryClient = useQueryClient();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const shouldRender = shouldShowOnPath(pathname);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const dragStateRef = useRef({
		isDragging: false,
		offsetX: 0,
		offsetY: 0,
	});
	const [position, setPosition] = useState<{ x: number; y: number } | null>(
		null,
	);
	const [isCollapsed, setIsCollapsed] = useState(false);

	const runningQuery = useQuery({
		queryKey: ["team-time", "running-log", user?.id ?? "anonymous"] as const,
		queryFn: () => teamTimeService.getMyRunningLog(),
		enabled: Boolean(user?.id) && shouldRender,
		refetchInterval: 3_000,
		refetchIntervalInBackground: true,
		retry: 1,
	});

	const stopMutation = useMutation({
		mutationFn: (logId: string) => teamTimeService.stopLog(logId),
		onSuccess: () => {
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
		},
	});

	const log = runningQuery.data ?? null;
	const isRunning = Boolean(log);
	const nowMs = useLiveNowMs(isRunning);
	const elapsedSeconds = useMemo(
		() => (log ? liveDurationSecondsFromLog(log, nowMs) : 0),
		[log, nowMs],
	);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const storedPosition = window.localStorage.getItem(
			TIMER_POSITION_STORAGE_KEY,
		);
		if (storedPosition) {
			try {
				const parsed = JSON.parse(storedPosition) as {
					x: number;
					y: number;
				};
				if (
					Number.isFinite(parsed?.x) &&
					Number.isFinite(parsed?.y)
				) {
					setPosition({ x: parsed.x, y: parsed.y });
				}
			} catch {
				// Ignore invalid stored value.
			}
		}
		const storedCollapsed = window.localStorage.getItem(
			TIMER_COLLAPSED_STORAGE_KEY,
		);
		if (storedCollapsed) {
			setIsCollapsed(storedCollapsed === "true");
		}
	}, []);

	useEffect(() => {
		if (typeof window === "undefined" || !position) return;
		window.localStorage.setItem(
			TIMER_POSITION_STORAGE_KEY,
			JSON.stringify(position),
		);
	}, [position]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(
			TIMER_COLLAPSED_STORAGE_KEY,
			String(isCollapsed),
		);
	}, [isCollapsed]);

	const handlePointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest("[data-no-drag]")) return;
			const rect = containerRef.current?.getBoundingClientRect();
			if (!rect) return;
			dragStateRef.current = {
				isDragging: true,
				offsetX: event.clientX - rect.left,
				offsetY: event.clientY - rect.top,
			};
			containerRef.current?.setPointerCapture(event.pointerId);
		},
		[],
	);

	const handlePointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!dragStateRef.current.isDragging) return;
			const rect = containerRef.current?.getBoundingClientRect();
			if (!rect) return;
			const width = rect.width;
			const height = rect.height;
			const maxX = Math.max(TIMER_DRAG_MARGIN, window.innerWidth - width - TIMER_DRAG_MARGIN);
			const maxY = Math.max(TIMER_DRAG_MARGIN, window.innerHeight - height - TIMER_DRAG_MARGIN);
			const nextX = event.clientX - dragStateRef.current.offsetX;
			const nextY = event.clientY - dragStateRef.current.offsetY;
			const clampedX = Math.min(Math.max(nextX, TIMER_DRAG_MARGIN), maxX);
			const clampedY = Math.min(Math.max(nextY, TIMER_DRAG_MARGIN), maxY);
			setPosition({ x: clampedX, y: clampedY });
		},
		[],
	);

	const handlePointerUp = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!dragStateRef.current.isDragging) return;
			dragStateRef.current.isDragging = false;
			containerRef.current?.releasePointerCapture(event.pointerId);
		},
		[],
	);

	if (!user?.id || !shouldRender || !log) return null;

	const containerStyle = position
		? { left: position.x, top: position.y }
		: undefined;

	return (
		<div className="pointer-events-none fixed inset-0 z-[80]">
			<div
				ref={containerRef}
				style={containerStyle}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				className={`pointer-events-auto flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-xl shadow-slate-900/10 ${
					position ? "" : "absolute bottom-4 right-4"
				} cursor-grab select-none active:cursor-grabbing`}
			>
				<div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
					<Timer className="h-4 w-4" />
				</div>
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
						<p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
							Timer running
						</p>
					</div>
					<p className="tabular-nums text-sm font-bold text-slate-900">
						{formatTimer(elapsedSeconds)}
					</p>
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
				<div className="flex items-center gap-2" data-no-drag>
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
					{!isCollapsed && log.task_id ? (
						<Link
							to="/project/$projectId/roadmap"
							params={{ projectId: log.project_id }}
							search={{ taskId: log.task_id } as never}
							className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
						>
							<ExternalLink className="h-3.5 w-3.5" />
							Roadmap
						</Link>
					) : null}
					<button
						type="button"
						onClick={() => stopMutation.mutate(log.id)}
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
