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
	Eye,
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
	workItemLabel,
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
//
// A spreadsheet: one row per entry with its full date, a strong header row
// and a totals row. It never scrolls sideways: the table is fixed-layout and
// fits its box, and as the width shrinks it drops columns in order (Notes,
// then Break, then Time in/out fold into one "1:00 – 2:00 PM" cell, then
// Amount). Below 640 px each row stacks: date and hours, then project ·
// task, with the status on the right.

export interface VisibleColumns {
	/** More than one For in view (otherwise every row would say the same). */
	forChip: boolean;
	amount: boolean;
	notes: boolean;
	breakTime: boolean;
	/** Time in and Time out as one "1:00 – 2:00 PM" cell. */
	combinedTimes: boolean;
	/** Below 640 px: two-line rows instead of columns. */
	stacked: boolean;
}

/** Widths (px) at which a column goes; see the comment above. */
export const SHEET_BREAKPOINTS = {
	notes: 1280,
	breakTime: 1100,
	splitTimes: 960,
	amount: 800,
	stacked: 640,
} as const;

/** The columns a table of `width` px shows. Pure; the hook feeds it the viewport. */
export function sheetColumns(
	width: number,
	options: { hasAmounts: boolean; multipleFors: boolean },
): VisibleColumns {
	const stacked = width < SHEET_BREAKPOINTS.stacked;
	return {
		stacked,
		forChip: options.multipleFors && !stacked,
		notes: width >= SHEET_BREAKPOINTS.notes,
		breakTime: width >= SHEET_BREAKPOINTS.breakTime,
		combinedTimes: width < SHEET_BREAKPOINTS.splitTimes,
		amount: options.hasAmounts && width >= SHEET_BREAKPOINTS.amount,
	};
}

/**
 * Sheet order, as in a paper timesheet: started_at ascending (ties by id),
 * so the newest entry, a running one included, is the last row, right above
 * the totals.
 */
export function sortSheetEntries(
	entries: readonly TimeEntryView[],
): TimeEntryView[] {
	return [...entries].sort((a, b) => {
		const time = Date.parse(a.started_at) - Date.parse(b.started_at);
		if (time !== 0) return time;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
}

/** "Fri, Nov 7, 2025" in `timeZone`. */
export function formatSheetDate(iso: string, timeZone: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	return new Intl.DateTimeFormat("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: safeTimezone(timeZone),
	}).format(date);
}

/** "1:00 PM" in `timeZone`. */
export function formatSheetTime(
	iso: string | null | undefined,
	timeZone: string,
): string {
	if (!iso) return "—";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	return new Intl.DateTimeFormat("en-US", {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
		timeZone: safeTimezone(timeZone),
	}).format(date);
}

/** Hours as a decimal with two places: 9.00, 1.98. */
export function formatDecimalHours(seconds: number): string {
	return (Math.max(0, seconds) / 3600).toFixed(2);
}

/** Whole break minutes, "0" when none. */
export function breakMinutes(seconds: number): string {
	return String(Math.floor(Math.max(0, seconds) / 60));
}

/** The totals row: work seconds, and money per currency when shown. */
export function entriesTotals(
	entries: readonly TimeEntryView[],
	options: { nowMs?: number; amounts?: boolean } = {},
): { seconds: number; amounts: Record<string, number> } {
	const nowMs = options.nowMs ?? serverNow();
	let seconds = 0;
	const amounts: Record<string, number> = {};
	for (const entry of entries) {
		seconds += entryWorkSeconds(entry, nowMs);
		if (!options.amounts) continue;
		const amount = entryAmount(entry, nowMs);
		if (amount) {
			amounts[amount.currency] =
				(amounts[amount.currency] ?? 0) + amount.amount;
		}
	}
	return { seconds, amounts };
}

function useVisibleColumns(
	entries: readonly TimeEntryView[],
	hasAmounts: boolean,
): VisibleColumns {
	const belowNotes = useIsMobile(SHEET_BREAKPOINTS.notes - 1);
	const belowBreak = useIsMobile(SHEET_BREAKPOINTS.breakTime - 1);
	const belowSplit = useIsMobile(SHEET_BREAKPOINTS.splitTimes - 1);
	const belowAmount = useIsMobile(SHEET_BREAKPOINTS.amount - 1);
	const belowStacked = useIsMobile(SHEET_BREAKPOINTS.stacked - 1);
	// The narrowest tier the viewport is in, as a width the helper reads.
	const width = belowStacked
		? SHEET_BREAKPOINTS.stacked - 1
		: belowAmount
			? SHEET_BREAKPOINTS.amount - 1
			: belowSplit
				? SHEET_BREAKPOINTS.splitTimes - 1
				: belowBreak
					? SHEET_BREAKPOINTS.breakTime - 1
					: belowNotes
						? SHEET_BREAKPOINTS.notes - 1
						: SHEET_BREAKPOINTS.notes;
	return useMemo(() => {
		const fors = new Set(
			entries.map((e) => `${e.context_kind}:${e.context_ref ?? ""}`),
		);
		return sheetColumns(width, {
			hasAmounts,
			multipleFors: fors.size > 1,
		});
	}, [entries, hasAmounts, width]);
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
	// The sheet: Needs review (when any) folds on top; every other entry is
	// one flat list in `sortSheetEntries` order (no day headers: each row
	// carries its full date).
	const sheetGroups = useMemo(() => {
		const review = groups.filter((group) => group.kind === "review");
		const rest = groups
			.filter((group) => group.kind !== "review")
			.flatMap((group) => group.entries);
		if (rest.length === 0) return review;
		const first = groups.find((group) => group.kind !== "review");
		return [
			...review,
			{
				...(first as EntryGroup),
				key: "sheet",
				entries: sortSheetEntries(rest),
				running: rest.some((e) => !e.ended_at),
			},
		];
	}, [groups]);

	const sheetById = useMemo(() => {
		const map = new Map<string, EntrySheetInfo>();
		for (const sheet of sheets ?? []) map.set(sheet.id, sheet);
		return map;
	}, [sheets]);
	const pending = useMemo(() => toIdSet(pendingIds), [pendingIds]);

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
	const columns = useVisibleColumns(entries, hasAmounts);

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

	// Cells the Needs review band and the totals row span before Hours.
	const leadingSpan = columns.stacked
		? (selectionOn ? 1 : 0) + 1
		: (selectionOn ? 1 : 0) +
			3 +
			(columns.forChip ? 1 : 0) +
			(columns.combinedTimes ? 1 : 2) +
			(columns.breakTime ? 1 : 0);
	// Stacked rows: [select] · entry · actions, so the band and the totals
	// take one cell for the entry and one (hours) for the actions column.
	const trailingSpan = columns.stacked
		? 0
		: (columns.amount ? 1 : 0) + 2 + (columns.notes ? 1 : 0);

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

			<div
				className="overflow-hidden rounded-lg border border-border bg-card"
				data-testid="entries-sheet"
			>
				<table className="w-full table-fixed border-collapse text-left text-[13px]">
					<thead className={columns.stacked ? "sr-only" : undefined}>
						<tr className="bg-foreground text-background">
							{selectionOn ? (
								<HeadCell className="w-10">
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
							{columns.stacked ? (
								<HeadCell>Entry</HeadCell>
							) : (
								<>
									<HeadCell className="w-[8.5rem]">Date</HeadCell>
									<HeadCell className="w-[14%]">Project</HeadCell>
									<HeadCell>Task</HeadCell>
									{columns.forChip && (
										<HeadCell className="w-[12%]">For</HeadCell>
									)}
									{columns.combinedTimes ? (
										<HeadCell className="w-[9.5rem]">Time</HeadCell>
									) : (
										<>
											<HeadCell className="w-[5.5rem]">Time in</HeadCell>
											<HeadCell className="w-[5.5rem]">Time out</HeadCell>
										</>
									)}
									{columns.breakTime && (
										<HeadCell className="w-[6.5rem] text-right">
											Break (mins)
										</HeadCell>
									)}
									<HeadCell className="w-[4.5rem] text-right">Hours</HeadCell>
									{columns.amount && (
										<HeadCell className="w-[6.5rem] text-right">
											Amount
										</HeadCell>
									)}
									<HeadCell className="w-[7.5rem]">Status</HeadCell>
									{columns.notes && (
										<HeadCell className="w-[14%]">Notes</HeadCell>
									)}
								</>
							)}
							<HeadCell className="w-[5.5rem]">
								<span className="sr-only">Actions</span>
							</HeadCell>
						</tr>
					</thead>
					{sheetGroups.map((group) => {
						const isReview = group.kind === "review";
						const isCollapsed = isReview && Boolean(collapsed[group.key]);
						return (
							<tbody key={group.key} data-group={group.kind}>
								{isReview ? (
									<GroupHeaderRow
										group={group}
										collapsed={isCollapsed}
										leadingSpan={leadingSpan}
										trailingSpan={trailingSpan}
										onToggle={toggleGroup}
									/>
								) : null}
								{!isCollapsed &&
									group.entries.map((entry, rowIndex) => {
										const lockOptions = lockOptionsFor(entry);
										return (
											<EntryRow
												key={entry.id}
												entry={entry}
												mode={mode}
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
					<TotalsRow
						entries={entries}
						running={hasRunning}
						leadingSpan={leadingSpan}
						showAmount={columns.amount}
						trailingSpan={trailingSpan - (columns.amount ? 1 : 0)}
						native={native}
					/>
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
			className={`whitespace-nowrap border border-foreground px-2 py-2 text-xs font-bold ${className}`}
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
			className="h-3.5 w-3.5 cursor-pointer accent-primary disabled:cursor-not-allowed max-sm:h-5 max-sm:w-5"
		/>
	);
}

// ── Group header ────────────────────────────────────────────────────────────

const GroupHeaderRow = memo(function GroupHeaderRow({
	group,
	collapsed,
	leadingSpan,
	trailingSpan,
	onToggle,
}: {
	group: EntryGroup;
	collapsed: boolean;
	leadingSpan: number;
	trailingSpan: number;
	onToggle: (key: string) => void;
}) {
	return (
		<tr
			onClick={() => onToggle(group.key)}
			className="cursor-pointer select-none border-b border-warning/40 bg-warning/10 transition-colors duration-150 hover:bg-warning/15 [&>td]:align-middle"
		>
			<td colSpan={leadingSpan} className="px-2 py-1.5 max-sm:py-3">
				<button
					type="button"
					aria-expanded={!collapsed}
					className="flex items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
				>
					<ChevronRight
						aria-hidden="true"
						className={cn(
							"h-3.5 w-3.5 shrink-0 text-warning transition-transform duration-200 ease-out",
							collapsed ? "" : "rotate-90",
						)}
					/>
					<AlertTriangle
						aria-hidden="true"
						className="h-3.5 w-3.5 shrink-0 text-warning"
					/>
					<span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
						{group.label}
					</span>
					{group.caption ? (
						<span className="text-[11px] font-normal normal-case text-muted-foreground">
							{group.caption}
						</span>
					) : null}
				</button>
			</td>
			<td className="px-2 py-1.5 text-right">
				<GroupTotal
					entries={group.entries}
					active={group.running}
					warnOver={false}
				/>
			</td>
			{trailingSpan > 0 ? <td colSpan={trailingSpan} /> : null}
		</tr>
	);
});

/** The totals row: the hours (and money) of every row shown. */
const TotalsRow = memo(function TotalsRow({
	entries,
	running,
	leadingSpan,
	showAmount,
	trailingSpan,
	native,
}: {
	entries: readonly TimeEntryView[];
	running: boolean;
	leadingSpan: number;
	trailingSpan: number;
	showAmount: boolean;
	native: boolean;
}) {
	const nowMs = useLiveNowMs(running);
	const totals = entriesTotals(entries, { nowMs, amounts: showAmount });
	const first = entries.find((e) =>
		canShowAmounts({ cost: e.cost, kind: e.context_kind, native }),
	);
	return (
		<tfoot>
			<tr
				className="border-t-2 border-foreground bg-muted font-bold"
				data-testid="entries-totals"
			>
				<td
					colSpan={leadingSpan}
					className="border border-border bg-muted px-2 py-1.5"
				>
					Total
				</td>
				<td
					className="border border-border px-2 py-1.5 text-right tabular-nums"
					data-testid="entries-total-hours"
				>
					{formatDecimalHours(totals.seconds)}
				</td>
				{showAmount ? (
					<td
						className="border border-border px-2 py-1.5 text-right tabular-nums"
						data-testid="entries-total-amount"
					>
						{first ? (
							<AmountLines
								amounts={totals.amounts}
								cost={first.cost}
								kind={first.context_kind}
								native={native}
								empty="—"
							/>
						) : (
							"—"
						)}
					</td>
				) : null}
				{trailingSpan > 0 ? (
					<td colSpan={trailingSpan} className="border border-border" />
				) : null}
			</tr>
		</tfoot>
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

	const dateLabel = formatSheetDate(entry.started_at, timeZone);
	const startedLabel = formatSheetTime(entry.started_at, timeZone);
	// Past midnight the out time names its day: "Sat, Nov 8, 2025, 1:00 AM".
	const endedLabel = entry.ended_at
		? sameLocalDay(entry.started_at, entry.ended_at, timeZone)
			? formatSheetTime(entry.ended_at, timeZone)
			: `${formatSheetDate(entry.ended_at, timeZone)}, ${formatSheetTime(entry.ended_at, timeZone)}`
		: null;
	const note = hidden ? null : entry.note?.trim() || null;
	const statusCell = (
		<div className="flex flex-wrap items-center gap-1">
			{running ? (
				<RunningPill onBreak={isOnBreak(entry)} />
			) : (
				<span className="rounded bg-muted px-1.5 py-px text-[10px] font-semibold text-foreground">
					{status}
				</span>
			)}
			{reviewNote ? (
				<span
					className="inline-flex shrink-0 items-center gap-0.5 rounded bg-warning/10 px-1 py-px text-[10px] font-semibold text-warning-foreground"
					title={reviewNote}
				>
					<AlertTriangle className="h-3 w-3" aria-hidden="true" />
					Needs review
					<span className="sr-only">{reviewNote}</span>
				</span>
			) : null}
			<EntryBadges entry={entry} native={native} />
		</div>
	);

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
				"group/row time-row-in h-8 transition-colors duration-150 even:bg-muted/30 [&>td]:align-middle",
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
					className="w-px border border-border px-2 py-1.5 max-sm:px-3"
					onClick={(event) => {
						event.stopPropagation();
						// The cell is the tap target (the whole row height on a
						// phone), not only the small box inside it.
						if (
							event.target === event.currentTarget &&
							selectionRule.selectable &&
							!pending
						) {
							onSelect(entry.id, !selected);
						}
					}}
				>
					<input
						type="checkbox"
						aria-label={`Select ${title.text}`}
						checked={selected && selectionRule.selectable}
						disabled={!selectionRule.selectable || pending}
						title={selectionRule.reason ?? undefined}
						onChange={(event) => onSelect(entry.id, event.target.checked)}
						className="h-3.5 w-3.5 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40 max-sm:h-5 max-sm:w-5"
					/>
				</td>
			) : null}

			{columns.stacked ? (
				<td
					className={cn(
						"border-y border-r border-border border-l-[3px] px-2 py-2",
						ACCENT_CLASS[accent],
					)}
					title={status}
				>
					<div className="flex items-baseline justify-between gap-2">
						<span className="truncate font-medium text-foreground">
							{dateLabel}
						</span>
						<span
							className="shrink-0 font-semibold tabular-nums text-foreground"
							data-testid="entry-hours"
						>
							{formatDecimalHours(workSeconds)}
						</span>
					</div>
					<div className="mt-0.5 flex items-center justify-between gap-2">
						<span
							className="min-w-0 truncate text-xs text-muted-foreground"
							title={[project, title.text].filter(Boolean).join(" · ")}
						>
							{[project, title.text].filter(Boolean).join(" · ")}
						</span>
						<span className="shrink-0">{statusCell}</span>
					</div>
				</td>
			) : (
				<>
					{/* Date: the left accent carries the sheet status. */}
					<td
						className={cn(
							"truncate whitespace-nowrap border-y border-r border-border border-l-[3px] px-2 py-1.5 tabular-nums text-foreground",
							ACCENT_CLASS[accent],
						)}
						title={status}
					>
						{dateLabel}
					</td>

					<td className="border border-border px-2 py-1.5">
						<span
							className="block truncate text-muted-foreground"
							title={project ?? undefined}
						>
							{project ?? "—"}
						</span>
					</td>

					<td className="border border-border px-2 py-1.5">
						<div className="flex min-w-0 items-center gap-1.5">
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
									"block truncate",
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
						</div>
					</td>

					{columns.forChip && (
						<td
							className="overflow-hidden border border-border px-2 py-1.5"
							onClick={chipClick}
						>
							{chip}
						</td>
					)}

					{columns.combinedTimes ? (
						<td className="truncate whitespace-nowrap border border-border px-2 py-1.5 tabular-nums text-foreground">
							{startedLabel} – {endedLabel ?? "now"}
						</td>
					) : (
						<>
							<td className="truncate whitespace-nowrap border border-border px-2 py-1.5 tabular-nums text-foreground">
								{startedLabel}
							</td>
							<td
								className="truncate whitespace-nowrap border border-border px-2 py-1.5 tabular-nums text-foreground"
								title={endedLabel ?? undefined}
							>
								{endedLabel ?? (
									<span className="font-medium text-primary">now</span>
								)}
							</td>
						</>
					)}
					{columns.breakTime && (
						<td className="whitespace-nowrap border border-border px-2 py-1.5 text-right tabular-nums text-foreground">
							{breakMinutes(breakSeconds)}
						</td>
					)}
					<td
						className="whitespace-nowrap border border-border px-2 py-1.5 text-right font-semibold tabular-nums text-foreground"
						title={formatClock(workSeconds)}
						data-testid="entry-hours"
					>
						{formatDecimalHours(workSeconds)}
					</td>

					{columns.amount && (
						<td className="truncate whitespace-nowrap border border-border px-2 py-1.5 text-right tabular-nums">
							<AmountLines
								amounts={amountRecord(amount)}
								cost={entry.cost}
								kind={entry.context_kind}
								native={native}
								tone={amount?.final ? "default" : "muted"}
								title={
									amount && !amount.final ? ENTRY_COPY.estimate : undefined
								}
								empty="—"
							/>
						</td>
					)}

					<td className="overflow-hidden border border-border px-2 py-1.5">
						{statusCell}
					</td>

					{columns.notes && (
						<td className="border border-border px-2 py-1.5">
							<span
								className="block truncate text-muted-foreground"
								title={note ?? undefined}
							>
								{note ?? ""}
							</span>
						</td>
					)}
				</>
			)}

			{/* Actions. The quick buttons hold their width at rest, so revealing
			    them on hover never reflows the table. */}
			<td
				className="w-px whitespace-nowrap border border-border py-0.5 pl-2 pr-2"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="flex items-center justify-end gap-0.5">
					{running && stopRule && onStop ? (
						<button
							type="button"
							onClick={() => onStop(entry)}
							disabled={stopRule.disabled}
							className="mr-1 inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-95 disabled:opacity-50 max-sm:min-h-10 max-sm:min-w-10 max-sm:justify-center"
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
		// Foreground text: `text-primary` on `bg-primary/10` reads under 4:1 at
		// this size; the pulsing dot carries the colour.
		<span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-foreground">
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
