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
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
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
	date: string;
	project_label: string;
	task_id: string | null;
	task_title: string;
	time_in: string;
	status: TaskTimeLog["status"];
	is_running: boolean;
	is_self: boolean;
	log: TaskTimeLog;
};

type MenuTone = "default" | "success" | "warning" | "danger";

type ActionMenuItem = {
	id: string;
	label: string;
	icon: ReactNode;
	onSelect: () => void;
	disabled?: boolean;
	tone?: MenuTone;
};

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
	return (
		<span className="text-xs font-semibold text-gray-700">{hours}</span>
	);
});

const LiveFeesCell = memo(function LiveFeesCell({
	log,
}: {
	log: TaskTimeLog;
}) {
	const isRunning = !log.ended_at;
	const nowMs = useLiveNowMs(isRunning);
	const hourlyRate = Number(log.rate_snapshot ?? 0);
	if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
		return <span className="text-xs font-semibold text-emerald-700">-</span>;
	}
	const hours = liveDurationSecondsFromLog(log, nowMs) / 3600;
	const currency = log.currency_snapshot || "USD";
	return (
		<span className="text-xs font-semibold text-emerald-700">
			{(hours * hourlyRate).toFixed(2)} {currency}
		</span>
	);
});

interface TeamApprovalsActionsCellProps {
	log: TaskTimeLog;
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
	log,
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
					onSelect: () => void onReviewLog(rowId, "approved"),
					disabled: disableReview,
					tone: "success",
				},
				{
					id: "set-rejected",
					label: "Set rejected",
					icon: <X className="h-3.5 w-3.5" />,
					onSelect: () => void onReviewLog(rowId, "rejected"),
					disabled: disableReview,
					tone: "warning",
				},
				{
					id: "set-pending",
					label: "Set pending",
					icon: <RotateCcw className="h-3.5 w-3.5" />,
					onSelect: () => void onReviewLog(rowId, "pending"),
					disabled: disableReview,
				},
			);
		}
		items.push({
			id: "open-roadmap-task",
			label: "Open task in roadmap",
			icon: <ExternalLink className="h-3.5 w-3.5" />,
			onSelect: () => onOpenTaskInRoadmap(log),
			disabled: loading || !canOpenInRoadmap,
		});
		return items;
	}, [
		canApprove,
		disableReview,
		canOpenInRoadmap,
		loading,
		log,
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

interface TeamApprovalsGridProps {
	logs: TaskTimeLog[];
	loadingLogs: boolean;
	canApprove: boolean;
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

export function TeamApprovalsGrid({
	logs,
	loadingLogs,
	canApprove,
	currentUserId,
	selectedLogIds,
	rowPendingById,
	reviewSyncById,
	onToggleSelectLog,
	onToggleSelectAll,
	onReviewLog,
	onOpenTaskInRoadmap,
	canOpenTaskInRoadmap,
}: TeamApprovalsGridProps) {
	const [openMenuRowId, setOpenMenuRowId] = useState<string | null>(null);

	const rows = useMemo<TeamApprovalsRow[]>(() => {
		const sortedLogs = [...logs].sort((a, b) => {
			const aMs = new Date(a.started_at).getTime();
			const bMs = new Date(b.started_at).getTime();
			return aMs - bMs;
		});

		// Static fields only — anything that needs the running timer is
		// computed inside the live cell components below.
		return sortedLogs.map<TeamApprovalsRow>((log) => {
			const startedDate = new Date(log.started_at);
			const endedDate = log.ended_at ? new Date(log.ended_at) : null;
			const hasValidStart = !Number.isNaN(startedDate.getTime());
			const hasValidEnd = Boolean(
				endedDate && !Number.isNaN(endedDate.getTime()),
			);
			const endedDateValue: Date | undefined = hasValidEnd
				? (endedDate as Date)
				: undefined;
			const isMultiDay =
				hasValidStart &&
				hasValidEnd &&
				startedDate.toDateString() !== endedDateValue?.toDateString();

			return {
				id: log.id,
				date: !hasValidStart
					? "-"
					: isMultiDay
						? `${SHORT_DATE_FORMATTER.format(startedDate)} - ${SHORT_DATE_FORMATTER.format(endedDateValue as Date)}`
						: FULL_DATE_FORMATTER.format(startedDate),
				project_label: log.project?.title || log.project_id,
				task_id: log.task_id,
				task_title: log.task?.title ?? "-",
				time_in: !hasValidStart
					? "-"
					: isMultiDay
						? SHORT_DATE_TIME_FORMATTER.format(startedDate)
						: TIME_FORMATTER.format(startedDate),
				status: log.status,
				is_running: !log.ended_at,
				is_self: currentUserId !== null && log.member_user_id === currentUserId,
				log,
			};
		});
	}, [logs, currentUserId]);

	const columnHelper = createColumnHelper<TeamApprovalsRow>();
	// Self-rows are not eligible for selection (caller can't review own logs).
	const eligibleRowIds = useMemo(
		() =>
			rows
				.filter((row) => !row.is_running && !row.is_self)
				.map((row) => row.id),
		[rows],
	);
	const allEligibleSelected =
		eligibleRowIds.length > 0 &&
		eligibleRowIds.every((id) => selectedLogIds.has(id));
	const someEligibleSelected =
		eligibleRowIds.some((id) => selectedLogIds.has(id)) &&
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
							disabled={eligibleRowIds.length === 0}
							onChange={(event) =>
								onToggleSelectAll(event.currentTarget.checked, eligibleRowIds)
							}
							className="h-3.5 w-3.5 rounded border-gray-300"
						/>
					) : null,
				cell: (info) => {
					const row = info.row.original;
					if (!canApprove) return null;
					const isEligible = !row.is_running && !row.is_self;
					return (
						<input
							type="checkbox"
							aria-label="Select log row"
							checked={selectedLogIds.has(row.id)}
							disabled={!isEligible || rowPendingById[row.id]}
							title={
								row.is_self
									? "You cannot review your own logs."
									: row.is_running
										? "Running logs cannot be reviewed."
										: undefined
							}
							onChange={(event) =>
								onToggleSelectLog(row.id, event.currentTarget.checked)
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
				cell: (info) => <LiveFeesCell log={info.row.original.log} />,
			}),
			columnHelper.accessor("status", {
				id: "status",
				header: "Status",
				cell: (info) => {
					const row = info.row.original;
					const syncing =
						rowPendingById[row.id] || reviewSyncById[row.id];
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
									className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusBadgeClass(
										info.getValue(),
									)}`}
								>
									{info.getValue()}
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
					const isPending = Boolean(rowPendingById[row.id]);
					const isReviewSyncing = Boolean(reviewSyncById[row.id]);
					return (
						<TeamApprovalsActionsCell
							log={row.log}
							rowId={row.id}
							canApprove={canApprove}
							disableReview={
								row.is_running ||
								row.is_self ||
								isPending ||
								isReviewSyncing
							}
							canOpenInRoadmap={canOpenTaskInRoadmap(row.log.task_id)}
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
			eligibleRowIds,
			onOpenTaskInRoadmap,
			onReviewLog,
			onToggleSelectAll,
			onToggleSelectLog,
			openMenuRowId,
			reviewSyncById,
			rowPendingById,
			selectedLogIds,
			someEligibleSelected,
		],
	);

	const table = useReactTable({
		data: rows,
		columns,
		getCoreRowModel: getCoreRowModel(),
	});

	if (loadingLogs) return <TeamApprovalsGridSkeleton />;

	return (
		<div className="rounded-xl border border-gray-200 bg-white overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
			<table className="w-full min-w-[1100px] table-fixed text-[11px]">
				<colgroup>
					<col className="w-[3%]" />
					<col className="w-[16%]" />
					<col className="w-[17%]" />
					<col className="w-[12%]" />
					<col className="w-[10%]" />
					<col className="w-[10%]" />
					<col className="w-[6%]" />
					<col className="w-[9%]" />
					<col className="w-[11%]" />
					<col className="w-[6%]" />
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
							<td colSpan={10} className="px-6 py-20">
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
							const pending = Boolean(rowPendingById[row.original.id]);
							return (
								<tr
									key={row.id}
									className={`border-t border-gray-200 ${
										pending ? "bg-amber-50/40" : ""
									}`}
								>
									{row.getVisibleCells().map((cell) => {
										const isSticky = cell.column.id === "select";
										return (
											<td
												key={cell.id}
												className={`px-2 py-1.5 align-middle ${
													isSticky
														? `sticky left-0 z-10 ${pending ? "bg-amber-50" : "bg-white"}`
														: ""
												}`}
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
	);
}
