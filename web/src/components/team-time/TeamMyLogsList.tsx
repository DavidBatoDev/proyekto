import {
	ExternalLink,
	FolderKanban,
	Pencil,
	Play,
	Square,
	Timer,
	Trash2,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import type {
	ProjectTaskOption,
	TaskTimeLog,
} from "@/services/team-time.service";
import { type ActionMenuItem, RowActionsMenu } from "./RowActionsMenu";
import {
	formatMoney,
	initialsFromName,
	liveDurationSecondsFromLog,
	statusBadgeClass,
	useLiveNowMs,
} from "./time-utils";

const DAY_HEADER_FORMATTER = new Intl.DateTimeFormat(undefined, {
	weekday: "long",
	month: "long",
	day: "numeric",
});
const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
});
const SHORT_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

function toLocalDayKey(value: string): string | null {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return null;
	const yyyy = parsed.getFullYear();
	const mm = String(parsed.getMonth() + 1).padStart(2, "0");
	const dd = String(parsed.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

function isMemberReadOnlyStatus(status: TaskTimeLog["status"]): boolean {
	return status === "approved" || status === "rejected";
}

interface DayGroup {
	key: string;
	label: string;
	logs: TaskTimeLog[];
	hasRunning: boolean;
}

interface TeamMyLogsListProps {
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

export function TeamMyLogsList({
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
}: TeamMyLogsListProps) {
	const [openMenuRowId, setOpenMenuRowId] = useState<string | null>(null);

	const hasActiveLog = useMemo(() => logs.some((l) => !l.ended_at), [logs]);

	const taskTitleById = useMemo(() => {
		const map = new Map<string, string>();
		for (const task of tasks) map.set(task.id, task.title || "Untitled task");
		return map;
	}, [tasks]);

	const days = useMemo<DayGroup[]>(() => {
		const byDay = new Map<string, TaskTimeLog[]>();
		for (const log of logs) {
			const key = toLocalDayKey(log.started_at) ?? "unknown";
			const bucket = byDay.get(key);
			if (bucket) bucket.push(log);
			else byDay.set(key, [log]);
		}
		const groups: DayGroup[] = [];
		for (const [key, dayLogs] of byDay.entries()) {
			dayLogs.sort(
				(a, b) =>
					new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
			);
			const first = dayLogs[0];
			const parsed = new Date(first.started_at);
			groups.push({
				key,
				label: Number.isNaN(parsed.getTime())
					? "Undated"
					: DAY_HEADER_FORMATTER.format(parsed),
				logs: dayLogs,
				hasRunning: dayLogs.some((l) => !l.ended_at),
			});
		}
		// Newest day first.
		groups.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
		return groups;
	}, [logs]);

	if (loadingLogs) return <MyLogsListSkeleton />;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold text-slate-700">Activity</h3>
				<button
					type="button"
					onClick={onOpenAddLog}
					className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
				>
					<Play className="h-3.5 w-3.5" />
					Start a timer
				</button>
			</div>

			{days.length === 0 ? (
				<button
					type="button"
					onClick={onOpenAddLog}
					className="flex w-full flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center hover:border-sky-300 hover:bg-sky-50/40"
				>
					<div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
						<Timer className="h-6 w-6 text-slate-500" />
					</div>
					<h3 className="text-base font-semibold text-slate-900">
						No time logged yet
					</h3>
					<p className="mt-2 max-w-sm text-sm text-slate-500">
						Start a timer to log time on a task. Each log freezes your current
						rate.
					</p>
				</button>
			) : (
				days.map((day) => (
					<section key={day.key}>
						<div className="mb-1.5 flex items-center justify-between px-1">
							<span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
								{day.label}
							</span>
							<DayTotal logs={day.logs} active={day.hasRunning} />
						</div>
						<div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
							{day.logs.map((log) => (
								<MyLogTxnRow
									key={log.id}
									log={log}
									taskTitleById={taskTitleById}
									fallbackRate={ownRateByProjectId[log.project_id]}
									isRowPending={Boolean(rowPendingById[log.id])}
									taskSyncing={Boolean(taskSyncById[log.id])}
									hasActiveLog={hasActiveLog}
									loadingTasks={loadingTasks}
									openMenuRowId={openMenuRowId}
									onSetOpenMenuRowId={setOpenMenuRowId}
									onStopLog={onStopLog}
									onOpenTaskModal={onOpenTaskModal}
									onEditLog={onEditLog}
									onDeleteLog={onDeleteLog}
									onOpenTaskInRoadmap={onOpenTaskInRoadmap}
									canOpenInRoadmap={canOpenTaskInRoadmap(log.task_id)}
								/>
							))}
						</div>
					</section>
				))
			)}
		</div>
	);
}

const DayTotal = memo(function DayTotal({
	logs,
	active,
}: {
	logs: TaskTimeLog[];
	active: boolean;
}) {
	const nowMs = useLiveNowMs(active);
	const totalSeconds = logs.reduce(
		(sum, log) => sum + liveDurationSecondsFromLog(log, nowMs),
		0,
	);
	const hours = totalSeconds / 3600;
	const isOver = hours > 8;
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
				isOver
					? "border-rose-200 bg-rose-50 text-rose-700"
					: "border-slate-200 bg-slate-50 text-slate-600"
			}`}
			title={isOver ? "Over 8 hours logged this day" : "Day total"}
		>
			{hours.toFixed(2)}h
		</span>
	);
});

const MyLogTxnRow = memo(function MyLogTxnRow({
	log,
	taskTitleById,
	fallbackRate,
	isRowPending,
	taskSyncing,
	hasActiveLog,
	loadingTasks,
	openMenuRowId,
	onSetOpenMenuRowId,
	onStopLog,
	onOpenTaskModal,
	onEditLog,
	onDeleteLog,
	onOpenTaskInRoadmap,
	canOpenInRoadmap,
}: {
	log: TaskTimeLog;
	taskTitleById: Map<string, string>;
	fallbackRate?: { hourly_rate: number; currency: string };
	isRowPending: boolean;
	taskSyncing: boolean;
	hasActiveLog: boolean;
	loadingTasks: boolean;
	openMenuRowId: string | null;
	onSetOpenMenuRowId: (id: string | null) => void;
	onStopLog: (id: string) => void | Promise<void>;
	onOpenTaskModal: (log: TaskTimeLog) => void;
	onEditLog: (log: TaskTimeLog) => void;
	onDeleteLog: (id: string) => void | Promise<void>;
	onOpenTaskInRoadmap: (log: TaskTimeLog) => void;
	canOpenInRoadmap: boolean;
}) {
	const isRunning = !log.ended_at;
	const nowMs = useLiveNowMs(isRunning);
	const isReadOnly = isMemberReadOnlyStatus(log.status);

	const seconds = liveDurationSecondsFromLog(log, nowMs);
	const hours = seconds / 3600;
	const snap = Number(log.rate_snapshot ?? 0);
	const hourly = snap > 0 ? snap : (fallbackRate?.hourly_rate ?? null);
	const currency = log.currency_snapshot || fallbackRate?.currency || "USD";
	const fee = hourly && Number.isFinite(hourly) ? hours * hourly : null;

	const started = new Date(log.started_at);
	const ended = log.ended_at ? new Date(log.ended_at) : null;
	const startedLabel = Number.isNaN(started.getTime())
		? "—"
		: TIME_FORMATTER.format(started);
	const endedLabel = isRunning
		? "now"
		: ended
			? started.toDateString() === ended.toDateString()
				? TIME_FORMATTER.format(ended)
				: SHORT_DATE_TIME_FORMATTER.format(ended)
			: "—";

	const taskTitle =
		log.task?.title ||
		(log.task_id ? taskTitleById.get(log.task_id) : undefined) ||
		"Untitled task";
	const projectTitle = log.project?.title || log.project_id;

	const menuItems = useMemo<ActionMenuItem[]>(() => {
		const items: ActionMenuItem[] = [];
		if (isRunning) {
			items.push({
				id: "stop",
				label: "Stop timer",
				icon: <Square className="h-3.5 w-3.5" />,
				onSelect: () => void onStopLog(log.id),
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
				onSelect: () => void onDeleteLog(log.id),
				disabled: isRowPending || isReadOnly,
				tone: "danger",
			},
			{
				id: "open-roadmap",
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
		onStopLog,
		onOpenTaskModal,
		onEditLog,
		onDeleteLog,
		onOpenTaskInRoadmap,
	]);

	return (
		<div
			className={`flex items-center gap-3 px-3 py-2.5 ${
				isRowPending ? "bg-amber-50/50" : isRunning ? "bg-sky-50/40" : ""
			}`}
		>
			{/* Icon */}
			<div
				className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
					isRunning ? "bg-sky-100 text-sky-600" : "bg-slate-100 text-slate-500"
				}`}
			>
				{isRunning ? (
					<Timer className="h-4 w-4" />
				) : (
					<span className="text-[11px] font-semibold">
						{initialsFromName(projectTitle) || (
							<FolderKanban className="h-4 w-4" />
						)}
					</span>
				)}
			</div>

			{/* Task + meta */}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<span
						className="truncate text-sm font-medium text-slate-800"
						title={taskTitle}
					>
						{taskTitle}
					</span>
					{taskSyncing && (
						<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
					)}
				</div>
				<div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
					<span className="truncate" title={projectTitle}>
						{projectTitle}
					</span>
					<span>·</span>
					<span className="tabular-nums">
						{startedLabel} –{" "}
						{isRunning ? <span className="text-sky-600">now</span> : endedLabel}
					</span>
				</div>
			</div>

			{/* Amount + hours */}
			<div className="hidden shrink-0 text-right sm:block">
				<div className="text-sm font-semibold tabular-nums text-emerald-700">
					{fee !== null ? formatMoney(fee, currency) : "—"}
				</div>
				<div className="text-[11px] tabular-nums text-slate-400">
					{hours.toFixed(2)} h
				</div>
			</div>

			{/* Status / running */}
			<div className="shrink-0">
				{isRunning ? (
					<button
						type="button"
						onClick={() => void onStopLog(log.id)}
						disabled={isRowPending}
						className="inline-flex items-center gap-1 rounded-full bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
					>
						<Square className="h-3 w-3" />
						Stop
					</button>
				) : (
					<span
						className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass(log.status)}`}
						title={log.review_note ?? undefined}
					>
						{log.status}
					</span>
				)}
			</div>

			{/* Actions */}
			<div className="shrink-0">
				<RowActionsMenu
					rowId={log.id}
					openMenuRowId={openMenuRowId}
					onSetOpenMenuRowId={onSetOpenMenuRowId}
					items={menuItems}
					loading={isRowPending}
				/>
			</div>
		</div>
	);
});

function MyLogsListSkeleton() {
	return (
		<div className="space-y-4">
			{Array.from({ length: 2 }).map((_, dayIdx) => (
				<div key={dayIdx} className="space-y-1.5">
					<div className="h-3 w-32 rounded bg-slate-100" />
					<div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
						{Array.from({ length: 3 }).map((__, rowIdx) => (
							<div
								key={rowIdx}
								className="flex animate-pulse items-center gap-3 px-3 py-3"
							>
								<div className="h-9 w-9 rounded-full bg-slate-100" />
								<div className="flex-1 space-y-2">
									<div className="h-3 w-40 rounded bg-slate-100" />
									<div className="h-2.5 w-24 rounded bg-slate-100" />
								</div>
								<div className="h-3 w-16 rounded bg-slate-100" />
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
