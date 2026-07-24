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
	ExternalLink,
	Loader2,
	MoreHorizontal,
	Pencil,
	Plus,
	Square,
	Timer,
	Trash2,
} from "lucide-react";
import {
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";
import type {
	ProjectTaskOption,
	TaskTimeLog,
} from "@/services/team-time.service";
import { liveDurationSecondsFromLog, useLiveNowMs } from "./time-utils";
import { useTableCellSelection } from "./useTableCellSelection";
import { CellSelectionScoreboard } from "./CellSelectionScoreboard";

// Module-scope formatters: stable references shared across all cells,
// so they never trigger a re-render via prop identity changes.
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
	weekday: "long",
	month: "long",
	day: "numeric",
	year: "numeric",
});
const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
});
const SHORT_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
});

type MyLogGridRow = {
	id: string;
	date: string;
	day_total_hours: number;
	project_label: string;
	task_id: string | null;
	time_in: string;
	is_running: boolean;
	log: TaskTimeLog;
};

function toLocalDayKey(value: string): string | null {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return null;
	const yyyy = parsed.getFullYear();
	const mm = String(parsed.getMonth() + 1).padStart(2, "0");
	const dd = String(parsed.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

type MenuTone = "default" | "danger";

type ActionMenuItem = {
	id: string;
	label: string;
	icon: ReactNode;
	onSelect: () => void;
	disabled?: boolean;
	tone?: MenuTone;
};

function statusBadgeClass(status: TaskTimeLog["status"]) {
	if (status === "approved") return "bg-emerald-100 text-emerald-700";
	if (status === "paid") return "bg-indigo-100 text-indigo-700";
	if (status === "rejected") return "bg-rose-100 text-rose-700";
	return "bg-amber-100 text-amber-700";
}

function isMemberReadOnlyStatus(status: TaskTimeLog["status"]): boolean {
	return status === "approved" || status === "rejected";
}

function RowActionsMenu({
	rowId,
	openMenuRowId,
	onSetOpenMenuRowId,
	items,
	disabled,
	loading,
}: {
	rowId: string;
	openMenuRowId: string | null;
	onSetOpenMenuRowId: (rowId: string | null) => void;
	items: ActionMenuItem[];
	disabled?: boolean;
	loading?: boolean;
}) {
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const isOpen = openMenuRowId === rowId;
	const [menuPosition, setMenuPosition] = useState({
		top: 0,
		left: 0,
		openUpward: false,
	});

	useEffect(() => {
		if (!isOpen) return;
		const updatePosition = () => {
			if (!triggerRef.current) return;
			const rect = triggerRef.current.getBoundingClientRect();
			const estimatedMenuHeight = Math.max(120, items.length * 34 + 10);
			const openUpward =
				rect.bottom + estimatedMenuHeight > window.innerHeight - 8;
			setMenuPosition({
				top: openUpward ? rect.top - 6 : rect.bottom + 6,
				left: rect.right,
				openUpward,
			});
		};
		const handlePointer = (event: MouseEvent) => {
			const target = event.target as Node;
			const inTrigger = triggerRef.current?.contains(target);
			const inMenu = menuRef.current?.contains(target);
			if (!inTrigger && !inMenu) onSetOpenMenuRowId(null);
		};
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onSetOpenMenuRowId(null);
		};
		updatePosition();
		document.addEventListener("mousedown", handlePointer);
		document.addEventListener("keydown", handleEscape);
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);
		return () => {
			document.removeEventListener("mousedown", handlePointer);
			document.removeEventListener("keydown", handleEscape);
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
		};
	}, [isOpen, items.length, onSetOpenMenuRowId]);

	const toneClass = (tone: MenuTone | undefined) => {
		if (tone === "danger") return "text-rose-700 hover:bg-rose-50";
		return "text-slate-700 hover:bg-slate-50";
	};

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => onSetOpenMenuRowId(isOpen ? null : rowId)}
				disabled={disabled}
				title="Log actions"
				aria-label="Log actions"
				className="inline-flex items-center justify-center h-7 w-8 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{loading ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin" />
				) : (
					<MoreHorizontal className="h-3.5 w-3.5" />
				)}
			</button>
			{isOpen
				? createPortal(
						<div
							ref={menuRef}
							className="fixed z-70 min-w-[196px] rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
							style={{
								top: menuPosition.top,
								left: menuPosition.left,
								transform: menuPosition.openUpward
									? "translate(-100%, -100%)"
									: "translateX(-100%)",
							}}
						>
							{items.map((item) => (
								<button
									key={item.id}
									type="button"
									onClick={() => {
										if (item.disabled) return;
										onSetOpenMenuRowId(null);
										item.onSelect();
									}}
									disabled={item.disabled}
									className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneClass(
										item.tone,
									)}`}
								>
									<span className="shrink-0">{item.icon}</span>
									<span>{item.label}</span>
								</button>
							))}
						</div>,
						document.body,
					)
				: null}
		</>
	);
}

/**
 * Memoized actions cell. The grid re-renders every second to advance
 * the live duration column; without this wrapper, the row's menu would
 * also re-render every tick (and the open popover would visibly
 * reconcile its children). All props passed in must be stable across
 * a tick — primitive booleans + useCallback'd handlers from the parent
 * route + a row.log reference that is itself stable within the rows
 * useMemo (which doesn't depend on liveNowMs).
 */
// ─── live-updating leaf cells ────────────────────────────────────────
//
// These cells own their own subscription to the shared 1Hz timer.
// Putting the live-time logic here (instead of in the grid's `columns`
// useMemo) keeps the column definitions stable across ticks, so
// TanStack Table doesn't rebuild the row model and re-render every
// cell — which previously made the open action-menu visibly thrash.

const LiveTimeOutCell = memo(function LiveTimeOutCell({
	log,
}: {
	log: TaskTimeLog;
}) {
	const isRunning = !log.ended_at;
	const nowMs = useLiveNowMs(isRunning);
	const startedDate = new Date(log.started_at);
	const endedDate = log.ended_at ? new Date(log.ended_at) : null;
	const nowDate = new Date(nowMs);
	const hasValidStart = !Number.isNaN(startedDate.getTime());
	const hasValidEnd = Boolean(endedDate && !Number.isNaN(endedDate.getTime()));
	const hasValidNow = !Number.isNaN(nowDate.getTime());
	const endedDateValue = hasValidEnd ? (endedDate as Date) : undefined;
	const isMultiDay =
		hasValidStart &&
		hasValidEnd &&
		startedDate.toDateString() !== endedDateValue?.toDateString();

	let label: string;
	if (hasValidEnd) {
		label = isMultiDay
			? SHORT_DATE_TIME_FORMATTER.format(endedDateValue as Date)
			: TIME_FORMATTER.format(endedDateValue as Date);
	} else if (!hasValidNow) {
		label = "-";
	} else if (
		hasValidStart &&
		startedDate.toDateString() !== nowDate.toDateString()
	) {
		label = SHORT_DATE_TIME_FORMATTER.format(nowDate);
	} else {
		label = TIME_FORMATTER.format(nowDate);
	}
	return <span className="tabular-nums">{label}</span>;
});

const LiveHoursCell = memo(function LiveHoursCell({
	log,
}: {
	log: TaskTimeLog;
}) {
	const isRunning = !log.ended_at;
	const nowMs = useLiveNowMs(isRunning);
	const hours = (liveDurationSecondsFromLog(log, nowMs) / 3600).toFixed(2);
	const breakMins = log.break_minutes ?? 0;
	return (
		<div className="flex flex-col">
			<span className="text-xs font-semibold text-gray-700">{hours}h</span>
			{breakMins > 0 && (
				<span
					className="text-[10px] text-amber-700 font-medium"
					title={`${breakMins} minute(s) break deducted`}
				>
					-{breakMins}m break
				</span>
			)}
		</div>
	);
});

const LiveFeesCell = memo(function LiveFeesCell({
	log,
	fallbackHourlyRate,
	fallbackCurrency,
}: {
	log: TaskTimeLog;
	fallbackHourlyRate: number | null;
	fallbackCurrency: string | null;
}) {
	const isRunning = !log.ended_at;
	const nowMs = useLiveNowMs(isRunning);
	// Settled logs use their own rate_snapshot; running logs (no
	// snapshot until first stop in some cases) fall back to the
	// caller's current ownRate so the live timer feels accurate.
	const snap = Number(log.rate_snapshot ?? 0);
	const hourly = snap > 0 ? snap : fallbackHourlyRate;
	if (hourly === null || !Number.isFinite(hourly)) {
		return <span className="text-xs font-semibold text-emerald-700">-</span>;
	}
	const hours = liveDurationSecondsFromLog(log, nowMs) / 3600;
	const currency = log.currency_snapshot || fallbackCurrency || "USD";
	return (
		<span className="text-xs font-semibold text-emerald-700">
			{(hours * hourly).toFixed(2)} {currency}
		</span>
	);
});

interface MyLogsActionsCellProps {
	log: TaskTimeLog;
	rowId: string;
	isRunning: boolean;
	isRowPending: boolean;
	hasActiveLog: boolean;
	loadingTasks: boolean;
	canOpenInRoadmap: boolean;
	openMenuRowId: string | null;
	onSetOpenMenuRowId: (id: string | null) => void;
	onStopLog: (id: string) => void | Promise<void>;
	onOpenTaskModal: (log: TaskTimeLog) => void;
	onEditLog: (log: TaskTimeLog) => void;
	onDeleteLog: (id: string) => void | Promise<void>;
	onOpenTaskInRoadmap: (log: TaskTimeLog) => void;
}

const MyLogsActionsCell = memo(function MyLogsActionsCell({
	log,
	rowId,
	isRunning,
	isRowPending,
	hasActiveLog,
	loadingTasks,
	canOpenInRoadmap,
	openMenuRowId,
	onSetOpenMenuRowId,
	onStopLog,
	onOpenTaskModal,
	onEditLog,
	onDeleteLog,
	onOpenTaskInRoadmap,
}: MyLogsActionsCellProps) {
	const isReadOnly = isMemberReadOnlyStatus(log.status);
	const menuItems = useMemo<ActionMenuItem[]>(() => {
		const items: ActionMenuItem[] = [];
		if (isRunning) {
			items.push({
				id: "stop",
				label: "Stop timer",
				icon: <Square className="h-3.5 w-3.5" />,
				onSelect: () => void onStopLog(rowId),
				disabled: isRowPending,
			});
		}
		items.push(
			{
				id: "change-task",
				label: "Change task",
				icon: <Pencil className="h-3.5 w-3.5" />,
				onSelect: () => onOpenTaskModal(log),
				disabled: isRowPending || loadingTasks || isReadOnly,
			},
			{
				id: "edit",
				label: "Edit log",
				icon: <Pencil className="h-3.5 w-3.5" />,
				onSelect: () => onEditLog(log),
				disabled: isRowPending || hasActiveLog || isReadOnly,
			},
			{
				id: "delete",
				label: "Delete log",
				icon: <Trash2 className="h-3.5 w-3.5" />,
				onSelect: () => void onDeleteLog(rowId),
				disabled: isRowPending || isReadOnly,
				tone: "danger",
			},
			{
				id: "open-roadmap-task",
				label: "Open task in roadmap",
				icon: <ExternalLink className="h-3.5 w-3.5" />,
				onSelect: () => onOpenTaskInRoadmap(log),
				disabled: isRowPending || !canOpenInRoadmap,
			},
		);
		return items;
	}, [
		isRunning,
		isRowPending,
		loadingTasks,
		isReadOnly,
		hasActiveLog,
		canOpenInRoadmap,
		log,
		rowId,
		onStopLog,
		onOpenTaskModal,
		onEditLog,
		onDeleteLog,
		onOpenTaskInRoadmap,
	]);

	return (
		<RowActionsMenu
			rowId={rowId}
			openMenuRowId={openMenuRowId}
			onSetOpenMenuRowId={onSetOpenMenuRowId}
			items={menuItems}
			loading={isRowPending}
		/>
	);
});

function MyLogsGridSkeleton() {
	return (
		<div className="rounded-xl border border-gray-200 overflow-hidden bg-white animate-pulse">
			<div className="h-10 border-b border-gray-200 bg-gray-100" />
			<div className="p-3 space-y-2">
				{Array.from({ length: 7 }).map((_, idx) => (
					<div key={idx} className="h-8 rounded bg-gray-100" />
				))}
			</div>
		</div>
	);
}

interface TeamMyLogsGridProps {
	logs: TaskTimeLog[];
	tasks: ProjectTaskOption[];
	ownRateByProjectId: Record<string, { hourly_rate: number; currency: string }>;
	loadingLogs: boolean;
	loadingTasks: boolean;
	taskSyncById: Record<string, boolean>;
	rowPendingById: Record<string, boolean>;
	onOpenTaskModal: (log: TaskTimeLog) => void;
	onStopLog: (logId: string) => void | Promise<void>;
	onDeleteLog: (logId: string) => void | Promise<void>;
	onEditLog: (log: TaskTimeLog) => void;
	onOpenTaskInRoadmap: (log: TaskTimeLog) => void;
	canOpenTaskInRoadmap: (taskId: string | null) => boolean;
	onOpenAddLog: () => void;
}

export function TeamMyLogsGrid({
	logs,
	tasks,
	ownRateByProjectId,
	loadingLogs,
	loadingTasks,
	taskSyncById,
	rowPendingById,
	onOpenTaskModal,
	onStopLog,
	onDeleteLog,
	onEditLog,
	onOpenTaskInRoadmap,
	canOpenTaskInRoadmap,
	onOpenAddLog,
}: TeamMyLogsGridProps) {
	const [openMenuRowId, setOpenMenuRowId] = useState<string | null>(null);

	const SELECTABLE_COLS = [
		"date",
		"project",
		"task_id",
		"time_in",
		"time_out",
		"hours_worked",
		"fees",
		"status",
	];

	const hasActiveLog = useMemo(
		() => logs.some((log) => !log.ended_at),
		[logs],
	);

	const taskTitleById = useMemo(() => {
		const map = new Map<string, string>();
		for (const task of tasks) {
			map.set(task.id, task.title || "Untitled task");
		}
		return map;
	}, [tasks]);

	const rows = useMemo<MyLogGridRow[]>(() => {
		const sortedLogs = [...logs].sort((a, b) => {
			const aMs = new Date(a.started_at).getTime();
			const bMs = new Date(b.started_at).getTime();
			return aMs - bMs;
		});
		const dayTotalsByKey = new Map<string, number>();
		for (const log of sortedLogs) {
			const dayKey = toLocalDayKey(log.started_at);
			if (!dayKey) continue;
			const seconds = Math.max(
				0,
				Number(
					log.duration_seconds ??
						(log.ended_at
							? (new Date(log.ended_at).getTime() -
									new Date(log.started_at).getTime()) /
							  1000
							: 0),
				),
			);
			const hours = seconds / 3600;
			dayTotalsByKey.set(dayKey, (dayTotalsByKey.get(dayKey) ?? 0) + hours);
		}
		const populatedRows = sortedLogs.map((log) => {
			const startedDate = new Date(log.started_at);
			const hasValidStart = !Number.isNaN(startedDate.getTime());
			const dayKey = hasValidStart ? toLocalDayKey(log.started_at) : null;
			const taskTitle =
				log.task?.title ||
				(log.task_id ? taskTitleById.get(log.task_id) : undefined) ||
				"-";

			return {
				id: log.id,
				date: !hasValidStart ? "-" : FULL_DATE_FORMATTER.format(startedDate),
				day_total_hours: dayKey ? dayTotalsByKey.get(dayKey) ?? 0 : 0,
				project_label: log.project?.title || log.project_id,
				task_id: log.task_id,
				time_in: !hasValidStart ? "-" : TIME_FORMATTER.format(startedDate),
				is_running: !log.ended_at,
				log:
					log.task_id === null
						? { ...log, task: null }
						: {
								...log,
								task: {
									id: log.task_id,
									title: taskTitle,
								},
							},
			};
		});
		return populatedRows;
	}, [logs, taskTitleById]);

	// Per-project fallback rate map; consumed inside the cell to pick by log.project_id.

	const columnHelper = createColumnHelper<MyLogGridRow>();
	const columns = useMemo(
		() => [
			columnHelper.accessor("date", {
				id: "date",
				header: "Dates",
				cell: (info) => {
					const row = info.row.original;
					const dailyHours = row.day_total_hours;
					const hasHours = Number.isFinite(dailyHours) && dailyHours > 0;
					const isOverLimit = hasHours && dailyHours > 8;
					return (
						<div className="min-w-0">
							<div className="truncate">{info.getValue()}</div>
							{hasHours ? (
								<span
									className={`mt-1 inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
										isOverLimit
											? "border-rose-200 bg-rose-50 text-rose-700"
											: "border-emerald-200 bg-emerald-50 text-emerald-700"
									}`}
									title={
										isOverLimit
											? "Over 8 hours logged on this day"
											: "Within 8-hour daily target"
									}
								>
									{dailyHours.toFixed(2)}h day total
								</span>
							) : null}
						</div>
					);
				},
			}),
			columnHelper.accessor("project_label", {
				id: "project",
				header: "Project",
				cell: (info) => (
					<span className="block truncate" title={info.getValue()}>
						{info.getValue()}
					</span>
				),
			}),
			columnHelper.accessor("task_id", {
				id: "task_id",
				header: "Task",
				cell: (info) => {
					const row = info.row.original;
					const taskTitle =
						row.log.task?.title ||
						(row.task_id ? taskTitleById.get(row.task_id) : undefined) ||
						null;
					return (
						<div className="flex items-center gap-1.5">
							<span
								title={
									taskTitle ?? "General time — not linked to a specific task."
								}
								className={`block truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] ${taskTitle ? "text-slate-700" : "italic text-slate-400"}`}
							>
								{taskTitle ?? "No task"}
							</span>
							{taskSyncById[row.id] && (
								<Loader2
									className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-700"
									aria-label="Task update syncing"
								/>
							)}
						</div>
					);
				},
			}),
			columnHelper.accessor("time_in", {
				id: "time_in",
				header: "Time-in",
				cell: (info) => (
					<span className="tabular-nums">{info.getValue()}</span>
				),
			}),
			columnHelper.display({
				id: "time_out",
				header: "Time-Out",
				cell: (info) => <LiveTimeOutCell log={info.row.original.log} />,
			}),
			columnHelper.display({
				id: "hours_worked",
				header: "Hours",
				cell: (info) => <LiveHoursCell log={info.row.original.log} />,
			}),
			columnHelper.display({
				id: "fees",
				header: "Fees",
				cell: (info) => {
					const log = info.row.original.log;
					const fallback = ownRateByProjectId[log.project_id];
					return (
						<LiveFeesCell
							log={log}
							fallbackHourlyRate={
								fallback ? Number(fallback.hourly_rate) : null
							}
							fallbackCurrency={fallback?.currency ?? null}
						/>
					);
				},
			}),
			columnHelper.accessor((row) => row.log.status, {
				id: "status",
				header: "Status",
				cell: (info) => {
					const row = info.row.original;
					// While running, the review status (always 'pending' until
					// the log is stopped) is noise — collapse to one badge.
					if (row.is_running) {
						return (
							<span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-700">
								running
							</span>
						);
					}
					const note = row.log.review_note?.trim();
					const reviewedLabel = row.log.reviewed_at
						? `Reviewed ${new Date(row.log.reviewed_at).toLocaleString()}`
						: null;
					return (
						<div className="min-w-0">
							<span
								className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusBadgeClass(
									info.getValue(),
								)}`}
							>
								{info.getValue()}
							</span>
							{note ? (
								<div
									className={`mt-1 truncate text-[10px] ${
										row.log.status === "rejected"
											? "text-rose-700"
											: "text-slate-500"
									}`}
									title={note}
								>
									{row.log.status === "rejected" ? `Reason: ${note}` : note}
								</div>
							) : null}
							{!note && reviewedLabel ? (
								<div className="mt-1 truncate text-[10px] text-slate-500">
									{reviewedLabel}
								</div>
							) : null}
						</div>
					);
				},
			}),
			columnHelper.display({
				id: "actions",
				header: "Actions",
				cell: (info) => {
					const row = info.row.original;
					return (
						<MyLogsActionsCell
							log={row.log}
							rowId={row.id}
							isRunning={row.is_running}
							isRowPending={Boolean(rowPendingById[row.id])}
							hasActiveLog={hasActiveLog}
							loadingTasks={loadingTasks}
							canOpenInRoadmap={canOpenTaskInRoadmap(row.log.task_id)}
							openMenuRowId={openMenuRowId}
							onSetOpenMenuRowId={setOpenMenuRowId}
							onStopLog={onStopLog}
							onOpenTaskModal={onOpenTaskModal}
							onEditLog={onEditLog}
							onDeleteLog={onDeleteLog}
							onOpenTaskInRoadmap={onOpenTaskInRoadmap}
						/>
					);
				},
			}),
		],
		[
			columnHelper,
			loadingTasks,
			hasActiveLog,
			onDeleteLog,
			onEditLog,
			onOpenTaskInRoadmap,
			onOpenAddLog,
			onOpenTaskModal,
			onStopLog,
			openMenuRowId,
			rowPendingById,
			canOpenTaskInRoadmap,
			taskTitleById,
			taskSyncById,
			ownRateByProjectId,
		],
	);

	const table = useReactTable({
		data: rows,
		columns,
		getCoreRowModel: getCoreRowModel(),
	});

	const tableRef = useRef<HTMLTableElement | null>(null);
	const orderedRowIds = table.getRowModel().rows.map((r) => r.original.id);
	const { selectedCells, isSelected, getCellDataProps } =
		useTableCellSelection(orderedRowIds, SELECTABLE_COLS, tableRef);

	if (loadingLogs) return <MyLogsGridSkeleton />;
	return (
		<>
		<CellSelectionScoreboard
			selectedCells={selectedCells}
			logs={logs}
			ownRateByProjectId={ownRateByProjectId}
		/>
		<div className="rounded-xl border border-gray-200 bg-white overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
			<table
				ref={tableRef}
				className="w-full min-w-[1050px] table-fixed text-[11px] select-none"
			>
				<colgroup>
					<col className="w-[16%]" />
					<col className="w-[14%]" />
					<col className="w-[18%]" />
					<col className="w-[10%]" />
					<col className="w-[10%]" />
					<col className="w-[7%]" />
					<col className="w-[9%]" />
					<col className="w-[8%]" />
					<col className="w-[8%]" />
				</colgroup>
				<thead className="bg-slate-900 text-white">
					{table.getHeaderGroups().map((headerGroup) => (
						<tr key={headerGroup.id}>
							{headerGroup.headers.map((header) => (
								<th
									key={header.id}
									className="px-2 py-2.5 text-left text-sm font-bold border-r border-white/30 last:border-r-0"
								>
									{header.isPlaceholder
										? null
										: flexRender(
												header.column.columnDef.header,
												header.getContext(),
											)}
								</th>
							))}
						</tr>
					))}
				</thead>
				<tbody>
					{rows.length === 0 ? (
						<tr className="border-t border-gray-200">
							<td colSpan={9} className="px-6 py-12">
								<div className="mx-auto flex max-w-sm flex-col items-center text-center">
									<div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
										<Timer className="h-6 w-6 text-slate-500" />
									</div>
									<h3 className="text-base font-semibold text-slate-900">
										No time logged yet
									</h3>
									<p className="mt-2 text-sm text-slate-500">
										Click any of the rows below to start a timer. Each log
										freezes your current rate.
									</p>
								</div>
							</td>
						</tr>
					) : (
						table.getRowModel().rows.map((row) => (
							<tr
								key={row.id}
								className={`border-t border-gray-200 ${
									rowPendingById[row.original.id] ? "bg-amber-50/40" : ""
								}`}
							>
								{row.getVisibleCells().map((cell) => {
									const colId = cell.column.id;
									const selectable = SELECTABLE_COLS.includes(colId);
									const selected =
										selectable && isSelected(row.original.id, colId);
									return (
										<td
											key={cell.id}
											className={`px-2 py-1.5 align-middle ${selectable ? "cursor-cell" : ""} ${selected ? "bg-blue-100" : ""}`}
											{...(selectable
												? getCellDataProps(row.original.id, colId)
												: {})}
										>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</td>
									);
								})}
							</tr>
						))
					)}
					<tr
						className="group cursor-pointer border-t border-dashed border-slate-200 hover:bg-sky-50/50"
						onClick={onOpenAddLog}
					>
						<td colSpan={9} className="px-3 py-2 align-middle">
							<span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 group-hover:text-sky-700">
								<Plus className="h-3.5 w-3.5" />
								<span className="font-medium">Click to start a timer</span>
							</span>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		</>
	);
}
