import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
	ExternalLink,
	Loader2,
	MoreHorizontal,
	Pencil,
	Play,
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
	ResolvedTeamRate,
	TaskTimeLog,
} from "@/services/team-time.service";
import { liveDurationSecondsFromLog } from "./time-utils";

type MyLogGridRow = {
	id: string;
	date: string;
	task_id: string;
	time_in: string;
	is_running: boolean;
	log: TaskTimeLog;
};

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
	ownRate: ResolvedTeamRate | null;
	loadingLogs: boolean;
	loadingTasks: boolean;
	taskSyncById: Record<string, boolean>;
	rowPendingById: Record<string, boolean>;
	onOpenTaskModal: (log: TaskTimeLog) => void;
	onStopLog: (logId: string) => void | Promise<void>;
	onDeleteLog: (logId: string) => void | Promise<void>;
	onEditLog: (log: TaskTimeLog) => void;
	onOpenTaskInRoadmap: (log: TaskTimeLog) => void;
	canOpenTaskInRoadmap: (taskId: string) => boolean;
	onOpenAddLog: () => void;
}

export function TeamMyLogsGrid({
	logs,
	tasks,
	ownRate,
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
	const [liveNowMs, setLiveNowMs] = useState(Date.now());
	const [openMenuRowId, setOpenMenuRowId] = useState<string | null>(null);

	const hasActiveLog = useMemo(
		() => logs.some((log) => !log.ended_at),
		[logs],
	);

	useEffect(() => {
		if (!hasActiveLog) return;
		const interval = window.setInterval(() => setLiveNowMs(Date.now()), 1000);
		return () => window.clearInterval(interval);
	}, [hasActiveLog]);

	const fullDateFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(undefined, {
				weekday: "long",
				month: "long",
				day: "numeric",
				year: "numeric",
			}),
		[],
	);

	const timeFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(undefined, {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			}),
		[],
	);
	const shortDateTimeFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(undefined, {
				month: "short",
				day: "numeric",
				year: "numeric",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			}),
		[],
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
		const populatedRows = sortedLogs.map((log) => {
			const startedDate = new Date(log.started_at);
			const hasValidStart = !Number.isNaN(startedDate.getTime());
			const taskTitle =
				log.task?.title || taskTitleById.get(log.task_id) || "Task";

			return {
				id: log.id,
				date: !hasValidStart ? "-" : fullDateFormatter.format(startedDate),
				task_id: log.task_id,
				time_in: !hasValidStart ? "-" : timeFormatter.format(startedDate),
				is_running: !log.ended_at,
				log: {
					...log,
					task: {
						id: log.task_id,
						title: taskTitle,
					},
				},
			};
		});
		return populatedRows;
	}, [fullDateFormatter, logs, taskTitleById, timeFormatter]);

	const formatTimeOut = useMemo(
		() => (log: TaskTimeLog) => {
			const endedDate = log.ended_at ? new Date(log.ended_at) : null;
			const nowDate = new Date(liveNowMs);
			const startedDate = new Date(log.started_at);
			const hasValidStart = !Number.isNaN(startedDate.getTime());
			const hasValidEnd = Boolean(
				endedDate && !Number.isNaN(endedDate.getTime()),
			);
			const hasValidNow = !Number.isNaN(nowDate.getTime());
			const endedDateValue: Date | undefined = hasValidEnd
				? (endedDate as Date)
				: undefined;
			const isMultiDay =
				hasValidStart &&
				hasValidEnd &&
				startedDate.toDateString() !== endedDateValue?.toDateString();

			if (hasValidEnd) {
				return isMultiDay
					? shortDateTimeFormatter.format(endedDateValue)
					: timeFormatter.format(endedDateValue as Date);
			}
			if (!hasValidNow) return "-";
			if (
				hasValidStart &&
				startedDate.toDateString() !== nowDate.toDateString()
			) {
				return shortDateTimeFormatter.format(nowDate);
			}
			return timeFormatter.format(nowDate);
		},
		[liveNowMs, shortDateTimeFormatter, timeFormatter],
	);

	const getHoursWorked = useMemo(
		() => (log: TaskTimeLog) =>
			Number((liveDurationSecondsFromLog(log, liveNowMs) / 3600).toFixed(2)),
		[liveNowMs],
	);

	const getFees = useMemo(
		() => (log: TaskTimeLog) => {
			// Settled logs use their own rate_snapshot; running logs (no
			// snapshot until first stop in some cases) fall back to the
			// caller's current ownRate so the live timer feels accurate.
			const snap = Number(log.rate_snapshot ?? 0);
			const hourly =
				snap > 0 ? snap : ownRate ? Number(ownRate.hourly_rate) : null;
			if (hourly === null || !Number.isFinite(hourly)) return null;
			const hoursWorked = getHoursWorked(log);
			return Number((hoursWorked * hourly).toFixed(2));
		},
		[getHoursWorked, ownRate],
	);

	const getCurrency = (log: TaskTimeLog) =>
		log.currency_snapshot || ownRate?.currency || "USD";

	const columnHelper = createColumnHelper<MyLogGridRow>();
	const columns = useMemo(
		() => [
			columnHelper.accessor("date", {
				id: "date",
				header: "Dates",
				cell: (info) => info.getValue(),
			}),
			columnHelper.accessor("task_id", {
				id: "task_id",
				header: "Task",
				cell: (info) => {
					const row = info.row.original;
					const taskTitle =
						row.log.task?.title ||
						taskTitleById.get(row.task_id) ||
						"Untitled task";
					return (
						<div className="flex items-center gap-1.5">
							<span
								title={taskTitle}
								className="block truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700"
							>
								{taskTitle}
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
				cell: (info) => (
					<span className="tabular-nums">
						{formatTimeOut(info.row.original.log)}
					</span>
				),
			}),
			columnHelper.display({
				id: "hours_worked",
				header: "Hours",
				cell: (info) => {
					const row = info.row.original;
					return (
						<span className="text-xs font-semibold text-gray-700">
							{getHoursWorked(row.log).toFixed(2)}
						</span>
					);
				},
			}),
			columnHelper.display({
				id: "fees",
				header: "Fees",
				cell: (info) => {
					const row = info.row.original;
					const fees = getFees(row.log);
					return (
						<span className="text-xs font-semibold text-emerald-700">
							{fees === null ? "-" : `${fees.toFixed(2)} ${getCurrency(row.log)}`}
						</span>
					);
				},
			}),
			columnHelper.accessor((row) => row.log.status, {
				id: "status",
				header: "Status",
				cell: (info) => {
					const row = info.row.original;
					return (
						<div className="flex items-center gap-1">
							{row.is_running && (
								<span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-700">
									running
								</span>
							)}
							<span
								className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusBadgeClass(
									info.getValue(),
								)}`}
							>
								{info.getValue()}
							</span>
						</div>
					);
				},
			}),
			columnHelper.display({
				id: "actions",
				header: "Actions",
				cell: (info) => {
					const row = info.row.original;
					const isRowPending = Boolean(rowPendingById[row.id]);
					const isReadOnly = isMemberReadOnlyStatus(row.log.status);
					const canOpenInRoadmap = canOpenTaskInRoadmap(row.log.task_id);

					const menuItems: ActionMenuItem[] = [];
					if (row.is_running) {
						menuItems.push({
							id: "stop",
							label: "Stop timer",
							icon: <Square className="h-3.5 w-3.5" />,
							onSelect: () => void onStopLog(row.id),
							disabled: isRowPending,
						});
					}
					menuItems.push(
						{
							id: "change-task",
							label: "Change task",
							icon: <Pencil className="h-3.5 w-3.5" />,
							onSelect: () => onOpenTaskModal(row.log),
							disabled: isRowPending || loadingTasks || isReadOnly,
						},
						{
							id: "edit",
							label: "Edit log",
							icon: <Pencil className="h-3.5 w-3.5" />,
							onSelect: () => onEditLog(row.log),
							disabled: isRowPending || hasActiveLog || isReadOnly,
						},
						{
							id: "delete",
							label: "Delete log",
							icon: <Trash2 className="h-3.5 w-3.5" />,
							onSelect: () => void onDeleteLog(row.id),
							disabled: isRowPending || isReadOnly,
							tone: "danger",
						},
						{
							id: "open-roadmap-task",
							label: "Open task in roadmap",
							icon: <ExternalLink className="h-3.5 w-3.5" />,
							onSelect: () => onOpenTaskInRoadmap(row.log),
							disabled: isRowPending || !canOpenInRoadmap,
						},
					);

					return (
						<RowActionsMenu
							rowId={row.id}
							openMenuRowId={openMenuRowId}
							onSetOpenMenuRowId={setOpenMenuRowId}
							items={menuItems}
							disabled={false}
							loading={isRowPending}
						/>
					);
				},
			}),
		],
		[
			columnHelper,
			loadingTasks,
			formatTimeOut,
			getFees,
			getHoursWorked,
			hasActiveLog,
			onDeleteLog,
			onEditLog,
			onOpenTaskInRoadmap,
			onOpenAddLog,
			onOpenTaskModal,
			onStopLog,
			ownRate?.currency,
			openMenuRowId,
			rowPendingById,
			canOpenTaskInRoadmap,
			taskTitleById,
			taskSyncById,
		],
	);

	const table = useReactTable({
		data: rows,
		columns,
		getCoreRowModel: getCoreRowModel(),
	});

	if (loadingLogs) return <MyLogsGridSkeleton />;
	return (
		<div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
			<table className="w-full table-fixed text-[11px]">
				<colgroup>
					<col className="w-[19%]" />
					<col className="w-[20%]" />
					<col className="w-[13%]" />
					<col className="w-[13%]" />
					<col className="w-[8%]" />
					<col className="w-[9%]" />
					<col className="w-[9%]" />
					<col className="w-[9%]" />
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
							<td colSpan={8} className="px-6 py-20">
								<div className="mx-auto flex max-w-sm flex-col items-center text-center">
									<div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
										<Timer className="h-7 w-7 text-slate-500" />
									</div>
									<h3 className="text-base font-semibold text-slate-900">
										No time logged yet
									</h3>
									<p className="mt-2 text-sm text-slate-500">
										Track time on tasks across the projects this team is
										attached to. Each log freezes your current rate, so you'll
										always know what it's worth.
									</p>
									<p className="mt-3 text-sm text-slate-500">
										Start a timer to begin logging, then submit it for review
										by a team owner or admin.
									</p>
									<button
										type="button"
										onClick={onOpenAddLog}
										className="mt-6 inline-flex items-center gap-2 rounded-md bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-700"
									>
										<Play className="h-3.5 w-3.5" />
										Start a timer
									</button>
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
								{row.getVisibleCells().map((cell) => (
									<td key={cell.id} className="px-2 py-1.5 align-middle">
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</td>
								))}
							</tr>
						))
					)}
				</tbody>
			</table>
		</div>
	);
}
