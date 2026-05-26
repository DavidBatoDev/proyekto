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
	Check,
	ClipboardCheck,
	ExternalLink,
	Loader2,
	MoreHorizontal,
	RotateCcw,
	Settings2,
	X,
} from "lucide-react";
import {
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";
import type { TaskTimeLog } from "@/services/team-time.service";
import { liveDurationSecondsFromLog, useLiveNowMs } from "./time-utils";
import { useTableCellSelection } from "./useTableCellSelection";
import { CellSelectionScoreboard } from "./CellSelectionScoreboard";

// Module-scope formatters: stable references shared across all cells.
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

type TeamApprovalsRow = {
	id: string;
	logIds: string[];
	logs: TaskTimeLog[];
	date: string;
	member_label: string;
	project_label: string;
	task_id: string | null;
	task_title: string;
	time_in: string;
	status: TaskTimeLog["status"] | "mixed";
	is_running: boolean;
	is_self: boolean;
	eligibleLogIds: string[];
};

type GroupDimensionId = "date" | "member" | "project" | "task_id";

type MenuTone = "default" | "success" | "warning" | "danger";

type ActionMenuItem = {
	id: string;
	label: string;
	icon: ReactNode;
	onSelect: () => void;
	disabled?: boolean;
	tone?: MenuTone;
};

type ColumnOption = {
	id: string;
	label: string;
	canHide?: boolean;
};

function makeLocalDateKey(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return "invalid";
	const yyyy = parsed.getFullYear();
	const mm = String(parsed.getMonth() + 1).padStart(2, "0");
	const dd = String(parsed.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

/**
 * Memoized actions cell. The grid re-renders every second to advance
 * the live duration column on running rows; without this wrapper, every
 * row's menu would re-render every tick (and the open popover would
 * visibly reconcile its children). Props are deliberately primitives or
 * stable references so the memo actually holds.
 */
// ─── live-updating leaf cells ────────────────────────────────────────
//
// Same pattern as TeamMyLogsGrid: each cell that needs the running
// timer subscribes via useLiveNowMs. The grid's `columns` array no
// longer depends on a tick prop, so the row model and the open
// action-menu don't reconcile every second.

const LiveTimeOutCell = memo(function LiveTimeOutCell({
	logs,
}: {
	logs: TaskTimeLog[];
}) {
	const safeLogs = Array.isArray(logs) ? logs : [];
	const hasRunning = safeLogs.some((log) => !log.ended_at);
	const nowMs = useLiveNowMs(hasRunning);
	const nowDate = new Date(nowMs);
	let earliestStart: Date | null = null;
	let latestEnd: Date | null = null;
	let hasValidNow = !Number.isNaN(nowDate.getTime());

	for (const log of safeLogs) {
		const startedDate = new Date(log.started_at);
		if (!Number.isNaN(startedDate.getTime())) {
			if (!earliestStart || startedDate < earliestStart) {
				earliestStart = startedDate;
			}
		}
		const endedDate = log.ended_at ? new Date(log.ended_at) : null;
		if (endedDate && !Number.isNaN(endedDate.getTime())) {
			if (!latestEnd || endedDate > latestEnd) {
				latestEnd = endedDate;
			}
		}
	}

	const effectiveEnd = hasRunning && hasValidNow ? nowDate : latestEnd;
	const hasValidEnd = Boolean(effectiveEnd);
	const isMultiDay = Boolean(
		earliestStart &&
		effectiveEnd &&
		earliestStart.toDateString() !== effectiveEnd.toDateString(),
	);

	let label: string;
	if (hasValidEnd) {
		label = isMultiDay
			? SHORT_DATE_TIME_FORMATTER.format(effectiveEnd as Date)
			: TIME_FORMATTER.format(effectiveEnd as Date);
	} else if (!hasValidNow) {
		label = "-";
	} else if (earliestStart && earliestStart.toDateString() !== nowDate.toDateString()) {
		label = SHORT_DATE_TIME_FORMATTER.format(nowDate);
	} else {
		label = TIME_FORMATTER.format(nowDate);
	}
	return <span className="tabular-nums">{label}</span>;
});

const LiveHoursCell = memo(function LiveHoursCell({
	logs,
}: {
	logs: TaskTimeLog[];
}) {
	const safeLogs = Array.isArray(logs) ? logs : [];
	const hasRunning = safeLogs.some((log) => !log.ended_at);
	const nowMs = useLiveNowMs(hasRunning);
	const totalSeconds = safeLogs.reduce(
		(sum, log) => sum + liveDurationSecondsFromLog(log, nowMs),
		0,
	);
	const hours = (totalSeconds / 3600).toFixed(2);
	return (
		<span className="text-xs font-semibold text-gray-700">{hours}</span>
	);
});

const LiveFeesCell = memo(function LiveFeesCell({
	logs,
}: {
	logs: TaskTimeLog[];
}) {
	const safeLogs = Array.isArray(logs) ? logs : [];
	const hasRunning = safeLogs.some((log) => !log.ended_at);
	const nowMs = useLiveNowMs(hasRunning);
	const totals = new Map<string, number>();

	for (const log of safeLogs) {
		const hourlyRate = Number(log.rate_snapshot ?? 0);
		if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) continue;
		const hours = liveDurationSecondsFromLog(log, nowMs) / 3600;
		const currency = log.currency_snapshot || "USD";
		const next = (totals.get(currency) ?? 0) + hours * hourlyRate;
		totals.set(currency, next);
	}

	if (totals.size === 0) {
		return <span className="text-xs font-semibold text-emerald-700">-</span>;
	}

	return (
		<div className="text-xs font-semibold text-emerald-700">
			{Array.from(totals.entries()).map(([currency, amount]) => (
				<div key={currency} className="tabular-nums">
					{amount.toFixed(2)} {currency}
				</div>
			))}
		</div>
	);
});

interface TeamApprovalsActionsCellProps {
	logIds: string[];
	logs: TaskTimeLog[];
	rowId: string;
	canApprove: boolean;
	disableReview: boolean;
	canOpenInRoadmap: boolean;
	loading: boolean;
	openMenuRowId: string | null;
	onSetOpenMenuRowId: (id: string | null) => void;
	onReviewLog: (
		logId: string,
		decision: "approved" | "rejected" | "pending",
	) => void | Promise<void>;
	onOpenTaskInRoadmap: (log: TaskTimeLog) => void;
}

const TeamApprovalsActionsCell = memo(function TeamApprovalsActionsCell({
	logIds,
	logs,
	rowId,
	canApprove,
	disableReview,
	canOpenInRoadmap,
	loading,
	openMenuRowId,
	onSetOpenMenuRowId,
	onReviewLog,
	onOpenTaskInRoadmap,
}: TeamApprovalsActionsCellProps) {
	const menuItems = useMemo<ActionMenuItem[]>(() => {
		const items: ActionMenuItem[] = [];
		if (canApprove) {
			items.push(
				{
					id: "set-approved",
					label: "Set approved",
					icon: <Check className="h-3.5 w-3.5" />,
					onSelect: () =>
						logIds.forEach((id) => void onReviewLog(id, "approved")),
					disabled: disableReview,
					tone: "success",
				},
				{
					id: "set-rejected",
					label: "Set rejected",
					icon: <X className="h-3.5 w-3.5" />,
					onSelect: () =>
						logIds.forEach((id) => void onReviewLog(id, "rejected")),
					disabled: disableReview,
					tone: "warning",
				},
				{
					id: "set-pending",
					label: "Set pending",
					icon: <RotateCcw className="h-3.5 w-3.5" />,
					onSelect: () =>
						logIds.forEach((id) => void onReviewLog(id, "pending")),
					disabled: disableReview,
				},
			);
		}
		items.push({
			id: "open-roadmap-task",
			label: "Open task in roadmap",
			icon: <ExternalLink className="h-3.5 w-3.5" />,
			onSelect: () => onOpenTaskInRoadmap(logs[0]),
			disabled: loading || !canOpenInRoadmap,
		});
		return items;
	}, [
		canApprove,
		disableReview,
		canOpenInRoadmap,
		loading,
		logIds,
		logs,
		rowId,
		onReviewLog,
		onOpenTaskInRoadmap,
	]);

	return (
		<RowActionsMenu
			rowId={rowId}
			openMenuRowId={openMenuRowId}
			onSetOpenMenuRowId={onSetOpenMenuRowId}
			items={menuItems}
			loading={loading}
		/>
	);
});

interface TeamApprovalsGridProps {
	logs: TaskTimeLog[];
	loadingLogs: boolean;
	canApprove: boolean;
	showMemberColumn?: boolean;
	currentUserId: string | null;
	selectedLogIds: Set<string>;
	rowPendingById: Record<string, boolean>;
	reviewSyncById: Record<string, boolean>;
	onToggleSelectLog: (logId: string, checked: boolean) => void;
	onToggleSelectAll: (checked: boolean, eligibleLogIds: string[]) => void;
	onReviewLog: (
		logId: string,
		decision: "approved" | "rejected" | "pending",
	) => void | Promise<void>;
	onOpenTaskInRoadmap: (log: TaskTimeLog) => void;
	canOpenTaskInRoadmap: (taskId: string | null) => boolean;
	onApproveSelected?: () => void;
	onRejectSelected?: () => void;
	onResetSelected?: () => void;
	approvingSelected?: boolean;
}

function statusBadgeClass(status: TaskTimeLog["status"]) {
	if (status === "approved") return "bg-emerald-100 text-emerald-700";
	if (status === "rejected") return "bg-rose-100 text-rose-700";
	return "bg-amber-100 text-amber-700";
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
			const estimatedMenuHeight = Math.max(140, items.length * 34 + 10);
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
		if (tone === "success") return "text-emerald-700 hover:bg-emerald-50";
		if (tone === "warning") return "text-amber-700 hover:bg-amber-50";
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
							className="fixed z-70 min-w-[200px] rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
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

function TeamApprovalsGridSkeleton() {
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

export function TeamApprovalsGrid({
	logs,
	loadingLogs,
	canApprove,
	showMemberColumn = false,
	currentUserId,
	selectedLogIds,
	rowPendingById,
	reviewSyncById,
	onToggleSelectLog,
	onToggleSelectAll,
	onReviewLog,
	onOpenTaskInRoadmap,
	canOpenTaskInRoadmap,
	onApproveSelected,
	onRejectSelected,
	onResetSelected,
	approvingSelected,
}: TeamApprovalsGridProps) {
	const [openMenuRowId, setOpenMenuRowId] = useState<string | null>(null);
	const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
	const columnsButtonRef = useRef<HTMLButtonElement | null>(null);
	const columnsMenuRef = useRef<HTMLDivElement | null>(null);
	const [columnsMenuPosition, setColumnsMenuPosition] = useState({
		top: 0,
		left: 0,
		openUpward: false,
	});

	const SELECTABLE_COLS = [
		"select",
		"date",
		...(showMemberColumn ? ["member"] : []),
		"project",
		"task_id",
		"time_in",
		"time_out",
		"hours_worked",
		"fees",
		"status",
	];

	const columnWidthClassById: Record<string, string> = {
		select: "w-[3%]",
		date: "w-[16%]",
		member: "w-[17%]",
		project: "w-[12%]",
		task_id: "w-[10%]",
		time_in: "w-[10%]",
		time_out: "w-[6%]",
		hours_worked: "w-[9%]",
		fees: "w-[11%]",
		status: "w-[6%]",
		actions: "w-[8%]",
	};

	const [columnVisibility, setColumnVisibility] = useState<
		Record<string, boolean>
	>({});

	const activeDimensionIds = useMemo<GroupDimensionId[]>(() => {
		const next: GroupDimensionId[] = [];
		if (columnVisibility.date !== false) next.push("date");
		if (showMemberColumn && columnVisibility.member !== false) next.push("member");
		if (columnVisibility.project !== false) next.push("project");
		if (columnVisibility.task_id !== false) next.push("task_id");
		return next;
	}, [columnVisibility, showMemberColumn]);

	const rows = useMemo<TeamApprovalsRow[]>(() => {
		const sortedLogs = [...logs].sort((a, b) => {
			const aMs = new Date(a.started_at).getTime();
			const bMs = new Date(b.started_at).getTime();
			return aMs - bMs;
		});

		const groupMap = new Map<string, TaskTimeLog[]>();
		for (const log of sortedLogs) {
			const dimensionValueById: Record<GroupDimensionId, string> = {
				date: makeLocalDateKey(log.started_at),
				member: log.member_user_id || "unknown-member",
				project: log.project_id || "unknown-project",
				task_id: log.task_id || "no-task",
			};
			const key =
				activeDimensionIds.length === 0
					? "__all__"
					: activeDimensionIds
							.map((dimId) => `${dimId}:${dimensionValueById[dimId]}`)
							.join("::");
			const bucket = groupMap.get(key);
			if (bucket) bucket.push(log);
			else groupMap.set(key, [log]);
		}

		const groupedRows: TeamApprovalsRow[] = [];

		for (const [key, groupLogs] of groupMap.entries()) {
			const firstLog = groupLogs[0];
			let earliestStart: Date | null = null;
			let latestEnd: Date | null = null;
			let hasValidStart = false;
			let hasValidEnd = false;
			let isRunning = false;

			for (const log of groupLogs) {
				const startedDate = new Date(log.started_at);
				if (!Number.isNaN(startedDate.getTime())) {
					hasValidStart = true;
					if (!earliestStart || startedDate < earliestStart) {
						earliestStart = startedDate;
					}
				}
				const endedDate = log.ended_at ? new Date(log.ended_at) : null;
				if (endedDate && !Number.isNaN(endedDate.getTime())) {
					hasValidEnd = true;
					if (!latestEnd || endedDate > latestEnd) {
						latestEnd = endedDate;
					}
				}
				if (!log.ended_at) isRunning = true;
			}

			const isMultiDay =
				hasValidStart &&
				hasValidEnd &&
				earliestStart &&
				latestEnd &&
				earliestStart.toDateString() !== latestEnd.toDateString();

			const dateLabel = !earliestStart
				? "-"
				: FULL_DATE_FORMATTER.format(earliestStart);

			const timeInLabel = !earliestStart
				? "-"
				: isMultiDay
					? SHORT_DATE_TIME_FORMATTER.format(earliestStart)
					: TIME_FORMATTER.format(earliestStart);

			const distinctProjectIds = new Set(
				groupLogs.map((log) => log.project_id || "unknown-project"),
			);
			const distinctTaskIds = new Set(
				groupLogs.map((log) => log.task_id || "no-task"),
			);
			const singleTaskId =
				distinctTaskIds.size === 1
					? (groupLogs[0].task_id ?? null)
					: null;
			const taskTitle =
				distinctTaskIds.size > 1
					? `${distinctTaskIds.size} tasks`
					: firstLog.task?.title ?? "-";

			const memberLabel =
				firstLog.member?.display_name ||
				[firstLog.member?.first_name, firstLog.member?.last_name]
					.filter(Boolean)
					.join(" ")
					.trim() ||
				firstLog.member?.email ||
				firstLog.member_user_id ||
				"unknown-member";

			const statusValues = new Set(groupLogs.map((log) => log.status));
			const statusValue =
				statusValues.size === 1
					? (groupLogs[0].status as TaskTimeLog["status"])
					: "mixed";

			const eligibleLogIds = groupLogs
				.filter((log) => {
					const isSelf =
						currentUserId !== null && log.member_user_id === currentUserId;
					return !isSelf && Boolean(log.ended_at);
				})
				.map((log) => log.id);

			groupedRows.push({
				id: key,
				logIds: groupLogs.map((log) => log.id),
				logs: groupLogs,
				date: dateLabel,
				member_label: memberLabel,
				project_label:
					distinctProjectIds.size > 1
						? `${distinctProjectIds.size} projects`
						: firstLog.project?.title || firstLog.project_id || "unknown-project",
				task_id: singleTaskId,
				task_title: taskTitle,
				time_in: timeInLabel,
				status: statusValue,
				is_running: isRunning,
				is_self:
					currentUserId !== null && firstLog.member_user_id === currentUserId,
				eligibleLogIds,
			});
		}

		return groupedRows;
	}, [activeDimensionIds, logs, currentUserId]);

	const columnHelper = createColumnHelper<TeamApprovalsRow>();
	const eligibleLogIds = useMemo(() => {
		const next = new Set<string>();
		for (const row of rows) {
			for (const logId of row.eligibleLogIds) {
				next.add(logId);
			}
		}
		return Array.from(next);
	}, [rows]);
	const allEligibleSelected =
		eligibleLogIds.length > 0 &&
		eligibleLogIds.every((id) => selectedLogIds.has(id));
	const someEligibleSelected =
		eligibleLogIds.some((id) => selectedLogIds.has(id)) &&
		!allEligibleSelected;

	const columns = useMemo(
		() => [
			columnHelper.display({
				id: "select",
				header: () =>
					canApprove ? (
						<input
							type="checkbox"
							aria-label="Select all eligible logs"
							checked={allEligibleSelected}
							ref={(el) => {
								if (el) el.indeterminate = someEligibleSelected;
							}}
							disabled={eligibleLogIds.length === 0}
							onChange={(event) =>
								onToggleSelectAll(event.currentTarget.checked, eligibleLogIds)
							}
							className="h-3.5 w-3.5 rounded border-gray-300"
						/>
					) : null,
				cell: (info) => {
					const row = info.row.original;
					if (!canApprove) return null;
					const eligibleIds = row.eligibleLogIds;
					const isEligible = eligibleIds.length > 0;
					const isChecked =
						isEligible &&
						eligibleIds.every((id) => selectedLogIds.has(id));
					const isIndeterminate =
						isEligible &&
						eligibleIds.some((id) => selectedLogIds.has(id)) &&
						!isChecked;
					const isPending = row.logIds.some((id) => rowPendingById[id]);
					return (
						<input
							type="checkbox"
							aria-label="Select log row"
							checked={isChecked}
							ref={(el) => {
								if (el) el.indeterminate = isIndeterminate;
							}}
							disabled={!isEligible || isPending}
							title={
								row.is_self
									? "You cannot review your own logs."
									: row.is_running
										? "Running logs are skipped."
										: undefined
							}
							onChange={(event) =>
								eligibleIds.forEach((id) =>
									onToggleSelectLog(id, event.currentTarget.checked),
								)
							}
							className="h-3.5 w-3.5 rounded border-gray-300"
						/>
					);
				},
			}),
			columnHelper.accessor("date", {
				id: "date",
				header: "Dates",
				cell: (info) => info.getValue(),
			}),
			...(showMemberColumn
				? [
						columnHelper.accessor("member_label", {
							id: "member",
							header: "Member",
							cell: (info) => (
								<span className="block truncate" title={info.getValue()}>
									{info.getValue()}
								</span>
							),
						}),
					]
				: []),
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
					return (
						<span className="block truncate" title={row.task_title}>
							{row.task_title || "-"}
						</span>
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
				cell: (info) => <LiveTimeOutCell logs={info.row.original.logs} />,
			}),
			columnHelper.display({
				id: "hours_worked",
				header: "Hours",
				cell: (info) => <LiveHoursCell logs={info.row.original.logs} />,
			}),
			columnHelper.display({
				id: "fees",
				header: "Fees",
				cell: (info) => <LiveFeesCell logs={info.row.original.logs} />,
			}),
			columnHelper.accessor("status", {
				id: "status",
				header: "Status",
				cell: (info) => {
					const row = info.row.original;
					const status = row.status;
					const syncing = row.logIds.some(
						(id) => rowPendingById[id] || reviewSyncById[id],
					);
					// While running, the review status (always 'pending' until
					// the log is stopped) is noise — collapse to one badge.
					return (
						<div className="flex items-center gap-1">
							{row.is_running ? (
								<span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-700">
									running
								</span>
							) : (
								<span
									className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
										status === "mixed"
											? "bg-slate-100 text-slate-700"
											: statusBadgeClass(status)
									}`}
								>
									{status}
								</span>
							)}
							{syncing && (
								<Loader2
									className="h-3.5 w-3.5 animate-spin text-[#b35f00]"
									aria-label="Review syncing"
								/>
							)}
						</div>
					);
				},
			}),
			columnHelper.display({
				id: "actions",
				header: "Actions",
				cell: (info) => {
					const row = info.row.original;
					const isPending = row.logIds.some((id) => rowPendingById[id]);
					const isReviewSyncing = row.logIds.some((id) => reviewSyncById[id]);
					return (
						<TeamApprovalsActionsCell
							logIds={row.logIds}
							logs={row.logs}
							rowId={row.id}
							canApprove={canApprove}
							disableReview={
								row.is_running ||
								row.is_self ||
								isPending ||
								isReviewSyncing
							}
							canOpenInRoadmap={canOpenTaskInRoadmap(row.task_id)}
							loading={isPending || isReviewSyncing}
							openMenuRowId={openMenuRowId}
							onSetOpenMenuRowId={setOpenMenuRowId}
							onReviewLog={onReviewLog}
							onOpenTaskInRoadmap={onOpenTaskInRoadmap}
						/>
					);
				},
			}),
		],
		[
			allEligibleSelected,
			canApprove,
			canOpenTaskInRoadmap,
			columnHelper,
			eligibleLogIds,
			onOpenTaskInRoadmap,
			onReviewLog,
			onToggleSelectAll,
			onToggleSelectLog,
			openMenuRowId,
			reviewSyncById,
			rowPendingById,
			selectedLogIds,
			showMemberColumn,
			someEligibleSelected,
		],
	);

	const columnOptions = useMemo<ColumnOption[]>(() => {
		const base: ColumnOption[] = [
			{ id: "date", label: "Dates", canHide: true },
			{ id: "member", label: "Member", canHide: true },
			{ id: "project", label: "Project", canHide: true },
			{ id: "task_id", label: "Task", canHide: true },
			{ id: "time_in", label: "Time-in", canHide: true },
			{ id: "time_out", label: "Time-out", canHide: true },
			{ id: "hours_worked", label: "Hours", canHide: true },
			{ id: "fees", label: "Fees", canHide: true },
			{ id: "status", label: "Status", canHide: true },
		];
		if (!showMemberColumn) {
			return base.filter((col) => col.id !== "member");
		}
		return base;
	}, [showMemberColumn]);

	const table = useReactTable({
		data: rows,
		columns,
		getCoreRowModel: getCoreRowModel(),
		state: { columnVisibility },
		onColumnVisibilityChange: setColumnVisibility,
	});

	const tableRef = useRef<HTMLTableElement | null>(null);
	const orderedRowIds = table.getRowModel().rows.map((r) => r.original.id);
	const selectableColIdSet = useMemo(
		() => new Set(SELECTABLE_COLS),
		[SELECTABLE_COLS],
	);
	const orderedSelectableColIds = useMemo(
		() =>
			table
				.getVisibleLeafColumns()
				.map((col) => col.id)
				.filter((colId) => selectableColIdSet.has(colId)),
		[table, selectableColIdSet, columnVisibility],
	);

	// Stable refs used inside callbacks so they never go stale
	const rowsRef = useRef(rows);
	rowsRef.current = rows;
	const selectedLogIdsRef = useRef(selectedLogIds);
	selectedLogIdsRef.current = selectedLogIds;
	const rowPendingByIdRef = useRef(rowPendingById);
	rowPendingByIdRef.current = rowPendingById;
	const onToggleSelectLogRef = useRef(onToggleSelectLog);
	onToggleSelectLogRef.current = onToggleSelectLog;
	const onToggleSelectAllRef = useRef(onToggleSelectAll);
	onToggleSelectAllRef.current = onToggleSelectAll;

	const { selectedCells, isSelected, getCellDataProps } =
		useTableCellSelection(orderedRowIds, orderedSelectableColIds, tableRef, {
			// Fires on every drag frame — auto-check eligible "select" column cells immediately
			onLiveSelectionChange(cells) {
				for (const key of cells) {
					const [rowId, colId] = key.split(":");
					if (colId !== "select") continue;
					const row = rowsRef.current.find((candidate) => candidate.id === rowId);
					if (!row) continue;
					for (const logId of row.eligibleLogIds) {
						if (
							selectedLogIdsRef.current.has(logId) ||
							rowPendingByIdRef.current[logId]
						)
							continue;
						onToggleSelectLogRef.current(logId, true);
					}
				}
			},
			// Click outside table → clear both highlights and checkbox selections
			onClickOutside() {
				onToggleSelectAllRef.current(false, []);
			},
		});

	const rowIdToLogIds = useMemo(() => {
		const next: Record<string, string[]> = {};
		for (const row of rows) next[row.id] = row.logIds;
		return next;
	}, [rows]);

	useEffect(() => {
		if (!columnsMenuOpen) return;
		const updatePosition = () => {
			if (!columnsButtonRef.current) return;
			const rect = columnsButtonRef.current.getBoundingClientRect();
			const estimatedHeight = Math.max(140, columnOptions.length * 32 + 16);
			const openUpward =
				rect.bottom + estimatedHeight > window.innerHeight - 12;
			setColumnsMenuPosition({
				top: openUpward ? rect.top - 6 : rect.bottom + 6,
				left: rect.right,
				openUpward,
			});
		};
		const handlePointer = (event: MouseEvent) => {
			const target = event.target as Node;
			const inTrigger = columnsButtonRef.current?.contains(target);
			const inMenu = columnsMenuRef.current?.contains(target);
			if (!inTrigger && !inMenu) setColumnsMenuOpen(false);
		};
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setColumnsMenuOpen(false);
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
	}, [columnOptions.length, columnsMenuOpen]);

	if (loadingLogs) return <TeamApprovalsGridSkeleton />;

	return (
		<>
		{(selectedCells.size > 0 || selectedLogIds.size > 0) &&
			createPortal(
				<div className="fixed top-4 right-4 z-50 flex flex-row-reverse items-start gap-3">
					{selectedCells.size > 0 && (
						<CellSelectionScoreboard
							selectedCells={selectedCells}
							logs={logs}
							rowIdToLogIds={rowIdToLogIds}
							asPortal={false}
						/>
					)}
					{selectedLogIds.size > 0 && onApproveSelected && (
						<div className="min-w-40 rounded-xl border border-black bg-white shadow-lg p-3 space-y-3">
							<div className="flex items-center justify-between border-b border-black pb-2">
								<span className="text-[11px] font-bold text-black uppercase tracking-widest">
									Approval
								</span>
								<span className="text-[10px] text-slate-500">
									{selectedLogIds.size}{" "}
									{selectedLogIds.size === 1 ? "row" : "rows"}
								</span>
							</div>
							<div className="space-y-1.5">
								<button
									onClick={onApproveSelected}
									disabled={approvingSelected}
									className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-50"
								>
									<Check className="h-3.5 w-3.5 shrink-0" />
									Approve
								</button>
								<button
									onClick={onRejectSelected}
									disabled={approvingSelected}
									className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 transition-colors disabled:opacity-50"
								>
									<X className="h-3.5 w-3.5 shrink-0" />
									Reject
								</button>
								<button
									onClick={onResetSelected}
									disabled={approvingSelected}
									className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
								>
									<RotateCcw className="h-3.5 w-3.5 shrink-0" />
									Reset
								</button>
							</div>
						</div>
					)}
				</div>,
				document.body,
			)}
		<div className="flex items-center justify-end pb-2">
			<button
				ref={columnsButtonRef}
				type="button"
				onClick={() => setColumnsMenuOpen((open) => !open)}
				className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
			>
				<Settings2 className="h-3.5 w-3.5" />
				Edit columns
			</button>
			{columnsMenuOpen
				? createPortal(
						<div
							ref={columnsMenuRef}
							className="fixed z-70 min-w-[200px] rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
							style={{
								top: columnsMenuPosition.top,
								left: columnsMenuPosition.left,
								transform: columnsMenuPosition.openUpward
									? "translate(-100%, -100%)"
									: "translateX(-100%)",
							}}
						>
							<div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
								Columns
							</div>
							<div className="space-y-1">
								{columnOptions.map((option) => {
									const column = table.getColumn(option.id);
									const isVisible = column?.getIsVisible() ?? true;
									const canHide = option.canHide !== false;
									return (
										<label
											key={option.id}
											className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs text-slate-700 ${
												canHide ? "hover:bg-slate-50" : "opacity-60"
											}`}
										>
											<span>{option.label}</span>
											<input
												type="checkbox"
												checked={isVisible}
												disabled={!canHide}
												onChange={(event) =>
													column?.toggleVisibility(event.currentTarget.checked)
												}
												className="h-3 w-3 rounded border-gray-300"
											/>
										</label>
									);
								})}
							</div>
						</div>,
						document.body,
					)
				: null}
		</div>
		<div className="rounded-xl border border-gray-200 bg-white overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
			<table
				ref={tableRef}
				className="w-full min-w-[1100px] table-fixed text-[11px] select-none"
			>
				<colgroup>
					{table.getVisibleLeafColumns().map((col) => (
						<col
							key={col.id}
							className={columnWidthClassById[col.id] ?? "w-auto"}
						/>
					))}
				</colgroup>
				<thead className="bg-slate-900 text-white">
					{table.getHeaderGroups().map((headerGroup) => (
						<tr key={headerGroup.id}>
							{headerGroup.headers.map((header) => {
								const isSticky = header.column.id === "select";
								return (
									<th
										key={header.id}
										className={`px-2 py-2.5 text-left text-sm font-bold border-r border-white/30 last:border-r-0 ${
											isSticky ? "sticky left-0 z-20 bg-slate-900" : ""
										}`}
									>
										{header.isPlaceholder
											? null
											: flexRender(
													header.column.columnDef.header,
													header.getContext(),
												)}
									</th>
								);
							})}
						</tr>
					))}
				</thead>
				<tbody>
					{rows.length === 0 ? (
						<tr className="border-t border-gray-200">
							<td
								colSpan={table.getVisibleLeafColumns().length}
								className="px-6 py-20"
							>
								<div className="mx-auto flex max-w-sm flex-col items-center text-center">
									<div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
										<ClipboardCheck className="h-7 w-7 text-slate-500" />
									</div>
									<h3 className="text-base font-semibold text-slate-900">
										Nothing to review
									</h3>
									<p className="mt-2 text-sm text-slate-500">
										When this member logs time, the entries will appear here
										for you to approve, reject, or send back to pending.
									</p>
									<p className="mt-3 text-sm text-slate-500">
										Try adjusting the status or project filters above to look
										at older logs.
									</p>
								</div>
							</td>
						</tr>
					) : (
						table.getRowModel().rows.map((row) => {
							const pending = row.original.logIds.some(
								(id) => rowPendingById[id],
							);
							return (
								<tr
									key={row.id}
									className={`border-t border-gray-200 ${
										pending ? "bg-amber-50/40" : ""
									}`}
								>
									{row.getVisibleCells().map((cell) => {
										const colId = cell.column.id;
										const isSticky = colId === "select";
										const selectable = SELECTABLE_COLS.includes(colId);
										const selected =
											selectable && isSelected(row.original.id, colId);
										return (
											<td
												key={cell.id}
												className={`px-2 py-1.5 align-middle ${
													isSticky
														? `sticky left-0 z-10 ${pending ? "bg-amber-50" : "bg-white"}`
														: selectable && selected
															? "bg-blue-100"
															: ""
												} ${selectable ? "cursor-cell" : ""}`}
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
							);
						})
					)}
				</tbody>
			</table>
		</div>
		</>
	);
}
