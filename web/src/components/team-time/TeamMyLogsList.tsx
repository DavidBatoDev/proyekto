import {
	AlertTriangle,
	ChevronRight,
	Coffee,
	ExternalLink,
	Eye,
	FolderKanban,
	LogIn,
	LogOut,
	Pencil,
	Play,
	Plus,
	Square,
	Timer,
	Trash2,
} from "lucide-react";
import {
	type ComponentType,
	type CSSProperties,
	memo,
	type ReactNode,
	useCallback,
	useMemo,
	useState,
} from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type {
	ProjectTaskOption,
	TaskTimeLog,
} from "@/services/team-time.service";
import { BillableAmount } from "./BillableAmount";
import { type ActionMenuItem, RowActionsMenu } from "./RowActionsMenu";
import {
	formatLogEnd,
	formatLogStart,
	isUnusuallyLongLog,
	liveBreakSecondsFromLog,
	liveDurationSecondsFromLog,
	statusBadgeClass,
	useLiveNowMs,
} from "./time-utils";

const DAY_HEADER_FORMATTER = new Intl.DateTimeFormat(undefined, {
	weekday: "long",
	month: "long",
	day: "numeric",
});

/** Group key for the pulled-out "likely a forgotten timer" rows. */
const REVIEW_GROUP_KEY = "__needs_review__";

/**
 * The entrance cascade is capped so a 200-row period doesn't waterfall for
 * several seconds — past this index every row animates on the same beat.
 */
const MAX_STAGGER_STEPS = 14;

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

function breakSecondsOf(log: TaskTimeLog): number {
	return Math.max(0, log.break_seconds ?? (log.break_minutes ?? 0) * 60);
}

function startedAtMs(log: TaskTimeLog): number {
	const ms = new Date(log.started_at).getTime();
	return Number.isNaN(ms) ? 0 : ms;
}

/** Newest time-in first — the sort every list in this table is built with. */
function byTimeInDesc(a: TaskTimeLog, b: TaskTimeLog): number {
	return startedAtMs(b) - startedAtMs(a);
}

/** The bar down a row's left edge, reading its review state at a glance. */
function accentClass(log: TaskTimeLog): string {
	if (!log.ended_at) return "border-l-primary";
	if (log.status === "approved" || log.status === "paid")
		return "border-l-emerald-500";
	if (log.status === "rejected") return "border-l-rose-500";
	return "border-l-amber-400";
}

/**
 * Which optional columns are rendered at the current width.
 *
 * These are JS media queries rather than `hidden md:table-cell` classes
 * because the day-header rows use `colSpan`: a column whose every cell is
 * `display:none` still exists in the column grid, and a spanning cell hands
 * it width, which pushed the table past the viewport on a phone. Dropping the
 * cells from the DOM keeps the grid honest — and the same booleans decide
 * what folds into the task cell's second line.
 */
interface VisibleColumns {
	rowNumber: boolean;
	project: boolean;
	timeIn: boolean;
	timeOut: boolean;
	breakTime: boolean;
	amount: boolean;
}

function useVisibleColumns(
	hasBreaks: boolean,
	showMoney: boolean,
): VisibleColumns {
	const belowSm = useIsMobile(639);
	const belowMd = useIsMobile(767);
	const belowLg = useIsMobile(1023);
	const belowXl = useIsMobile(1279);
	return useMemo(
		() => ({
			rowNumber: !belowSm,
			project: !belowLg,
			timeIn: !belowMd,
			timeOut: !belowLg,
			breakTime: hasBreaks && !belowXl,
			amount: showMoney && !belowSm,
		}),
		[belowSm, belowMd, belowLg, belowXl, hasBreaks, showMoney],
	);
}

interface LogGroup {
	key: string;
	kind: "day" | "review";
	label: string;
	caption?: string;
	logs: TaskTimeLog[];
	hasRunning: boolean;
}

interface TeamMyLogsListProps {
	/** False when member rates are off — the amount column disappears. */
	showMoney?: boolean;
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
	/**
	 * Opens the log's detail (work & break timeline, review thread). The list
	 * used to navigate to a detail *page* for this, which rendered a second
	 * DashboardShell inside the Time layout's — hence the duplicated sidebar.
	 */
	onViewTimeline?: (log: TaskTimeLog) => void;
	/** Opens the timer picker — this is the "Start a timer" action. */
	onOpenAddLog: () => void;
	/**
	 * Opens the manual-entry form for time already worked. Optional so a
	 * surface without a manual path can omit it, but both time pages pass it —
	 * it used to be reachable only through the calendar.
	 */
	onOpenManualLog?: () => void;
}

/**
 * My time logs as a compact table, newest time-in first, grouped into
 * collapsible days.
 *
 * This replaced a stack of card rows: at a glance you now read straight down
 * the hours, amount and status columns instead of re-parsing every row. Each
 * secondary column carries its own icon, a status-coloured bar runs down the
 * left edge, and the row number runs continuously down the table so a row can
 * be pointed at ("#12") without quoting a task title.
 *
 * The narrow columns drop out one at a time as the viewport shrinks (break,
 * then project and time out, then time in, amount and the row number) and
 * what they held folds into the task cell's second line, so the same markup
 * stays legible on a phone without a second layout.
 */
export function TeamMyLogsList({
	showMoney = true,
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
	onViewTimeline,
	onOpenAddLog,
	onOpenManualLog,
}: TeamMyLogsListProps) {
	const [openMenuRowId, setOpenMenuRowId] = useState<string | null>(null);
	// Days start expanded; the "needs review" group starts folded away.
	const [collapsedKeys, setCollapsedKeys] = useState<Record<string, boolean>>(
		() => ({ [REVIEW_GROUP_KEY]: true }),
	);

	const toggleGroup = useCallback((key: string) => {
		setCollapsedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
	}, []);

	const hasActiveLog = useMemo(() => logs.some((l) => !l.ended_at), [logs]);

	// Unusually long logs (likely forgotten timers) are pulled out of the normal
	// day flow so they don't inflate day totals and are easy to find and fix.
	const unusualLogs = useMemo(
		() => logs.filter(isUnusuallyLongLog).sort(byTimeInDesc),
		[logs],
	);

	const taskTitleById = useMemo(() => {
		const map = new Map<string, string>();
		for (const task of tasks) map.set(task.id, task.title || "Untitled task");
		return map;
	}, [tasks]);

	// A break column for a period without a single logged break is dead space.
	const hasBreaks = useMemo(
		() => logs.some((log) => breakSecondsOf(log) > 0 || Boolean(log.paused_at)),
		[logs],
	);
	const columns = useVisibleColumns(hasBreaks, showMoney);

	const groups = useMemo<LogGroup[]>(() => {
		const byDay = new Map<string, TaskTimeLog[]>();
		for (const log of logs) {
			if (isUnusuallyLongLog(log)) continue; // shown in the "Needs review" group
			const key = toLocalDayKey(log.started_at) ?? "unknown";
			const bucket = byDay.get(key);
			if (bucket) bucket.push(log);
			else byDay.set(key, [log]);
		}
		const days: LogGroup[] = [];
		for (const [key, dayLogs] of byDay.entries()) {
			dayLogs.sort(byTimeInDesc);
			const parsed = new Date(dayLogs[0].started_at);
			days.push({
				key,
				kind: "day",
				label: Number.isNaN(parsed.getTime())
					? "Undated"
					: DAY_HEADER_FORMATTER.format(parsed),
				logs: dayLogs,
				hasRunning: dayLogs.some((l) => !l.ended_at),
			});
		}
		// Newest day first — the keys are yyyy-mm-dd, so they sort as strings.
		days.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));

		if (unusualLogs.length === 0) return days;
		return [
			{
				key: REVIEW_GROUP_KEY,
				kind: "review" as const,
				label: `Needs review — unusually long (${unusualLogs.length})`,
				caption: "A timer may have been left running",
				logs: unusualLogs,
				hasRunning: false,
			},
			...days,
		];
	}, [logs, unusualLogs]);

	if (loadingLogs) return <MyLogsTableSkeleton />;

	// Cells a day header spans before the hours total: the accent/number cell,
	// the task, and whichever of project / time in / time out / break render.
	const leadingSpan =
		2 +
		(columns.project ? 1 : 0) +
		(columns.timeIn ? 1 : 0) +
		(columns.timeOut ? 1 : 0) +
		(columns.breakTime ? 1 : 0);
	// Row numbers run continuously down the table rather than restarting per
	// day, so "#12" means one row whichever groups happen to be folded.
	let runningIndex = 0;

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-baseline gap-2">
					<h3 className="text-sm font-semibold text-foreground">Activity</h3>
					{logs.length > 0 && (
						<span className="text-xs tabular-nums text-muted-foreground">
							{logs.length} {logs.length === 1 ? "log" : "logs"}
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					{onOpenManualLog && (
						<button
							type="button"
							onClick={onOpenManualLog}
							className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-all duration-150 hover:bg-muted active:scale-[0.97]"
						>
							<Plus className="h-3.5 w-3.5" />
							Add past work
						</button>
					)}
					<button
						type="button"
						onClick={onOpenAddLog}
						className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 hover:shadow active:scale-[0.97]"
					>
						<Play className="h-3.5 w-3.5" />
						Start a timer
					</button>
				</div>
			</div>

			{groups.length === 0 ? (
				<button
					type="button"
					onClick={onOpenAddLog}
					className="flex w-full flex-col items-center rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center transition-colors duration-200 hover:border-primary/45 hover:bg-muted"
				>
					<div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
						<Timer className="h-6 w-6 text-muted-foreground" />
					</div>
					<h3 className="text-base font-semibold text-foreground">
						No time logged yet
					</h3>
					<p className="mt-2 max-w-sm text-sm text-muted-foreground">
						Start a timer to log time on a task. Each log freezes your current
						rate.
					</p>
				</button>
			) : (
				<div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
					<table className="w-full border-collapse text-left">
						<thead>
							<tr className="border-b border-border bg-muted/50">
								<HeadCell className="w-px pl-0 pr-0 sm:pl-3 sm:pr-1">
									{columns.rowNumber ? "#" : ""}
								</HeadCell>
								<HeadCell className="w-full min-w-[7rem] max-w-0 sm:min-w-[9rem]">
									Task
								</HeadCell>
								{columns.project && <HeadCell>Project</HeadCell>}
								{columns.timeIn && <HeadCell>Time in</HeadCell>}
								{columns.timeOut && <HeadCell>Time out</HeadCell>}
								{columns.breakTime && <HeadCell>Break</HeadCell>}
								<HeadCell className="text-right">Hours</HeadCell>
								{columns.amount && (
									<HeadCell className="text-right">Amount</HeadCell>
								)}
								<HeadCell>Status</HeadCell>
								<HeadCell className="w-px">
									<span className="sr-only">Actions</span>
								</HeadCell>
							</tr>
						</thead>
						{groups.map((group, groupIndex) => {
							const collapsed = Boolean(collapsedKeys[group.key]);
							return (
								<tbody key={group.key}>
									<GroupHeaderRow
										group={group}
										collapsed={collapsed}
										leadingSpan={leadingSpan}
										showAmount={columns.amount}
										isFirst={groupIndex === 0}
										onToggle={toggleGroup}
									/>
									{!collapsed &&
										group.logs.map((log, rowIndex) => {
											runningIndex += 1;
											return (
												<MyLogTableRow
													key={log.id}
													rowNumber={runningIndex}
													staggerIndex={Math.min(rowIndex, MAX_STAGGER_STEPS)}
													columns={columns}
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
													onViewTimeline={onViewTimeline}
												/>
											);
										})}
								</tbody>
							);
						})}
					</table>
				</div>
			)}
		</div>
	);
}

function HeadCell({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<th
			scope="col"
			className={`whitespace-nowrap px-2 py-2.5 text-[11px] font-semibold text-muted-foreground sm:px-3 ${className}`}
		>
			{children}
		</th>
	);
}

// ─── group header ────────────────────────────────────────────────────

const GroupHeaderRow = memo(function GroupHeaderRow({
	group,
	collapsed,
	leadingSpan,
	showAmount,
	isFirst,
	onToggle,
}: {
	group: LogGroup;
	collapsed: boolean;
	leadingSpan: number;
	showAmount: boolean;
	isFirst: boolean;
	onToggle: (key: string) => void;
}) {
	const isReview = group.kind === "review";
	return (
		<tr
			onClick={() => onToggle(group.key)}
			className={`cursor-pointer select-none border-b transition-colors duration-150 [&>td]:align-middle ${
				isReview
					? "border-warning/40 bg-warning/10 hover:bg-warning/15"
					: "border-border bg-muted/30 hover:bg-muted/60"
			} ${isFirst ? "" : "border-t"}`}
		>
			<td colSpan={leadingSpan} className="px-2 py-1.5 sm:px-3">
				{/* `w-0 min-w-full` keeps a long day label from widening the columns
				    it spans; it fills the cell but contributes nothing to layout. */}
				<div className="w-0 min-w-full">
					{/* The click is handled by the row so the whole header band is a
					    target; this button keeps the toggle keyboard-reachable. */}
					<button
						type="button"
						aria-expanded={!collapsed}
						className="flex w-full items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
					>
						<ChevronRight
							className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-out ${
								collapsed ? "" : "rotate-90"
							} ${isReview ? "text-warning" : "text-muted-foreground"}`}
						/>
						{isReview && (
							<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
						)}
						<span className="truncate text-[11px] font-semibold uppercase tracking-wide text-foreground">
							{group.label}
						</span>
						{!isReview && (
							<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
								· {group.logs.length}
							</span>
						)}
						{group.caption && (
							<span className="hidden shrink-0 text-[11px] font-normal normal-case text-muted-foreground md:inline">
								· {group.caption}
							</span>
						)}
					</button>
				</div>
			</td>
			<td className="px-2 py-1.5 text-right sm:px-3">
				<GroupHours logs={group.logs} active={group.hasRunning} />
			</td>
			{showAmount && <td />}
			<td colSpan={2} />
		</tr>
	);
});

/** Live day total. Over 8 hours reads as a warning, as it did in the list. */
const GroupHours = memo(function GroupHours({
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
			className={`text-[11px] font-semibold tabular-nums ${
				isOver ? "text-rose-600" : "text-muted-foreground"
			}`}
			title={isOver ? "Over 8 hours logged this day" : "Total hours"}
		>
			{hours.toFixed(2)}
		</span>
	);
});

// ─── row ─────────────────────────────────────────────────────────────

/** Muted leading icon shared by the project / time / break cells. */
function CellIcon({
	icon: Icon,
}: {
	icon: ComponentType<{ className?: string }>;
}) {
	return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />;
}

/** Icon-only row action that slides in on row hover / keyboard focus. */
function QuickAction({
	icon: Icon,
	label,
	onClick,
	disabled,
}: {
	icon: ComponentType<{ className?: string }>;
	label: string;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			// Hover-only, so it is dead weight on a touch layout — the same
			// actions stay in the "⋯" menu there.
			className="hidden h-7 w-7 translate-x-1 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all duration-200 ease-out hover:bg-muted hover:text-foreground focus-visible:translate-x-0 focus-visible:opacity-100 active:scale-90 disabled:cursor-not-allowed disabled:opacity-0 group-hover/row:translate-x-0 group-hover/row:opacity-100 group-hover/row:disabled:opacity-30 group-focus-within/row:translate-x-0 group-focus-within/row:opacity-100 md:inline-flex"
		>
			<Icon className="h-3.5 w-3.5" />
		</button>
	);
}

const MyLogTableRow = memo(function MyLogTableRow({
	rowNumber,
	staggerIndex,
	columns,
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
	onViewTimeline,
}: {
	rowNumber: number;
	staggerIndex: number;
	columns: VisibleColumns;
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
	onViewTimeline?: (log: TaskTimeLog) => void;
}) {
	const isRunning = !log.ended_at;
	const nowMs = useLiveNowMs(isRunning);
	const isReadOnly = isMemberReadOnlyStatus(log.status);
	const isUnusual = isUnusuallyLongLog(log);

	const seconds = liveDurationSecondsFromLog(log, nowMs);
	const hours = seconds / 3600;
	const snap = Number(log.rate_snapshot ?? 0);
	const hourly = snap > 0 ? snap : (fallbackRate?.hourly_rate ?? null);
	const currency = log.currency_snapshot || fallbackRate?.currency || "USD";
	const fee = hourly && Number.isFinite(hourly) ? hours * hourly : null;

	const started = new Date(log.started_at);
	const ended = log.ended_at ? new Date(log.ended_at) : null;
	const startedLabel = formatLogStart(started);
	const endedLabel = ended ? formatLogEnd(started, ended) : "—";
	const breakMinutes = Math.floor(liveBreakSecondsFromLog(log, nowMs) / 60);

	const taskTitle =
		log.task?.title ||
		(log.task_id ? taskTitleById.get(log.task_id) : undefined) ||
		(log.task_id ? "Untitled task" : "No task");
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
		if (onViewTimeline) {
			items.push({
				id: "view-timeline",
				label: "View work & break timeline",
				icon: <Eye className="h-3.5 w-3.5" />,
				onSelect: () => onViewTimeline(log),
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
		onViewTimeline,
		onStopLog,
		onOpenTaskModal,
		onEditLog,
		onDeleteLog,
		onOpenTaskInRoadmap,
	]);

	const openDetail = onViewTimeline ? () => onViewTimeline(log) : undefined;

	// `rowNumber` doubles as "we are at sm or wider" — see the fold-in line.
	const foldProject = !columns.project;
	const foldTime = !columns.timeIn && columns.rowNumber;

	const tone = isRowPending
		? "bg-warning/10"
		: isRunning
			? "bg-primary/[0.06] hover:bg-primary/10"
			: log.status === "rejected"
				? "bg-rose-500/[0.04] hover:bg-rose-500/[0.08]"
				: "hover:bg-muted/60";

	return (
		<tr
			className={`group/row time-row-in border-b border-border/60 transition-colors duration-150 [&>td]:align-middle ${tone} ${
				openDetail ? "cursor-pointer" : ""
			}`}
			style={{ "--row-i": staggerIndex } as CSSProperties}
			onClick={openDetail}
		>
			{/* Status accent bar, and the row number once there is room for it. */}
			<td
				className={`w-px whitespace-nowrap border-l-[3px] py-1.5 pl-0 pr-0 sm:pl-3 sm:pr-1 ${accentClass(log)}`}
			>
				{columns.rowNumber && (
					<span className="inline-flex min-w-[1.25rem] justify-center rounded-md bg-muted px-1 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
						{rowNumber}
					</span>
				)}
			</td>

			{/* Task — absorbs the free width, so `truncate` has something to cut.
			    The min-width keeps auto layout from collapsing it to nothing once
			    the narrow columns and a running row's Stop button crowd a phone. */}
			<td className="w-full min-w-[7rem] max-w-0 px-2 py-1.5 sm:min-w-[9rem] sm:px-3">
				<div className="min-w-0">
					<div className="flex items-center gap-1.5">
						<span
							className={`block truncate text-[13px] ${
								log.task_id
									? "font-medium text-foreground"
									: "italic text-muted-foreground"
							}`}
							title={taskTitle}
						>
							{taskTitle}
						</span>
						{isUnusual && (
							<AlertTriangle
								className="h-3 w-3 shrink-0 text-warning"
								aria-label="Unusually long log"
							/>
						)}
						{taskSyncing && (
							<span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground" />
						)}
					</div>
					{/* The dropped columns, folded back in. The clock range only joins
					    once the row number has room too (≥ sm): below that the task
					    cell is ~112px and the range would squeeze the project name
					    down to a single letter. */}
					{(foldProject || foldTime) && (
						<div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
							{foldProject && <span className="truncate">{projectTitle}</span>}
							{foldProject && foldTime && <span className="shrink-0">·</span>}
							{foldTime && (
								<span className="shrink-0 whitespace-nowrap tabular-nums">
									{startedLabel} – {isRunning ? "now" : endedLabel}
								</span>
							)}
						</div>
					)}
				</div>
			</td>

			{columns.project && (
				<td className="max-w-[190px] px-2 py-1.5 sm:px-3">
					<div className="flex items-center gap-1.5">
						<CellIcon icon={FolderKanban} />
						<span
							className="truncate text-xs text-muted-foreground"
							title={projectTitle}
						>
							{projectTitle}
						</span>
					</div>
				</td>
			)}

			{columns.timeIn && (
				<td className="whitespace-nowrap px-2 py-1.5 sm:px-3">
					<span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
						<CellIcon icon={LogIn} />
						{startedLabel}
					</span>
				</td>
			)}

			{columns.timeOut && (
				<td className="whitespace-nowrap px-2 py-1.5 sm:px-3">
					<span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
						<CellIcon icon={LogOut} />
						{isRunning ? (
							<span className="font-medium text-primary">now</span>
						) : (
							endedLabel
						)}
					</span>
				</td>
			)}

			{columns.breakTime && (
				<td className="whitespace-nowrap px-2 py-1.5 sm:px-3">
					<span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
						<CellIcon icon={Coffee} />
						{breakMinutes > 0 ? `${breakMinutes}m` : "—"}
					</span>
				</td>
			)}

			<td className="whitespace-nowrap px-2 py-1.5 text-right text-[13px] font-semibold tabular-nums text-foreground sm:px-3">
				{hours.toFixed(2)}
			</td>

			{columns.amount && (
				<td className="whitespace-nowrap px-2 py-1.5 text-right text-[13px] font-medium tabular-nums sm:px-3">
					<BillableAmount
						status={log.status}
						running={isRunning}
						fee={fee}
						currency={currency}
						show
					/>
				</td>
			)}

			<td className="whitespace-nowrap px-2 py-1.5 sm:px-3">
				{isRunning ? (
					<span
						className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
						title={log.paused_at ? "On break" : "Timer running"}
					>
						<span className="relative flex h-1.5 w-1.5">
							{!log.paused_at && (
								<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
							)}
							<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
						</span>
						{log.paused_at ? "On break" : "Running"}
					</span>
				) : (
					<span
						className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ${statusBadgeClass(
							log.status,
						)}`}
						title={log.review_note ?? undefined}
					>
						{log.status}
					</span>
				)}
			</td>

			{/* Actions — the quick buttons hold their width at rest, so revealing
			    them on hover never reflows the table. */}
			<td
				className="w-px whitespace-nowrap py-1 pl-2 pr-2"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="flex items-center justify-end gap-0.5">
					{isRunning && (
						<button
							type="button"
							onClick={() => void onStopLog(log.id)}
							disabled={isRowPending}
							className="mr-1 inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-95 disabled:opacity-50"
						>
							<Square className="h-3 w-3" />
							<span className="hidden sm:inline">Stop</span>
						</button>
					)}
					{onViewTimeline && (
						<QuickAction
							icon={Eye}
							label="View work & break timeline"
							onClick={() => onViewTimeline(log)}
						/>
					)}
					<QuickAction
						icon={Pencil}
						label="Edit log"
						onClick={() => onEditLog(log)}
						disabled={isRowPending || hasActiveLog || isReadOnly}
					/>
					<RowActionsMenu
						rowId={log.id}
						openMenuRowId={openMenuRowId}
						onSetOpenMenuRowId={onSetOpenMenuRowId}
						items={menuItems}
						loading={isRowPending}
					/>
				</div>
			</td>
		</tr>
	);
});

// ─── loading ─────────────────────────────────────────────────────────

function MyLogsTableSkeleton() {
	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<div className="h-4 w-24 rounded bg-muted" />
				<div className="h-7 w-44 rounded-lg bg-muted" />
			</div>
			<div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
				<div className="h-9 border-b border-border bg-muted/50" />
				{Array.from({ length: 2 }).map((_, groupIdx) => (
					<div key={groupIdx}>
						<div className="flex h-7 items-center border-b border-border bg-muted/30 px-3">
							<div className="h-2.5 w-36 rounded bg-muted" />
						</div>
						{Array.from({ length: 3 }).map((__, rowIdx) => (
							<div
								key={rowIdx}
								className="flex animate-pulse items-center gap-3 border-b border-border/60 px-3 py-2.5"
							>
								<div className="h-4 w-5 rounded bg-muted" />
								<div className="h-3 w-48 rounded bg-muted" />
								<div className="ml-auto h-3 w-12 rounded bg-muted" />
								<div className="h-3 w-16 rounded bg-muted" />
								<div className="h-4 w-16 rounded-md bg-muted" />
							</div>
						))}
					</div>
				))}
			</div>
		</div>
	);
}
