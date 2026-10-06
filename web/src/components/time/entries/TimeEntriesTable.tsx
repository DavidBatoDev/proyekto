// web/src/components/time/entries/TimeEntriesTable.tsx
//
// Time entries as a compact table, grouped into collapsible days, with a
// leading "Needs review" group (ux.md › The Time Page). Ported from the
// grouped `team-time/TeamMyLogsList` table (day groups, the review group,
// the status accent bar, the narrow columns that fold into the task cell, the
// skeleton and the `.time-row-in` entrance), rebuilt on `TimeEntryView`:
//
//   #  Task              Project      For                In    Out    Dur   ⋯
//   1  Fix login bug     Acme Web     [Prodigitality S…] 09:00 12:30  3:30  ⋯
//   2  ◦ Meeting         Acme Web     [Acme Corp 🔒]     13:00 14:00  1:00  ⋯
//
// - **For** column: the entry's For chip; locked rows show the 🔒 chip with
//   "Submitted Oct 6. Withdraw to change.". Folded into the task cell below lg.
// - **Lock matrix** (`entryRules`): a locked row keeps only View details and
//   Comment in "⋯", and has no hover quick actions.
// - **Needs review**: entries of 10 h or more, or flagged, pulled into their
//   own group (collapsed in `mine`, open in `review`).
// - **Selection mode**: checkboxes for bulk "Change For…"; locked and running
//   rows are disabled with the reason.
// - **Modes** `mine | review | readonly` (see `EntriesTableMode`).
// - **Hidden content** rows read "A project you can't open" plus the
//   work-item kind, with only the interval and duration.
//
// Data, mutations and dialogs belong to the caller: every action is a
// callback, and an action without one is not offered.

import {
	AlertTriangle,
	ChevronRight,
	Coffee,
	Eye,
	FolderKanban,
	LogIn,
	LogOut,
	MessageSquare,
	Pencil,
	Repeat,
	Square,
	SquareArrowOutUpRight,
	SquarePen,
	Trash2,
} from "lucide-react";
import {
	type ComponentType,
	type CSSProperties,
	memo,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type ActionMenuItem,
	RowActionsMenu,
} from "@/components/team-time/RowActionsMenu";
import { useIsMobile } from "@/hooks/useIsMobile";
import { isNativeApp } from "@/lib/platform";
import { serverNow } from "@/lib/serverClock";
import {
	canShowAmounts,
	deviceTimeZone,
	formatClock,
	formatDurationText,
	formatInstantDateTime,
	formatInstantTime,
} from "@/lib/timeFormat";
import { localDate, safeTimezone } from "@/lib/timePeriods";
import { cn } from "@/lib/utils";
import type { TimeEntryView } from "@/services/time.types";
import { ForChip } from "../for/ForChip";
import { forChipOptionFromEntry } from "../for/forOptions";
import { useLiveNowMs } from "../timer/liveDuration";
import { AmountLines } from "./AmountLines";
import { EntryBadges } from "./EntryBadges";
import {
	ACCENT_CLASS,
	amountRecord,
	DAY_WARNING_SECONDS,
	ENTRY_COPY,
	type EntriesTableMode,
	type EntryActionId,
	type EntryGroup,
	type EntrySheetInfo,
	entryAccent,
	entryActions,
	entryAmount,
	entryBreakSeconds,
	entryLockCopy,
	entryProjectLabel,
	entrySelection,
	entryStatusLabel,
	entryTitle,
	entryWorkSeconds,
	groupEntries,
	isEntryLocked,
	isHiddenContent,
	isOnBreak,
	NEEDS_REVIEW_GROUP_KEY,
	needsReviewCopy,
	workItemLabel,
} from "./entryRules";

/** The entrance cascade is capped so a long period doesn't waterfall for seconds. */
const MAX_STAGGER_STEPS = 14;

export interface EntriesSelection {
	selectedIds: ReadonlySet<string>;
	onChange: (ids: Set<string>) => void;
	/**
	 * Buttons for the selection bar, given the selected (selectable) rows.
	 * Without it the bar offers "Change For…" when `onChangeFor` is set.
	 */
	actions?: (selected: TimeEntryView[]) => ReactNode;
}

export interface TimeEntriesTableProps {
	entries: readonly TimeEntryView[];
	/** Default `mine`. */
	mode?: EntriesTableMode;
	loading?: boolean;
	/** Days and clock times are read in this timezone (the day strip's). Default: the device's. */
	timeZone?: string;
	/** `newest` (default): newest day and time-in first; `oldest` reads chronologically. */
	order?: "newest" | "oldest";
	/** The caller's sheets (`me/timesheets`), for the submitted date on locked chips. */
	sheets?: readonly EntrySheetInfo[];
	/** Adds the Amount column for cost viewers (never agreement time on native). Default false. */
	showAmounts?: boolean;
	/** Rows with a write in flight: tinted, actions disabled. */
	pendingIds?: ReadonlySet<string> | readonly string[];
	/** Rendered instead of the table when there are no entries. */
	empty?: ReactNode;
	/** Whether Needs review starts open. Default: open in `review`, folded otherwise. */
	defaultReviewOpen?: boolean;
	/** Row click, "View details" and "Comment" (`focus: 'comments'`). */
	onOpenEntry?: (
		entry: TimeEntryView,
		options?: { focus?: "comments" },
	) => void;
	onStop?: (entry: TimeEntryView) => void;
	onEdit?: (entry: TimeEntryView) => void;
	onChangeTask?: (entry: TimeEntryView) => void;
	/** One row from "⋯", or the selection from the selection bar. */
	onChangeFor?: (entries: TimeEntryView[]) => void;
	onDelete?: (entry: TimeEntryView) => void;
	onOpenTask?: (entry: TimeEntryView) => void;
	canOpenTask?: (entry: TimeEntryView) => boolean;
	/** Turns on selection mode (`mine` only). */
	selection?: EntriesSelection;
	/** The project's workspace, for the chip's Who approves popover. */
	projectWorkspaceName?: string | null;
	/** When the table sits in a dialog: the "⋯" menu and chip popovers above it. */
	menuZIndexClassName?: string;
	popoverZIndex?: number;
	className?: string;
}

// ── Layout ──────────────────────────────────────────────────────────────────

/**
 * Which optional columns render at the current width. JS media queries, not
 * `hidden md:table-cell`: the group headers use `colSpan`, and a column whose
 * cells are all `display:none` still takes width from a spanning cell, which
 * pushed the table past a phone's viewport. The same booleans decide what
 * folds into the task cell.
 */
interface VisibleColumns {
	rowNumber: boolean;
	project: boolean;
	forChip: boolean;
	timeIn: boolean;
	timeOut: boolean;
	breakTime: boolean;
	amount: boolean;
}

function useVisibleColumns(
	hasBreaks: boolean,
	hasAmounts: boolean,
): VisibleColumns {
	const belowSm = useIsMobile(639);
	const belowMd = useIsMobile(767);
	const belowLg = useIsMobile(1023);
	const belowXl = useIsMobile(1279);
	return useMemo(
		() => ({
			rowNumber: !belowSm,
			project: !belowLg,
			forChip: !belowLg,
			timeIn: !belowMd,
			timeOut: !belowLg,
			breakTime: hasBreaks && !belowXl,
			amount: hasAmounts && !belowSm,
		}),
		[belowSm, belowMd, belowLg, belowXl, hasBreaks, hasAmounts],
	);
}

/** A coarse "now" (once a minute while a timer runs) for Needs review membership. */
function useMinuteNow(active: boolean): number {
	const [now, setNow] = useState(() => serverNow());
	useEffect(() => {
		if (!active) return;
		setNow(serverNow());
		const handle = setInterval(() => setNow(serverNow()), 60_000);
		return () => clearInterval(handle);
	}, [active]);
	return now;
}

function toIdSet(
	ids: ReadonlySet<string> | readonly string[] | undefined,
): ReadonlySet<string> {
	if (!ids) return EMPTY_SET;
	return ids instanceof Set ? ids : new Set(ids as readonly string[]);
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

// ── Table ───────────────────────────────────────────────────────────────────

export function TimeEntriesTable({
	entries,
	mode = "mine",
	loading = false,
	timeZone,
	order = "newest",
	sheets,
	showAmounts = false,
	pendingIds,
	empty = null,
	defaultReviewOpen,
	onOpenEntry,
	onStop,
	onEdit,
	onChangeTask,
	onChangeFor,
	onDelete,
	onOpenTask,
	canOpenTask,
	selection,
	projectWorkspaceName,
	menuZIndexClassName,
	popoverZIndex,
	className,
}: TimeEntriesTableProps) {
	const tz = useMemo(
		() => safeTimezone(timeZone ?? deviceTimeZone()),
		[timeZone],
	);
	const native = isNativeApp();
	const [openMenuRowId, setOpenMenuRowId] = useState<string | null>(null);
	const reviewOpen = defaultReviewOpen ?? mode === "review";
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => ({
		[NEEDS_REVIEW_GROUP_KEY]: !reviewOpen,
	}));
	const toggleGroup = useCallback((key: string) => {
		setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
	}, []);

	const hasRunning = useMemo(() => entries.some((e) => !e.ended_at), [entries]);
	const groupNow = useMinuteNow(hasRunning);
	const groups = useMemo(
		() => groupEntries(entries, { timeZone: tz, order, nowMs: groupNow }),
		[entries, tz, order, groupNow],
	);

	const sheetById = useMemo(() => {
		const map = new Map<string, EntrySheetInfo>();
		for (const sheet of sheets ?? []) map.set(sheet.id, sheet);
		return map;
	}, [sheets]);
	const pending = useMemo(() => toIdSet(pendingIds), [pendingIds]);

	const hasBreaks = useMemo(
		() => entries.some((e) => (e.break_seconds ?? 0) > 0 || isOnBreak(e)),
		[entries],
	);
	const hasAmounts = useMemo(
		() =>
			showAmounts &&
			entries.some(
				(e) =>
					canShowAmounts({ cost: e.cost, kind: e.context_kind, native }) &&
					entryAmount(e) !== null,
			),
		[entries, showAmounts, native],
	);
	const columns = useVisibleColumns(hasBreaks, hasAmounts);

	// Selection (mine only).
	const selectionOn = Boolean(selection) && mode === "mine";
	const lockOptionsFor = useCallback(
		(entry: TimeEntryView) => ({
			native,
			sheet: entry.timesheet_id ? sheetById.get(entry.timesheet_id) : null,
			timeZone: tz,
		}),
		[native, sheetById, tz],
	);
	const selectableIds = useMemo(() => {
		if (!selectionOn) return [] as string[];
		return entries
			.filter((e) => entrySelection(e, mode, lockOptionsFor(e)).selectable)
			.map((e) => e.id);
	}, [entries, mode, selectionOn, lockOptionsFor]);
	const selectedEntries = useMemo(() => {
		if (!selectionOn || !selection) return [] as TimeEntryView[];
		const allowed = new Set(selectableIds);
		return entries.filter(
			(e) => selection.selectedIds.has(e.id) && allowed.has(e.id),
		);
	}, [entries, selection, selectionOn, selectableIds]);

	const setSelected = useCallback(
		(id: string, on: boolean) => {
			if (!selection) return;
			const next = new Set(selection.selectedIds);
			if (on) next.add(id);
			else next.delete(id);
			selection.onChange(next);
		},
		[selection],
	);

	if (loading) return <EntriesTableSkeleton />;
	if (entries.length === 0) return <>{empty}</>;

	// Cells a group header spans before the duration total.
	const leadingSpan =
		(selectionOn ? 1 : 0) +
		2 +
		(columns.project ? 1 : 0) +
		(columns.forChip ? 1 : 0) +
		(columns.timeIn ? 1 : 0) +
		(columns.timeOut ? 1 : 0) +
		(columns.breakTime ? 1 : 0);

	// Row numbers run on through folded groups, so "#12" names one row
	// whichever groups are open.
	const firstNumber: number[] = [];
	let counter = 0;
	for (const group of groups) {
		firstNumber.push(counter + 1);
		counter += group.entries.length;
	}

	const allSelected =
		selectableIds.length > 0 && selectedEntries.length === selectableIds.length;
	const someSelected = selectedEntries.length > 0 && !allSelected;

	return (
		<div className={cn("space-y-2", className)}>
			{selectionOn && selection && selectedEntries.length > 0 ? (
				<div
					role="toolbar"
					aria-label="Selected time entries"
					className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2"
				>
					<span className="text-xs font-semibold text-foreground tabular-nums">
						{selectedEntries.length} selected
					</span>
					<div className="ml-auto flex flex-wrap items-center gap-2">
						{selection.actions
							? selection.actions(selectedEntries)
							: onChangeFor && (
									<button
										type="button"
										onClick={() => onChangeFor(selectedEntries)}
										className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
									>
										<Repeat className="h-3.5 w-3.5" aria-hidden="true" />
										{ENTRY_COPY.changeFor}
									</button>
								)}
						<button
							type="button"
							onClick={() => selection.onChange(new Set())}
							className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
						>
							Clear
						</button>
					</div>
				</div>
			) : null}

			<div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
				<table className="w-full border-collapse text-left">
					<thead>
						<tr className="border-b border-border bg-muted/50">
							{selectionOn ? (
								<HeadCell className="w-px pr-0">
									<SelectAllBox
										checked={allSelected}
										indeterminate={someSelected}
										disabled={selectableIds.length === 0}
										onChange={(on) =>
											selection?.onChange(
												on ? new Set(selectableIds) : new Set(),
											)
										}
									/>
								</HeadCell>
							) : null}
							<HeadCell className="w-px pl-0 pr-0 sm:pl-3 sm:pr-1">
								{columns.rowNumber ? "#" : ""}
							</HeadCell>
							<HeadCell className="w-full min-w-[7rem] max-w-0 sm:min-w-[9rem]">
								Task
							</HeadCell>
							{columns.project && <HeadCell>Project</HeadCell>}
							{columns.forChip && <HeadCell>For</HeadCell>}
							{columns.timeIn && <HeadCell>In</HeadCell>}
							{columns.timeOut && <HeadCell>Out</HeadCell>}
							{columns.breakTime && <HeadCell>Break</HeadCell>}
							<HeadCell className="text-right">Dur</HeadCell>
							{columns.amount && (
								<HeadCell className="text-right">Amount</HeadCell>
							)}
							<HeadCell className="w-px">
								<span className="sr-only">Actions</span>
							</HeadCell>
						</tr>
					</thead>
					{groups.map((group, groupIndex) => {
						const isCollapsed = Boolean(collapsed[group.key]);
						return (
							<tbody key={group.key} data-group={group.kind}>
								<GroupHeaderRow
									group={group}
									collapsed={isCollapsed}
									leadingSpan={leadingSpan}
									showAmount={columns.amount}
									isFirst={groupIndex === 0}
									onToggle={toggleGroup}
								/>
								{!isCollapsed &&
									group.entries.map((entry, rowIndex) => {
										const lockOptions = lockOptionsFor(entry);
										return (
											<EntryRow
												key={entry.id}
												entry={entry}
												mode={mode}
												rowNumber={firstNumber[groupIndex] + rowIndex}
												staggerIndex={Math.min(rowIndex, MAX_STAGGER_STEPS)}
												columns={columns}
												timeZone={tz}
												native={native}
												lockText={
													mode === "mine"
														? entryLockCopy(entry, lockOptions)
														: null
												}
												selectionRule={
													selectionOn
														? entrySelection(entry, mode, lockOptions)
														: null
												}
												selected={Boolean(selection?.selectedIds.has(entry.id))}
												onSelect={setSelected}
												pending={pending.has(entry.id)}
												canOpenTask={Boolean(canOpenTask?.(entry))}
												openMenuRowId={openMenuRowId}
												onSetOpenMenuRowId={setOpenMenuRowId}
												onOpenEntry={onOpenEntry}
												onStop={onStop}
												onEdit={onEdit}
												onChangeTask={onChangeTask}
												onChangeFor={onChangeFor}
												onDelete={onDelete}
												onOpenTask={onOpenTask}
												projectWorkspaceName={projectWorkspaceName}
												menuZIndexClassName={menuZIndexClassName}
												popoverZIndex={popoverZIndex}
											/>
										);
									})}
							</tbody>
						);
					})}
				</table>
			</div>
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

function SelectAllBox({
	checked,
	indeterminate,
	disabled,
	onChange,
}: {
	checked: boolean;
	indeterminate: boolean;
	disabled: boolean;
	onChange: (on: boolean) => void;
}) {
	const ref = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		if (ref.current) ref.current.indeterminate = indeterminate;
	}, [indeterminate]);
	return (
		<input
			ref={ref}
			type="checkbox"
			aria-label="Select all entries you can change"
			checked={checked}
			disabled={disabled}
			onChange={(event) => onChange(event.target.checked)}
			className="h-3.5 w-3.5 cursor-pointer accent-primary disabled:cursor-not-allowed"
		/>
	);
}

// ── Group header ────────────────────────────────────────────────────────────

const GroupHeaderRow = memo(function GroupHeaderRow({
	group,
	collapsed,
	leadingSpan,
	showAmount,
	isFirst,
	onToggle,
}: {
	group: EntryGroup;
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
			className={cn(
				"cursor-pointer select-none border-b transition-colors duration-150 [&>td]:align-middle",
				isReview
					? "border-warning/40 bg-warning/10 hover:bg-warning/15"
					: "border-border bg-muted/30 hover:bg-muted/60",
				isFirst ? "" : "border-t",
			)}
		>
			<td colSpan={leadingSpan} className="px-2 py-1.5 sm:px-3">
				{/* `w-0 min-w-full` keeps a long label from widening the columns it spans. */}
				<div className="w-0 min-w-full">
					{/* The row handles the click so the whole band is a target; the
					    button keeps the toggle keyboard-reachable. */}
					<button
						type="button"
						aria-expanded={!collapsed}
						className="flex w-full items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
					>
						<ChevronRight
							aria-hidden="true"
							className={cn(
								"h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-out",
								collapsed ? "" : "rotate-90",
								isReview ? "text-warning" : "text-muted-foreground",
							)}
						/>
						{isReview && (
							<AlertTriangle
								aria-hidden="true"
								className="h-3.5 w-3.5 shrink-0 text-warning"
							/>
						)}
						<span className="truncate text-[11px] font-semibold uppercase tracking-wide text-foreground">
							{group.label}
						</span>
						{!isReview && (
							<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
								· {group.entries.length}
							</span>
						)}
						{group.caption ? (
							<span className="hidden shrink-0 text-[11px] font-normal normal-case text-muted-foreground md:inline">
								{group.caption}
							</span>
						) : null}
					</button>
				</div>
			</td>
			<td className="px-2 py-1.5 text-right sm:px-3">
				<GroupTotal
					entries={group.entries}
					active={group.running}
					warnOver={group.kind === "day"}
				/>
			</td>
			{showAmount && <td />}
			<td />
		</tr>
	);
});

/** The group's total, live while a timer runs. A day over 8 hours shows ⚠. */
const GroupTotal = memo(function GroupTotal({
	entries,
	active,
	warnOver,
}: {
	entries: TimeEntryView[];
	active: boolean;
	warnOver: boolean;
}) {
	const nowMs = useLiveNowMs(active);
	const total = entries.reduce(
		(sum, entry) => sum + entryWorkSeconds(entry, nowMs),
		0,
	);
	const over = warnOver && total > DAY_WARNING_SECONDS;
	return (
		<span
			className={cn(
				"inline-flex items-center justify-end gap-1 text-[11px] font-semibold tabular-nums",
				// The solid `warning` hue is for fills and icons; as text it reads at
				// about 2:1, so the word uses its readable counterpart.
				over ? "text-warning-foreground" : "text-muted-foreground",
			)}
			title={over ? ENTRY_COPY.dayOver : undefined}
		>
			{formatClock(total)}
			{over ? (
				<>
					<AlertTriangle className="h-3 w-3" aria-hidden="true" />
					<span className="sr-only">{ENTRY_COPY.dayOver}</span>
				</>
			) : null}
		</span>
	);
});

// ── Row ─────────────────────────────────────────────────────────────────────

function CellIcon({
	icon: Icon,
}: {
	icon: ComponentType<{ className?: string }>;
}) {
	return (
		<Icon
			className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
			aria-hidden="true"
		/>
	);
}

/**
 * Icon-only action that slides in on row hover or keyboard focus (md and up).
 * A disabled one says why in its tooltip ("Stop the timer to edit its times.").
 */
function QuickAction({
	icon: Icon,
	label,
	onClick,
	disabled,
	reason,
}: {
	icon: ComponentType<{ className?: string }>;
	label: string;
	onClick: () => void;
	disabled?: boolean;
	reason?: string | null;
}) {
	return (
		<button
			type="button"
			title={(disabled && reason) || label}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className="hidden h-7 w-7 translate-x-1 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all duration-200 ease-out hover:bg-muted hover:text-foreground focus-visible:translate-x-0 focus-visible:opacity-100 active:scale-90 disabled:cursor-not-allowed disabled:opacity-0 group-hover/row:translate-x-0 group-hover/row:opacity-100 group-hover/row:disabled:opacity-30 group-focus-within/row:translate-x-0 group-focus-within/row:opacity-100 md:inline-flex"
		>
			<Icon className="h-3.5 w-3.5" />
		</button>
	);
}

const ACTION_ICON: Record<
	EntryActionId,
	ComponentType<{ className?: string }>
> = {
	stop: Square,
	view: Eye,
	comment: MessageSquare,
	edit: Pencil,
	change_task: SquarePen,
	change_for: Repeat,
	delete: Trash2,
	open_task: SquareArrowOutUpRight,
};

const ACTION_LABEL: Record<EntryActionId, string> = {
	stop: ENTRY_COPY.stopTimer,
	view: ENTRY_COPY.viewDetails,
	comment: ENTRY_COPY.comment,
	edit: ENTRY_COPY.edit,
	change_task: ENTRY_COPY.changeTask,
	change_for: ENTRY_COPY.changeFor,
	delete: ENTRY_COPY.delete,
	open_task: ENTRY_COPY.openTask,
};

/** A menu item's text: a disabled item with a reason says it after the label. */
export function menuItemLabel(
	label: string,
	rule: { disabled: boolean; reason: string | null },
): string {
	return rule.disabled && rule.reason ? `${label} · ${rule.reason}` : label;
}

/**
 * The For chip opens "Who approves this time" (a portal). React bubbles a
 * portal's clicks through the component tree, so the cell holding the chip
 * keeps them from reaching the row's open-detail click.
 */
const stopRowClick = (event: { stopPropagation: () => void }) =>
	event.stopPropagation();

interface EntryRowProps {
	entry: TimeEntryView;
	mode: EntriesTableMode;
	rowNumber: number;
	staggerIndex: number;
	columns: VisibleColumns;
	timeZone: string;
	native: boolean;
	lockText: string | null;
	selectionRule: { selectable: boolean; reason: string | null } | null;
	selected: boolean;
	onSelect: (id: string, on: boolean) => void;
	pending: boolean;
	canOpenTask: boolean;
	openMenuRowId: string | null;
	onSetOpenMenuRowId: (id: string | null) => void;
	onOpenEntry?: TimeEntriesTableProps["onOpenEntry"];
	onStop?: TimeEntriesTableProps["onStop"];
	onEdit?: TimeEntriesTableProps["onEdit"];
	onChangeTask?: TimeEntriesTableProps["onChangeTask"];
	onChangeFor?: TimeEntriesTableProps["onChangeFor"];
	onDelete?: TimeEntriesTableProps["onDelete"];
	onOpenTask?: TimeEntriesTableProps["onOpenTask"];
	projectWorkspaceName?: string | null;
	menuZIndexClassName?: string;
	popoverZIndex?: number;
}

const EntryRow = memo(function EntryRow({
	entry,
	mode,
	rowNumber,
	staggerIndex,
	columns,
	timeZone,
	native,
	lockText,
	selectionRule,
	selected,
	onSelect,
	pending,
	canOpenTask,
	openMenuRowId,
	onSetOpenMenuRowId,
	onOpenEntry,
	onStop,
	onEdit,
	onChangeTask,
	onChangeFor,
	onDelete,
	onOpenTask,
	projectWorkspaceName,
	menuZIndexClassName,
	popoverZIndex,
}: EntryRowProps) {
	const running = !entry.ended_at;
	const nowMs = useLiveNowMs(running);
	const hidden = isHiddenContent(entry);
	const locked = isEntryLocked(entry);
	const title = entryTitle(entry);
	const project = entryProjectLabel(entry);
	const status = entryStatusLabel(entry);
	const accent = entryAccent(entry);
	const reviewNote = needsReviewCopy(entry, { nowMs });
	const workSeconds = entryWorkSeconds(entry, nowMs);
	const breakSeconds = entryBreakSeconds(entry, nowMs);
	const amount = columns.amount ? entryAmount(entry, nowMs) : null;

	const startedLabel = formatInstantTime(entry.started_at, timeZone);
	const endedLabel = entry.ended_at
		? sameLocalDay(entry.started_at, entry.ended_at, timeZone)
			? formatInstantTime(entry.ended_at, timeZone)
			: formatInstantDateTime(entry.ended_at, timeZone, {
					userTimezone: timeZone,
				})
		: null;

	const rules = useMemo(
		() => entryActions(entry, { mode, pending, canOpenTask }),
		[entry, mode, pending, canOpenTask],
	);
	const editable = mode === "mine" && !locked && !hidden;

	const handlers: Partial<Record<EntryActionId, () => void>> = {
		stop: onStop ? () => onStop(entry) : undefined,
		view: onOpenEntry ? () => onOpenEntry(entry) : undefined,
		comment: onOpenEntry
			? () => onOpenEntry(entry, { focus: "comments" })
			: undefined,
		edit: onEdit ? () => onEdit(entry) : undefined,
		change_task: onChangeTask ? () => onChangeTask(entry) : undefined,
		change_for: onChangeFor ? () => onChangeFor([entry]) : undefined,
		delete: onDelete ? () => onDelete(entry) : undefined,
		open_task: onOpenTask ? () => onOpenTask(entry) : undefined,
	};
	const menuItems: ActionMenuItem[] = rules
		.filter((rule) => handlers[rule.id])
		.map((rule) => {
			const Icon = ACTION_ICON[rule.id];
			return {
				id: rule.id,
				// RowActionsMenu has no hint line, so a disabled item carries its
				// reason in its label: "Edit · Stop the timer to edit its times."
				label: menuItemLabel(ACTION_LABEL[rule.id], rule),
				icon: <Icon className="h-3.5 w-3.5" />,
				onSelect: handlers[rule.id] as () => void,
				disabled: rule.disabled,
				tone: rule.id === "delete" ? "danger" : undefined,
			};
		});
	const stopRule = rules.find((rule) => rule.id === "stop");
	const editRule = rules.find((rule) => rule.id === "edit");

	const openDetail = onOpenEntry ? () => onOpenEntry(entry) : undefined;

	const chipProjectId = mode === "mine" && !hidden ? entry.project_id : null;
	const chip = (
		<ForChip
			option={forChipOptionFromEntry(entry)}
			variant={lockText ? "locked" : "readonly"}
			lockedText={lockText}
			projectId={chipProjectId}
			projectWorkspaceName={projectWorkspaceName}
			popoverZIndex={popoverZIndex}
		/>
	);
	// Only a chip with a popover needs its clicks kept from the row.
	const chipClick = chipProjectId ? stopRowClick : undefined;

	// What the dropped columns held, folded back into the task cell. The clock
	// range joins only from sm up: below that the cell is ~112 px wide.
	const foldProject = !columns.project && Boolean(project);
	const foldTime = !columns.timeIn;
	const foldFor = !columns.forChip;
	const timeText = columns.rowNumber
		? `${startedLabel} – ${endedLabel ?? "now"}`
		: startedLabel;

	const tone = pending
		? "bg-warning/10"
		: running
			? "bg-primary/[0.06] hover:bg-primary/10"
			: selected
				? "bg-primary/[0.04] hover:bg-primary/[0.08]"
				: "hover:bg-muted/60";

	return (
		<tr
			className={cn(
				"group/row time-row-in border-b border-border/60 transition-colors duration-150 [&>td]:align-middle",
				tone,
				openDetail ? "cursor-pointer" : "",
			)}
			style={{ "--row-i": staggerIndex } as CSSProperties}
			onClick={openDetail}
			data-entry-id={entry.id}
			data-locked={locked ? "true" : undefined}
			data-accent={accent}
			aria-busy={pending || undefined}
		>
			{selectionRule ? (
				<td
					className="w-px py-1.5 pl-2 pr-0 sm:pl-3"
					onClick={(event) => event.stopPropagation()}
				>
					<input
						type="checkbox"
						aria-label={`Select ${title.text}`}
						checked={selected && selectionRule.selectable}
						disabled={!selectionRule.selectable || pending}
						title={selectionRule.reason ?? undefined}
						onChange={(event) => onSelect(entry.id, event.target.checked)}
						className="h-3.5 w-3.5 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
					/>
				</td>
			) : null}

			{/* Status accent bar, and the row number once there is room. */}
			<td
				className={cn(
					"w-px whitespace-nowrap border-l-[3px] py-1.5 pl-0 pr-0 sm:pl-3 sm:pr-1",
					ACCENT_CLASS[accent],
				)}
				title={status}
			>
				{columns.rowNumber && (
					<span className="inline-flex min-w-[1.25rem] justify-center rounded-md bg-muted px-1 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
						{rowNumber}
					</span>
				)}
				<span className="sr-only">{status}</span>
			</td>

			{/* Task: absorbs the free width so `truncate` has something to cut. */}
			<td className="w-full min-w-[7rem] max-w-0 px-2 py-1.5 sm:min-w-[9rem] sm:px-3">
				<div className="min-w-0">
					<div className="flex items-center gap-1.5">
						{title.kind === "preset" ? (
							<span
								aria-hidden="true"
								className="shrink-0 text-muted-foreground"
							>
								◦
							</span>
						) : null}
						<span
							className={cn(
								"block truncate text-[13px]",
								title.kind === "task"
									? "font-medium text-foreground"
									: title.kind === "hidden"
										? "italic text-muted-foreground"
										: "text-foreground",
							)}
							title={title.text}
						>
							{title.text}
						</span>
						{hidden ? (
							<span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
								{workItemLabel(entry.work_item)}
							</span>
						) : null}
						{reviewNote ? (
							<span className="inline-flex shrink-0" title={reviewNote}>
								<AlertTriangle
									className="h-3 w-3 text-warning"
									aria-hidden="true"
								/>
								<span className="sr-only">{reviewNote}</span>
							</span>
						) : null}
						{running ? <RunningPill onBreak={isOnBreak(entry)} /> : null}
						<EntryBadges entry={entry} native={native} />
					</div>
					{foldProject || foldTime || foldFor ? (
						<div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-muted-foreground">
							{foldProject && <span className="truncate">{project}</span>}
							{foldProject && foldTime && <span className="shrink-0">·</span>}
							{foldTime && (
								<span className="shrink-0 whitespace-nowrap tabular-nums">
									{timeText}
								</span>
							)}
							{foldFor ? (
								<span
									className="inline-flex min-w-0 max-w-full"
									onClick={chipClick}
								>
									{chip}
								</span>
							) : null}
						</div>
					) : null}
				</div>
			</td>

			{columns.project && (
				<td className="max-w-[190px] px-2 py-1.5 sm:px-3">
					{project ? (
						<div className="flex items-center gap-1.5">
							<CellIcon icon={FolderKanban} />
							<span
								className="truncate text-xs text-muted-foreground"
								title={project}
							>
								{project}
							</span>
						</div>
					) : (
						<span className="text-xs text-muted-foreground">—</span>
					)}
				</td>
			)}

			{columns.forChip && (
				<td className="max-w-[220px] px-2 py-1.5 sm:px-3" onClick={chipClick}>
					{chip}
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
						{endedLabel ?? (
							<span className="font-medium text-primary">now</span>
						)}
					</span>
				</td>
			)}

			{columns.breakTime && (
				<td className="whitespace-nowrap px-2 py-1.5 sm:px-3">
					<span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
						<CellIcon icon={Coffee} />
						{breakSeconds >= 60 ? formatDurationText(breakSeconds) : "—"}
					</span>
				</td>
			)}

			<td className="whitespace-nowrap px-2 py-1.5 text-right text-[13px] font-semibold tabular-nums text-foreground sm:px-3">
				{formatClock(workSeconds)}
			</td>

			{columns.amount && (
				<td className="whitespace-nowrap px-2 py-1.5 text-right text-[13px] font-medium sm:px-3">
					<AmountLines
						amounts={amountRecord(amount)}
						cost={entry.cost}
						kind={entry.context_kind}
						native={native}
						tone={amount?.final ? "default" : "muted"}
						title={amount && !amount.final ? ENTRY_COPY.estimate : undefined}
						empty="—"
					/>
				</td>
			)}

			{/* Actions. The quick buttons hold their width at rest, so revealing
			    them on hover never reflows the table. */}
			<td
				className="w-px whitespace-nowrap py-1 pl-2 pr-2"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="flex items-center justify-end gap-0.5">
					{running && stopRule && onStop ? (
						<button
							type="button"
							onClick={() => onStop(entry)}
							disabled={stopRule.disabled}
							className="mr-1 inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-95 disabled:opacity-50"
						>
							<Square className="h-3 w-3" aria-hidden="true" />
							<span className="hidden sm:inline">{ENTRY_COPY.stop}</span>
							<span className="sr-only sm:hidden">{ENTRY_COPY.stopTimer}</span>
						</button>
					) : null}
					{editable && onOpenEntry ? (
						<QuickAction
							icon={Eye}
							label={ENTRY_COPY.viewDetails}
							onClick={() => onOpenEntry(entry)}
						/>
					) : null}
					{editable && onEdit && editRule ? (
						<QuickAction
							icon={Pencil}
							label={ENTRY_COPY.edit}
							onClick={() => onEdit(entry)}
							disabled={editRule.disabled}
							reason={editRule.reason}
						/>
					) : null}
					{menuItems.length > 0 ? (
						<RowActionsMenu
							rowId={entry.id}
							openMenuRowId={openMenuRowId}
							onSetOpenMenuRowId={onSetOpenMenuRowId}
							items={menuItems}
							loading={pending}
							menuZIndexClassName={menuZIndexClassName}
						/>
					) : null}
				</div>
			</td>
		</tr>
	);
});

function sameLocalDay(a: string, b: string, timeZone: string): boolean {
	try {
		return localDate(a, timeZone) === localDate(b, timeZone);
	} catch {
		return true;
	}
}

function RunningPill({ onBreak }: { onBreak: boolean }) {
	return (
		<span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary">
			<span className="relative flex h-1.5 w-1.5" aria-hidden="true">
				{!onBreak && (
					<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
				)}
				<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
			</span>
			{onBreak ? ENTRY_COPY.onBreak : ENTRY_COPY.running}
		</span>
	);
}

// ── Loading ─────────────────────────────────────────────────────────────────

export function EntriesTableSkeleton() {
	return (
		<div
			className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
			aria-busy="true"
			data-testid="entries-skeleton"
		>
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
	);
}
