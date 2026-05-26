import { createPortal } from "react-dom";
import {
	memo,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import {
	ChevronLeft,
	ChevronRight,
	ExternalLink,
	Loader2,
	MoreHorizontal,
	Pencil,
	Plus,
	Square,
	Timer,
	Trash2,
} from "lucide-react";
import { format, isSameDay } from "date-fns";
import type { TaskTimeLog } from "@/services/team-time.service";
import { liveDurationSecondsFromLog, useLiveNowMs } from "./time-utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ViewMode = "today" | "week" | "month";

interface HoursBreakdown {
	tracked: number;
	manual: number;
}

interface TaskRow {
	key: string;
	projectId: string;
	taskId: string | null;
	taskTitle: string;
	hoursByDay: Record<string, HoursBreakdown>;
	totalHours: number;
	logsInPeriod: TaskTimeLog[];
}

interface ProjectGroup {
	projectId: string;
	projectTitle: string;
	tasks: TaskRow[];
}

// ─── Formatters ──────────────────────────────────────────────────────────────

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
});

function fmtHours(h: number): string {
	const hrs = Math.floor(h);
	const mins = Math.round((h - hrs) * 60);
	return mins > 0
		? `${hrs}:${String(mins).padStart(2, "0")} h`
		: `${hrs}:00 h`;
}

function statusBadgeClass(status: string) {
	if (status === "approved") return "bg-emerald-100 text-emerald-700";
	if (status === "rejected") return "bg-rose-100 text-rose-700";
	if (status === "paid") return "bg-violet-100 text-violet-700";
	return "bg-amber-100 text-amber-700";
}

// ─── Build grid data ─────────────────────────────────────────────────────────

function buildGridData(
	logs: TaskTimeLog[],
	dates: Date[],
	nowMs: number,
): { projectGroups: ProjectGroup[]; dailyTotals: Record<string, number>; maxCellHours: number } {
	const rowMap = new Map<
		string,
		{
			projectId: string;
			projectTitle: string;
			taskId: string | null;
			taskTitle: string;
			hoursByDay: Record<string, HoursBreakdown>;
			logsInPeriod: TaskTimeLog[];
		}
	>();
	const dailyTotals: Record<string, number> = {};

	for (const log of logs) {
		const d = new Date(log.started_at);
		if (Number.isNaN(d.getTime())) continue;
		const key = `${log.project_id}::${log.task_id ?? "__null__"}`;
		if (!rowMap.has(key)) {
			rowMap.set(key, {
				projectId: log.project_id,
				projectTitle: log.project?.title || log.project_id,
				taskId: log.task_id,
				taskTitle: log.task?.title || "—",
				hoursByDay: {},
				logsInPeriod: [],
			});
		}
		const row = rowMap.get(key)!;
		row.logsInPeriod.push(log);

		const dayKey = format(d, "yyyy-MM-dd");
		if (!row.hoursByDay[dayKey]) {
			row.hoursByDay[dayKey] = { tracked: 0, manual: 0 };
		}
		const hours = liveDurationSecondsFromLog(log, nowMs) / 3600;
		if (log.source === "manual") {
			row.hoursByDay[dayKey].manual += hours;
		} else {
			row.hoursByDay[dayKey].tracked += hours;
		}
		dailyTotals[dayKey] = (dailyTotals[dayKey] ?? 0) + hours;
	}

	// Compute max cell value for bar scaling
	let maxCellHours = 0;
	for (const row of rowMap.values()) {
		for (const day of Object.values(row.hoursByDay)) {
			const total = day.tracked + day.manual;
			if (total > maxCellHours) maxCellHours = total;
		}
	}
	// Minimum scale: avoid division by zero; don't exaggerate small values
	maxCellHours = Math.max(maxCellHours, 1);

	// Group by project, sort tasks alphabetically
	const projectMap = new Map<string, ProjectGroup>();
	for (const [key, row] of rowMap) {
		if (!projectMap.has(row.projectId)) {
			projectMap.set(row.projectId, {
				projectId: row.projectId,
				projectTitle: row.projectTitle,
				tasks: [],
			});
		}
		const group = projectMap.get(row.projectId)!;
		const totalHours = Object.values(row.hoursByDay).reduce(
			(s, d) => s + d.tracked + d.manual,
			0,
		);
		group.tasks.push({ key, ...row, totalHours });
	}

	for (const group of projectMap.values()) {
		group.tasks.sort((a, b) => a.taskTitle.localeCompare(b.taskTitle));
	}

	return {
		projectGroups: Array.from(projectMap.values()),
		dailyTotals,
		maxCellHours,
	};
}

// ─── Hours bar ───────────────────────────────────────────────────────────────

function HoursBar({
	hours,
	maxHours,
	isMonth,
}: { hours: HoursBreakdown; maxHours: number; isMonth: boolean }) {
	const total = hours.tracked + hours.manual;
	if (total === 0) return null;
	const fraction = Math.min(total / maxHours, 1);
	const trackedFraction = total > 0 ? hours.tracked / total : 1;

	if (isMonth) {
		return (
			<div className="mx-auto h-1 w-full overflow-hidden rounded-full bg-slate-100">
				<div
					className="h-full rounded-full bg-slate-500"
					style={{ width: `${fraction * 100}%` }}
				/>
			</div>
		);
	}

	return (
		<div>
			<div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
				<div
					className="h-full rounded-full"
					style={{
						width: `${fraction * 100}%`,
						background:
							hours.manual === 0
								? "#3b82f6"
								: hours.tracked === 0
									? "#f59e0b"
									: `linear-gradient(to right, #3b82f6 ${trackedFraction * 100}%, #f59e0b ${trackedFraction * 100}%)`,
					}}
				/>
			</div>
			<div className="text-center text-[10px] tabular-nums text-slate-400">
				{fmtHours(total)}
			</div>
		</div>
	);
}

// ─── Action menu ─────────────────────────────────────────────────────────────

type MenuTone = "default" | "danger";
type MenuItem = {
	id: string;
	label: string;
	icon: ReactNode;
	onSelect: () => void;
	disabled?: boolean;
	tone?: MenuTone;
};

function ActionsMenu({
	rowId,
	items,
	loading,
}: { rowId: string; items: MenuItem[]; loading?: boolean }) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ top: 0, left: 0, up: false });

	useEffect(() => {
		if (!open) return;
		const update = () => {
			if (!triggerRef.current) return;
			const r = triggerRef.current.getBoundingClientRect();
			const est = Math.max(100, items.length * 34 + 8);
			const up = r.bottom + est > window.innerHeight - 8;
			setPos({ top: up ? r.top - 6 : r.bottom + 6, left: r.right, up });
		};
		const onPtr = (e: MouseEvent) => {
			if (!triggerRef.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node))
				setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
		update();
		document.addEventListener("mousedown", onPtr);
		document.addEventListener("keydown", onKey);
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);
		return () => {
			document.removeEventListener("mousedown", onPtr);
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
		};
	}, [open, items.length]);

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-400 hover:text-slate-600"
			>
				{loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <MoreHorizontal className="h-3 w-3" />}
			</button>
			{open &&
				createPortal(
					<div
						ref={menuRef}
						className="fixed z-[70] min-w-[180px] rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
						style={{
							top: pos.top,
							left: pos.left,
							transform: pos.up ? "translate(-100%,-100%)" : "translateX(-100%)",
						}}
					>
						{items.map((item) => (
							<button
								key={item.id}
								type="button"
								onClick={() => { if (!item.disabled) { setOpen(false); item.onSelect(); } }}
								disabled={item.disabled}
								className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs disabled:opacity-40 ${
									item.tone === "danger" ? "text-rose-600 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-50"
								}`}
							>
								<span className="shrink-0">{item.icon}</span>
								{item.label}
							</button>
						))}
					</div>,
					document.body,
				)}
		</>
	);
}

// ─── Live duration badge ──────────────────────────────────────────────────────

const LiveDuration = memo(function LiveDuration({ log }: { log: TaskTimeLog }) {
	const nowMs = useLiveNowMs(!log.ended_at);
	const secs = liveDurationSecondsFromLog(log, nowMs);
	return <span className="tabular-nums">{fmtHours(secs / 3600)}</span>;
});

// ─── Expanded log entry ───────────────────────────────────────────────────────

function ExpandedLogEntry({
	log,
	isPending,
	hasActiveLog,
	canOpenInRoadmap,
	onStop,
	onEdit,
	onDelete,
	onOpenTaskModal,
	onOpenInRoadmap,
}: {
	log: TaskTimeLog;
	isPending: boolean;
	hasActiveLog: boolean;
	canOpenInRoadmap: boolean;
	onStop: (id: string) => void;
	onEdit: (log: TaskTimeLog) => void;
	onDelete: (id: string) => void;
	onOpenTaskModal: (log: TaskTimeLog) => void;
	onOpenInRoadmap: (log: TaskTimeLog) => void;
}) {
	const isRunning = !log.ended_at;
	const isReadOnly = log.status === "approved" || log.status === "rejected" || log.status === "paid";
	const start = new Date(log.started_at);
	const end = log.ended_at ? new Date(log.ended_at) : null;

	const menuItems = useMemo<MenuItem[]>(() => {
		const items: MenuItem[] = [];
		if (isRunning) {
			items.push({
				id: "stop",
				label: "Stop timer",
				icon: <Square className="h-3 w-3" />,
				onSelect: () => onStop(log.id),
				disabled: isPending,
			});
		}
		items.push(
			{ id: "change-task", label: "Change task", icon: <Pencil className="h-3 w-3" />, onSelect: () => onOpenTaskModal(log), disabled: isPending || isReadOnly },
			{ id: "edit", label: "Edit log", icon: <Pencil className="h-3 w-3" />, onSelect: () => onEdit(log), disabled: isPending || hasActiveLog || isReadOnly },
			{ id: "delete", label: "Delete log", icon: <Trash2 className="h-3 w-3" />, onSelect: () => onDelete(log.id), disabled: isPending || isReadOnly, tone: "danger" },
			{ id: "roadmap", label: "Open in roadmap", icon: <ExternalLink className="h-3 w-3" />, onSelect: () => onOpenInRoadmap(log), disabled: !canOpenInRoadmap },
		);
		return items;
	}, [isRunning, isPending, isReadOnly, hasActiveLog, canOpenInRoadmap, log, onStop, onEdit, onDelete, onOpenTaskModal, onOpenInRoadmap]);

	return (
		<div
			className={`flex items-center gap-3 rounded-md px-3 py-1.5 text-[11px] ${
				isPending ? "bg-amber-50" : isRunning ? "bg-sky-50/60" : "hover:bg-white"
			}`}
		>
			{/* Dot */}
			<span
				className={`h-1.5 w-1.5 shrink-0 rounded-full ${
					isRunning ? "bg-sky-500" : log.source === "manual" ? "bg-amber-400" : "bg-blue-500"
				}`}
			/>
			{/* Date */}
			<span className="w-16 shrink-0 tabular-nums text-slate-500">
				{format(start, "MMM d")}
			</span>
			{/* Time range */}
			<span className="w-32 shrink-0 tabular-nums text-slate-600">
				{TIME_FMT.format(start)}
				{" – "}
				{isRunning ? (
					<span className="text-sky-500">running</span>
				) : end ? (
					TIME_FMT.format(end)
				) : (
					"—"
				)}
			</span>
			{/* Duration */}
			<span className="w-16 shrink-0 font-medium text-slate-700">
				<LiveDuration log={log} />
			</span>
			{/* Status */}
			<span
				className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
					isRunning ? "bg-sky-100 text-sky-700" : statusBadgeClass(log.status)
				}`}
			>
				{isRunning ? "running" : log.status}
			</span>
			{/* Actions */}
			<div className="ml-auto shrink-0">
				<ActionsMenu rowId={log.id} items={menuItems} loading={isPending} />
			</div>
		</div>
	);
}

// ─── Main timesheet ───────────────────────────────────────────────────────────

export interface MyLogsTimesheetProps {
	logs: TaskTimeLog[];
	loadingLogs: boolean;
	dates: Date[];
	viewMode: ViewMode;
	periodLabel: string;
	rowPendingById: Record<string, boolean>;
	onChangeViewMode: (mode: ViewMode) => void;
	onPrev: () => void;
	onNext: () => void;
	onToday: () => void;
	onAddLog: () => void;
	onStop: (id: string) => void | Promise<void>;
	onEdit: (log: TaskTimeLog) => void;
	onDelete: (id: string) => void | Promise<void>;
	onOpenTaskModal: (log: TaskTimeLog) => void;
	onOpenInRoadmap: (log: TaskTimeLog) => void;
	canOpenTaskInRoadmap: (taskId: string | null) => boolean;
}

export function MyLogsTimesheet({
	logs,
	loadingLogs,
	dates,
	viewMode,
	periodLabel,
	rowPendingById,
	onChangeViewMode,
	onPrev,
	onNext,
	onToday,
	onAddLog,
	onStop,
	onEdit,
	onDelete,
	onOpenTaskModal,
	onOpenInRoadmap,
	canOpenTaskInRoadmap,
}: MyLogsTimesheetProps) {
	const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
	const today = new Date();

	// Live updates for running logs
	const hasRunning = logs.some((l) => !l.ended_at);
	const nowMs = useLiveNowMs(hasRunning);

	const hasActiveLog = hasRunning;

	const { projectGroups, dailyTotals, maxCellHours } = useMemo(
		() => buildGridData(logs, dates, nowMs),
		[logs, dates, nowMs],
	);

	const grandTotal = Object.values(dailyTotals).reduce((s, v) => s + v, 0);
	const isMonth = viewMode === "month";
	const isToday = viewMode === "today";

	// Column widths
	const dateColWidth = isMonth ? 40 : isToday ? undefined : 108;

	const toggleRow = (key: string) =>
		setExpandedRowKey((prev) => (prev === key ? null : key));

	// ─── Skeleton ─────────────────────────────────────────────────────────────

	if (loadingLogs) {
		return (
			<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
				{/* Toolbar skeleton */}
				<div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
					<div className="h-7 w-48 animate-pulse rounded-lg bg-slate-100" />
					<div className="h-7 w-32 animate-pulse rounded-lg bg-slate-100" />
				</div>
				<div className="p-4 space-y-2">
					{Array.from({ length: 5 }).map((_, i) => (
						<div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
					))}
				</div>
			</div>
		);
	}

	// ─── Render ────────────────────────────────────────────────────────────────

	return (
		<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
			{/* ── Toolbar ─────────────────────────────────────────────────── */}
			<div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
				{/* View switcher */}
				<div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
					{(["today", "week", "month"] as const).map((m) => (
						<button
							key={m}
							type="button"
							onClick={() => { onChangeViewMode(m); setExpandedRowKey(null); }}
							className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
								viewMode === m
									? "bg-white text-slate-900 shadow-sm"
									: "text-slate-500 hover:text-slate-700"
							}`}
						>
							{m}
						</button>
					))}
				</div>

				{/* Period navigation */}
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={onPrev}
						className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
						aria-label="Previous"
					>
						<ChevronLeft className="h-4 w-4" />
					</button>
					<span className="min-w-[120px] text-center text-sm font-semibold text-slate-800">
						{periodLabel}
					</span>
					<button
						type="button"
						onClick={onNext}
						className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
						aria-label="Next"
					>
						<ChevronRight className="h-4 w-4" />
					</button>
				</div>

				<button
					type="button"
					onClick={onToday}
					className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
				>
					Today
				</button>

				{/* Start timer */}
				<button
					type="button"
					onClick={onAddLog}
					className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
				>
					<Timer className="h-3.5 w-3.5" />
					Start timer
				</button>
			</div>

			{/* ── Grid ──────────────────────────────────────────────────────── */}
			<div
				className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			>
				<table
					className="w-full border-collapse text-[11px]"
					style={{ tableLayout: isToday ? "auto" : "fixed" }}
				>
					<colgroup>
						<col style={{ width: "220px", minWidth: "200px" }} />
						{dates.map((d) => (
							<col
								key={format(d, "yyyy-MM-dd")}
								style={{
									width: dateColWidth ?? undefined,
									minWidth: dateColWidth ?? "140px",
								}}
							/>
						))}
						<col style={{ width: "72px", minWidth: "64px" }} />
					</colgroup>

					{/* ── Header ──────────────────────────────────────────────── */}
					<thead>
						<tr className="border-b border-slate-100">
							<th className="sticky left-0 z-20 border-r border-slate-100 bg-white px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
								Project / Task
							</th>
							{dates.map((d) => {
								const isTodayCol = isSameDay(d, today);
								return (
									<th
										key={format(d, "yyyy-MM-dd")}
										className={`border-r border-slate-50 py-2.5 text-center last:border-r-0 ${
											isTodayCol ? "bg-blue-50" : ""
										}`}
									>
										{!isMonth && (
											<div className="text-[9px] font-medium uppercase tracking-wide text-slate-400">
												{format(d, "EEE")}
											</div>
										)}
										<div
											className={`mt-0.5 text-xs font-semibold ${
												isTodayCol ? "text-blue-600" : "text-slate-600"
											}`}
										>
											{isMonth ? format(d, "d") : format(d, isToday ? "MMM d" : "d")}
										</div>
									</th>
								);
							})}
							<th className="sticky right-0 z-20 border-l border-slate-100 bg-white px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">
								Total
							</th>
						</tr>
					</thead>

					{/* ── Body ─────────────────────────────────────────────────── */}
					<tbody>
						{projectGroups.length === 0 ? (
							<tr>
								<td
									colSpan={dates.length + 2}
									className="px-6 py-16 text-center"
								>
									<div className="mx-auto max-w-xs">
										<div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
											<Timer className="h-6 w-6 text-slate-400" />
										</div>
										<p className="text-sm font-semibold text-slate-700">
											No time logged
										</p>
										<p className="mt-1 text-xs text-slate-400">
											Start a timer or add a manual entry to see your work here.
										</p>
										<button
											type="button"
											onClick={onAddLog}
											className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
										>
											<Plus className="h-3.5 w-3.5" />
											Start timer
										</button>
									</div>
								</td>
							</tr>
						) : (
							projectGroups.map((group) => (
								<>
									{/* Project header */}
									<tr
										key={`project-${group.projectId}`}
										className="border-t border-slate-100 bg-slate-50/60"
									>
										<td
											className="sticky left-0 z-10 border-r border-slate-100 bg-slate-50/80 px-4 py-2"
											colSpan={1}
										>
											<span className="text-[11px] font-semibold text-slate-700">
												{group.projectTitle}
											</span>
										</td>
										{dates.map((d) => {
											const isToday_ = isSameDay(d, today);
											return (
												<td
													key={format(d, "yyyy-MM-dd")}
													className={`border-r border-slate-50 py-2 last:border-r-0 ${isToday_ ? "bg-blue-50/60" : ""}`}
												/>
											);
										})}
										<td className="sticky right-0 z-10 border-l border-slate-100 bg-slate-50/80 px-3 py-2" />
									</tr>

									{/* Task rows */}
									{group.tasks.map((task) => {
										const isExpanded = expandedRowKey === task.key;
										const isRunningRow = task.logsInPeriod.some((l) => !l.ended_at);

										return (
											<>
												<tr
													key={task.key}
													onClick={() => toggleRow(task.key)}
													className="cursor-pointer border-t border-slate-50 hover:bg-slate-50/50"
												>
													{/* Task label */}
													<td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-4 py-2.5 group-hover:bg-slate-50/50">
														<div className="flex items-center gap-2 pl-3">
															{isRunningRow && (
																<span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-sky-500" />
															)}
															<span className="truncate text-slate-600">
																{task.taskTitle}
															</span>
														</div>
													</td>

													{/* Day cells */}
													{dates.map((d) => {
														const dayKey = format(d, "yyyy-MM-dd");
														const hours = task.hoursByDay[dayKey];
														const isToday_ = isSameDay(d, today);
														return (
															<td
																key={dayKey}
																className={`border-r border-slate-50 px-2 py-2 last:border-r-0 ${
																	isToday_ ? "bg-blue-50/60" : ""
																}`}
															>
																{hours && (
																	<HoursBar
																		hours={hours}
																		maxHours={maxCellHours}
																		isMonth={isMonth}
																	/>
																)}
															</td>
														);
													})}

													{/* Row total */}
													<td className="sticky right-0 z-10 border-l border-slate-100 bg-white px-3 py-2.5 text-right">
														<span className="font-semibold tabular-nums text-slate-700">
															{task.totalHours > 0
																? fmtHours(task.totalHours)
																: "—"}
														</span>
													</td>
												</tr>

												{/* Expanded log entries */}
												{isExpanded && (
													<tr key={`${task.key}-expanded`} className="border-t border-slate-50">
														<td
															colSpan={dates.length + 2}
															className="bg-slate-50/50 px-3 py-2"
														>
															<div className="space-y-0.5">
																{task.logsInPeriod
																	.slice()
																	.sort(
																		(a, b) =>
																			new Date(a.started_at).getTime() -
																			new Date(b.started_at).getTime(),
																	)
																	.map((log) => (
																		<ExpandedLogEntry
																			key={log.id}
																			log={log}
																			isPending={Boolean(rowPendingById[log.id])}
																			hasActiveLog={hasActiveLog}
																			canOpenInRoadmap={canOpenTaskInRoadmap(
																				log.task_id,
																			)}
																			onStop={onStop}
																			onEdit={onEdit}
																			onDelete={onDelete}
																			onOpenTaskModal={onOpenTaskModal}
																			onOpenInRoadmap={onOpenInRoadmap}
																		/>
																	))}
															</div>
														</td>
													</tr>
												)}
											</>
										);
									})}
								</>
							))
						)}
					</tbody>

					{/* ── Footer ───────────────────────────────────────────────── */}
					{projectGroups.length > 0 && (
						<tfoot>
							<tr className="border-t-2 border-slate-200 bg-slate-50">
								<td className="sticky left-0 z-10 border-r border-slate-100 bg-slate-50 px-4 py-2.5">
									<span className="font-bold text-slate-700">Total</span>
								</td>
								{dates.map((d) => {
									const dayKey = format(d, "yyyy-MM-dd");
									const total = dailyTotals[dayKey] ?? 0;
									const isToday_ = isSameDay(d, today);
									return (
										<td
											key={dayKey}
											className={`border-r border-slate-100 px-2 py-2.5 text-center last:border-r-0 ${
												isToday_ ? "bg-blue-50" : ""
											}`}
										>
											{total > 0 && (
												<span className="font-semibold tabular-nums text-slate-700">
													{fmtHours(total)}
												</span>
											)}
										</td>
									);
								})}
								<td className="sticky right-0 z-10 border-l border-slate-100 bg-slate-50 px-3 py-2.5 text-right">
									<span className="font-bold tabular-nums text-slate-900">
										{fmtHours(grandTotal)}
									</span>
								</td>
							</tr>
						</tfoot>
					)}
				</table>
			</div>

			{/* Legend */}
			{projectGroups.length > 0 && (
				<div className="flex items-center gap-4 border-t border-slate-50 px-4 py-2">
					<span className="flex items-center gap-1.5 text-[10px] text-slate-400">
						<span className="h-2 w-3 rounded-sm bg-blue-500" />
						Tracked
					</span>
					<span className="flex items-center gap-1.5 text-[10px] text-slate-400">
						<span className="h-2 w-3 rounded-sm bg-amber-400" />
						Manual
					</span>
					<span className="ml-auto text-[10px] text-slate-400">
						Click a task row to expand log details
					</span>
				</div>
			)}
		</div>
	);
}
