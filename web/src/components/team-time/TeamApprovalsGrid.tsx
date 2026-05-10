import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
	Check,
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
import { liveDurationSecondsFromLog } from "./time-utils";

type TeamApprovalsRow = {
	id: string;
	is_placeholder?: boolean;
	date: string;
	project_label: string;
	task_id: string;
	task_title: string;
	time_in: string;
	time_out: string;
	hours_worked: number;
	fees: number | null;
	currency: string;
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
	timerNowMs: number;
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
	canOpenTaskInRoadmap: (taskId: string) => boolean;
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
	timerNowMs,
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
	const shortDateFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(undefined, {
				month: "short",
				day: "numeric",
				year: "numeric",
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

	const rows = useMemo<TeamApprovalsRow[]>(() => {
		const sortedLogs = [...logs].sort((a, b) => {
			const aMs = new Date(a.started_at).getTime();
			const bMs = new Date(b.started_at).getTime();
			return aMs - bMs;
		});

		const populatedRows: TeamApprovalsRow[] = sortedLogs.map((log) => {
			const liveSeconds = liveDurationSecondsFromLog(log, timerNowMs);
			const hoursWorked = Number((liveSeconds / 3600).toFixed(2));
			const hourlyRate = Number(log.rate_snapshot ?? 0);
			const fees =
				Number.isFinite(hourlyRate) && hourlyRate > 0
					? Number((hoursWorked * hourlyRate).toFixed(2))
					: null;

			const startedDate = new Date(log.started_at);
			const endedDate = log.ended_at ? new Date(log.ended_at) : null;
			const nowDate = new Date(timerNowMs);
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

			return {
				id: log.id,
				date: !hasValidStart
					? "-"
					: isMultiDay
						? `${shortDateFormatter.format(startedDate)} - ${shortDateFormatter.format(endedDateValue as Date)}`
						: fullDateFormatter.format(startedDate),
				project_label: log.project?.title || log.project_id,
				task_id: log.task_id,
				task_title: log.task?.title ?? "Task",
				time_in: !hasValidStart
					? "-"
					: isMultiDay
						? shortDateTimeFormatter.format(startedDate)
						: timeFormatter.format(startedDate),
				time_out: hasValidEnd
					? isMultiDay
						? shortDateTimeFormatter.format(endedDateValue as Date)
						: timeFormatter.format(endedDateValue as Date)
					: !hasValidNow
						? "-"
						: hasValidStart &&
								startedDate.toDateString() !== nowDate.toDateString()
							? shortDateTimeFormatter.format(nowDate)
							: timeFormatter.format(nowDate),
				hours_worked: hoursWorked,
				fees,
				currency: log.currency_snapshot || "USD",
				status: log.status,
				is_running: !log.ended_at,
				is_self: currentUserId !== null && log.member_user_id === currentUserId,
				log,
			};
		});

		const minimumRows = Math.max(4, populatedRows.length);
		if (populatedRows.length >= minimumRows) return populatedRows;

		const emptyCount = minimumRows - populatedRows.length;
		const emptyRows: TeamApprovalsRow[] = Array.from({ length: emptyCount }).map(
			(_, idx) => ({
				id: `empty-${idx}`,
				is_placeholder: true,
				date: "",
				project_label: "",
				task_id: "",
				task_title: "",
				time_in: "",
				time_out: "",
				hours_worked: 0,
				fees: null,
				currency: "USD",
				status: "pending",
				is_running: false,
				is_self: false,
				log: null as unknown as TaskTimeLog,
			}),
		);
		return [...populatedRows, ...emptyRows];
	}, [
		logs,
		timerNowMs,
		shortDateFormatter,
		fullDateFormatter,
		shortDateTimeFormatter,
		timeFormatter,
		currentUserId,
	]);

	const columnHelper = createColumnHelper<TeamApprovalsRow>();
	// Self-rows are not eligible for selection (caller can't review own logs).
	const eligibleRowIds = useMemo(
		() =>
			rows
				.filter(
					(row) => !row.is_placeholder && !row.is_running && !row.is_self,
				)
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
					if (row.is_placeholder || !canApprove) return null;
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
				cell: (info) =>
					info.row.original.is_placeholder ? null : info.getValue(),
			}),
			columnHelper.accessor("project_label", {
				id: "project",
				header: "Project",
				cell: (info) =>
					info.row.original.is_placeholder ? null : (
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
					if (row.is_placeholder) return null;
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
				cell: (info) =>
					info.row.original.is_placeholder ? null : (
						<span className="tabular-nums">{info.getValue()}</span>
					),
			}),
			columnHelper.accessor("time_out", {
				id: "time_out",
				header: "Time-Out",
				cell: (info) =>
					info.row.original.is_placeholder ? null : (
						<span className="tabular-nums">{info.getValue()}</span>
					),
			}),
			columnHelper.accessor("hours_worked", {
				id: "hours_worked",
				header: "Hours",
				cell: (info) => {
					const row = info.row.original;
					if (row.is_placeholder) return null;
					return (
						<span className="text-xs font-semibold text-gray-700">
							{row.hours_worked.toFixed(2)}
						</span>
					);
				},
			}),
			columnHelper.accessor("fees", {
				id: "fees",
				header: "Fees",
				cell: (info) => {
					const row = info.row.original;
					if (row.is_placeholder) return null;
					return (
						<span className="text-xs font-semibold text-emerald-700">
							{row.fees === null
								? "-"
								: `${row.fees.toFixed(2)} ${row.currency}`}
						</span>
					);
				},
			}),
			columnHelper.accessor("status", {
				id: "status",
				header: "Status",
				cell: (info) => {
					const row = info.row.original;
					if (row.is_placeholder) return null;
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
							{(rowPendingById[row.id] || reviewSyncById[row.id]) && (
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
					if (row.is_placeholder) return null;

					const isPending = Boolean(rowPendingById[row.id]);
					const isReviewSyncing = Boolean(reviewSyncById[row.id]);
					const disableReview =
						row.is_running || row.is_self || isPending || isReviewSyncing;
					const canOpenInRoadmap = canOpenTaskInRoadmap(row.log.task_id);

					const menuItems: ActionMenuItem[] = [];
					if (canApprove) {
						menuItems.push(
							{
								id: "set-approved",
								label: "Set approved",
								icon: <Check className="h-3.5 w-3.5" />,
								onSelect: () => void onReviewLog(row.id, "approved"),
								disabled: disableReview,
								tone: "success",
							},
							{
								id: "set-rejected",
								label: "Set rejected",
								icon: <X className="h-3.5 w-3.5" />,
								onSelect: () => void onReviewLog(row.id, "rejected"),
								disabled: disableReview,
								tone: "warning",
							},
							{
								id: "set-pending",
								label: "Set pending",
								icon: <RotateCcw className="h-3.5 w-3.5" />,
								onSelect: () => void onReviewLog(row.id, "pending"),
								disabled: disableReview,
							},
						);
					}
					menuItems.push({
						id: "open-roadmap-task",
						label: "Open task in roadmap",
						icon: <ExternalLink className="h-3.5 w-3.5" />,
						onSelect: () => onOpenTaskInRoadmap(row.log),
						disabled: isPending || !canOpenInRoadmap,
					});

					return (
						<RowActionsMenu
							rowId={row.id}
							openMenuRowId={openMenuRowId}
							onSetOpenMenuRowId={setOpenMenuRowId}
							items={menuItems}
							loading={isPending || isReviewSyncing}
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
		<div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
			<table className="w-full table-fixed text-[11px]">
				<colgroup>
					<col className="w-[3%]" />
					<col className="w-[15%]" />
					<col className="w-[16%]" />
					<col className="w-[18%]" />
					<col className="w-[10%]" />
					<col className="w-[10%]" />
					<col className="w-[6%]" />
					<col className="w-[8%]" />
					<col className="w-[10%]" />
					<col className="w-[4%]" />
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
					{table.getRowModel().rows.map((row) => (
						<tr
							key={row.id}
							className={`border-t border-gray-200 ${
								!row.original.is_placeholder &&
								rowPendingById[row.original.id]
									? "bg-amber-50/40"
									: ""
							}`}
						>
							{row.getVisibleCells().map((cell) => (
								<td key={cell.id} className="px-2 py-1.5 align-middle">
									{flexRender(cell.column.columnDef.cell, cell.getContext())}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
