// web/src/components/time/calendar/TimeMonthView.tsx
//
// The Time page's Month view (ux.md › The Time Page, "Pieces to reuse":
// ported from team-time's TimeLogCalendar, own time only, Month layout only:
// the page's toggle is `List | Month`, and the week is the day strip's job).
//
// - Days are counted in `timeZone` (the view's: the For context's policy
//   timezone, else the person's own), and weeks start on `weekStart`.
// - It fetches its own range (the full weeks covering the month) from
//   `me/entries`, with the page's For and project filters, under the
//   `["time","me","entries",…]` prefix so every entry write refreshes it.
// - A day shows its total (h:mm, ⚠ over 8 h, the day strip's rule) and up to
//   three entries; a click opens that day (DayEntriesModal). On small screens
//   cells keep the total and a dot.
// - Row actions open this module's own dialogs (Edit, Delete, Change For)
//   above the day dialog, unless the page passes its own handlers. The entry
//   detail, Add time and Start timer belong to the page (callbacks).

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	CalendarDays,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ChangeForDialog } from "@/components/time/edit/ChangeForDialog";
import { DeleteEntryModal } from "@/components/time/edit/DeleteEntryModal";
import { EditEntryModal } from "@/components/time/edit/EditEntryModal";
import {
	DAY_WARNING_SECONDS,
	entryWorkSeconds,
} from "@/components/time/entries/entryRules";
import { entryWorkLabel } from "@/components/time/for/forCopy";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import { isNativeApp } from "@/lib/platform";
import { nativeSafe, timeErrorCopy } from "@/lib/timeErrors";
import {
	formatClock,
	formatDurationText,
	formatLocalDay,
	weekdayShort,
} from "@/lib/timeFormat";
import {
	addDays,
	eachDay,
	isLocalDate,
	localDate,
	monthWindow,
	safeTimezone,
	todayIn,
	weekWindow,
} from "@/lib/timePeriods";
import { cn } from "@/lib/utils";
import { retryTimeQuery, timeKeys } from "@/queries/time";
import { listAllMyEntries } from "@/services/time.service";
import type {
	LoggingForRequest,
	TimeEntryView,
	TimesheetSummary,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import {
	DAY_ENTRIES_COPY,
	DayEntriesModal,
	entryCountText,
	type OpenEntryContext,
} from "./DayEntriesModal";

export const MONTH_VIEW_COPY = {
	previous: "Previous month",
	next: "Next month",
	thisMonth: "This month",
	jump: "Jump to a month",
	previousYear: "Previous year",
	nextYear: "Next year",
	closePicker: "Close",
	tryAgain: "Try again",
	more: (count: number) => `+${count} more`,
	capped: (count: number) =>
		`Showing the first ${count.toLocaleString("en-US")} entries in this month.`,
} as const;

/** Most entries one month view loads (5 pages of 200). */
export const MONTH_MAX_ENTRIES = 1000;
/** Entries listed in a day cell before "+N more". */
export const MAX_CHIPS = 3;

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

// ── Pure helpers ────────────────────────────────────────────────────────────

/** "October 2026" for any local date in the month. */
export function monthTitle(date: string): string {
	const [y, m] = date.split("-").map(Number);
	return `${MONTH_NAMES[(m ?? 1) - 1] ?? ""} ${y}`;
}

/** The first day of the month before / after the one holding `date`. */
export function shiftMonth(date: string, n: -1 | 1): string {
	const month = monthWindow(date);
	return n < 0
		? monthWindow(addDays(month.start, -1)).start
		: addDays(month.end, 1);
}

export interface MonthGrid {
	month: { start: string; end: string };
	/** The full weeks covering the month (the fetched range). */
	start: string;
	end: string;
	days: string[];
	/** ISO weekdays in column order. */
	weekdays: number[];
}

/** The month holding `date`, laid out in full weeks starting on `weekStart`. */
export function monthGrid(date: string, weekStart: number): MonthGrid {
	const ws = weekStart >= 1 && weekStart <= 7 ? Math.trunc(weekStart) : 1;
	const month = monthWindow(date);
	const start = weekWindow(month.start, ws).start;
	const end = weekWindow(month.end, ws).end;
	return {
		month,
		start,
		end,
		days: eachDay({ start, end }),
		weekdays: Array.from({ length: 7 }, (_, i) => ((ws - 1 + i) % 7) + 1),
	};
}

/** Entries by their local start date in `timeZone`, earliest first within a day. */
export function entriesByDay(
	entries: readonly TimeEntryView[],
	timeZone: string,
): Map<string, TimeEntryView[]> {
	const map = new Map<string, TimeEntryView[]>();
	for (const entry of entries) {
		const key = localDate(entry.started_at, timeZone);
		const bucket = map.get(key);
		if (bucket) bucket.push(entry);
		else map.set(key, [entry]);
	}
	for (const bucket of map.values()) {
		bucket.sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
	}
	return map;
}

export type EntryTone =
	| "running"
	| "paid"
	| "approved"
	| "returned"
	| "submitted"
	| "open";

/** A chip's colour: running, then paid, then its timesheet's state. */
export function entryTone(
	entry: Pick<
		TimeEntryView,
		"ended_at" | "payout_id" | "payable_seconds" | "timesheet"
	>,
): EntryTone {
	if (!entry.ended_at) return "running";
	if (entry.payout_id) return "paid";
	const status = entry.timesheet?.status;
	if (status === "approved" || entry.payable_seconds != null) return "approved";
	if (status === "returned") return "returned";
	if (status === "submitted") return "submitted";
	return "open";
}

/** Theme tokens only (ux.md: grey Submitted, green Approved, amber Returned, blue Paid). */
const TONE_CLASS: Record<EntryTone, string> = {
	running: "bg-primary/10 text-primary",
	paid: "bg-info/10 text-info-foreground",
	approved: "bg-success/10 text-success-foreground",
	returned: "bg-warning/10 text-warning-foreground",
	submitted: "bg-muted text-muted-foreground",
	open: "border border-border bg-card text-foreground",
};

// ── Component ───────────────────────────────────────────────────────────────

/** Where an action opened from the month view should render its dialog. */
export interface MonthActionContext {
	zIndex: number;
}

export interface TimeMonthViewProps {
	/** Any local date (YYYY-MM-DD) in the month to show; with `onMonthChange` the page controls it. */
	month?: string;
	onMonthChange?: (date: string) => void;
	/** The timezone days are counted in (the view's). */
	timeZone: string;
	/** ISO weekday the weeks start on (1 = Monday). */
	weekStart?: number;
	/** The page's For filter (also makes `me/entries` count days in that context's timezone). */
	forRef?: LoggingForRequest | null;
	/** The page's project filter. */
	projectId?: string | null;
	/** The person's timesheets, for Change For's up-front sheet check. */
	timesheets?: readonly TimesheetSummary[] | null;
	projectWorkspaceName?: string | null;
	/** Opens the entry detail (TimeEntryDetailModal) at `ctx.zIndex`. */
	onOpenEntry?: (entry: TimeEntryView, ctx: OpenEntryContext) => void;
	/** "Add time" for a day (manual entry). */
	onAddTimeForDay?: (date: string) => void;
	/** "Start timer" (offered on today). */
	onStartTimer?: () => void;
	/** Replace the built-in Edit dialog. */
	onEditEntry?: (entry: TimeEntryView, ctx: MonthActionContext) => void;
	/** Replace the built-in Delete dialog. */
	onDeleteEntry?: (entry: TimeEntryView, ctx: MonthActionContext) => void;
	/** Replace the built-in Change For dialog. */
	onChangeFor?: (entry: TimeEntryView, ctx: MonthActionContext) => void;
	className?: string;
	/** "Now" for today and running totals (tests). */
	nowMs?: number;
}

const DAY_DIALOG_Z = 1200;
const ACTION_DIALOG_Z = DAY_DIALOG_Z + 10;

export function TimeMonthView({
	month,
	onMonthChange,
	timeZone,
	weekStart = 1,
	forRef = null,
	projectId = null,
	timesheets,
	projectWorkspaceName,
	onOpenEntry,
	onAddTimeForDay,
	onStartTimer,
	onEditEntry,
	onDeleteEntry,
	onChangeFor,
	className,
	nowMs,
}: TimeMonthViewProps) {
	const tz = safeTimezone(timeZone);
	const native = isNativeApp();
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const now = nowMs ?? Date.now();
	const today = todayIn(tz, new Date(now));

	const controlled = month !== undefined && onMonthChange !== undefined;
	const [innerMonth, setInnerMonth] = useState<string>(() =>
		month && isLocalDate(month) ? month : today,
	);
	useEffect(() => {
		if (!controlled && month && isLocalDate(month)) setInnerMonth(month);
	}, [controlled, month]);
	const anchor = controlled && month && isLocalDate(month) ? month : innerMonth;
	const setAnchor = (date: string) => {
		if (!controlled) setInnerMonth(date);
		onMonthChange?.(date);
	};

	const grid = useMemo(() => monthGrid(anchor, weekStart), [anchor, weekStart]);
	const range = {
		from: grid.start,
		to: grid.end,
		project_id: projectId ?? undefined,
		for: forRef,
	};
	const entriesQuery = useQuery({
		queryKey: [...timeKeys.myEntries(userId, range), "month"] as const,
		queryFn: () =>
			listAllMyEntries(range, { maxItems: MONTH_MAX_ENTRIES, limit: 200 }),
		enabled: Boolean(userId),
		refetchOnMount: true,
		retry: retryTimeQuery,
		placeholderData: keepPreviousData,
	});
	const entries = entriesQuery.data ?? [];
	const capped = entries.length >= MONTH_MAX_ENTRIES;
	const byDay = useMemo(() => entriesByDay(entries, tz), [entries, tz]);

	const [pickerOpen, setPickerOpen] = useState(false);
	const [dayModal, setDayModal] = useState<{
		date: string;
		highlight: string | null;
	} | null>(null);
	const [editing, setEditing] = useState<TimeEntryView | null>(null);
	const [deleting, setDeleting] = useState<TimeEntryView | null>(null);
	const [changingFor, setChangingFor] = useState<TimeEntryView | null>(null);

	const openDay = (date: string, highlight: string | null = null) =>
		setDayModal({ date, highlight });

	const error = entriesQuery.isError
		? timeErrorCopy(entriesQuery.error, { native, operation: "read" }).message
		: null;

	return (
		<div
			className={cn(
				"rounded-2xl border border-border bg-card shadow-sm",
				className,
			)}
		>
			<div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
				<div className="inline-flex items-center gap-0.5">
					<button
						type="button"
						onClick={() => setAnchor(shiftMonth(anchor, -1))}
						className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
						aria-label={MONTH_VIEW_COPY.previous}
					>
						<ChevronLeft className="h-4 w-4" aria-hidden="true" />
					</button>
					<button
						type="button"
						onClick={() => setAnchor(today)}
						className="rounded-md px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
					>
						{MONTH_VIEW_COPY.thisMonth}
					</button>
					<button
						type="button"
						onClick={() => setAnchor(shiftMonth(anchor, 1))}
						className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
						aria-label={MONTH_VIEW_COPY.next}
					>
						<ChevronRight className="h-4 w-4" aria-hidden="true" />
					</button>
				</div>
				<div className="relative">
					<button
						type="button"
						onClick={() => setPickerOpen((open) => !open)}
						className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-foreground hover:bg-muted"
						aria-expanded={pickerOpen}
						aria-haspopup="dialog"
						title={MONTH_VIEW_COPY.jump}
					>
						<CalendarDays
							className="h-4 w-4 text-muted-foreground"
							aria-hidden="true"
						/>
						<span data-testid="month-title">
							{monthTitle(grid.month.start)}
						</span>
						<ChevronDown
							className="h-3.5 w-3.5 text-muted-foreground"
							aria-hidden="true"
						/>
					</button>
					{pickerOpen ? (
						<MonthYearPicker
							anchor={grid.month.start}
							today={today}
							onPick={(date) => {
								setAnchor(date);
								setPickerOpen(false);
							}}
							onClose={() => setPickerOpen(false)}
						/>
					) : null}
				</div>
				{entriesQuery.isFetching ? (
					<Loader2
						className="h-3.5 w-3.5 animate-spin text-muted-foreground"
						aria-hidden="true"
					/>
				) : null}
			</div>

			{capped ? (
				<p className="px-4 pt-2 text-[11px] text-muted-foreground">
					{MONTH_VIEW_COPY.capped(MONTH_MAX_ENTRIES)}
				</p>
			) : null}
			{error ? (
				<div className="px-4 pt-3">
					<TimeReasonCard
						variant="inline"
						tone="danger"
						role="alert"
						title={error}
						action={
							<button
								type="button"
								onClick={() => void entriesQuery.refetch()}
								className="rounded-lg border border-input px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
							>
								{MONTH_VIEW_COPY.tryAgain}
							</button>
						}
					/>
				</div>
			) : null}

			<div className="grid grid-cols-7 border-b border-border">
				{grid.weekdays.map((day) => (
					<div
						key={day}
						className="px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
					>
						{weekdayShort(day)}
					</div>
				))}
			</div>
			<div className="grid grid-cols-7" data-testid="month-grid">
				{grid.days.map((date) => (
					<DayCell
						key={date}
						date={date}
						entries={byDay.get(date) ?? []}
						inMonth={date >= grid.month.start && date <= grid.month.end}
						isToday={date === today}
						native={native}
						nowMs={now}
						onOpenDay={openDay}
					/>
				))}
			</div>

			<DayEntriesModal
				open={dayModal !== null}
				date={dayModal?.date ?? null}
				entries={dayModal ? (byDay.get(dayModal.date) ?? []) : []}
				timeZone={tz}
				highlightEntryId={dayModal?.highlight}
				onClose={() => setDayModal(null)}
				onOpenEntry={onOpenEntry}
				onEditEntry={(entry) =>
					onEditEntry
						? onEditEntry(entry, { zIndex: ACTION_DIALOG_Z })
						: setEditing(entry)
				}
				onDeleteEntry={(entry) =>
					onDeleteEntry
						? onDeleteEntry(entry, { zIndex: ACTION_DIALOG_Z })
						: setDeleting(entry)
				}
				onChangeFor={(entry) =>
					onChangeFor
						? onChangeFor(entry, { zIndex: ACTION_DIALOG_Z })
						: setChangingFor(entry)
				}
				onAddTime={onAddTimeForDay}
				onStartTimer={onStartTimer}
				zIndex={DAY_DIALOG_Z}
				nowMs={nowMs}
			/>

			{onEditEntry ? null : (
				<EditEntryModal
					open={editing !== null}
					entry={editing}
					timeZone={tz}
					onClose={() => setEditing(null)}
					onChangeFor={(entry) => {
						setEditing(null);
						setChangingFor(entry);
					}}
					zIndex={ACTION_DIALOG_Z}
				/>
			)}
			{onDeleteEntry ? null : (
				<DeleteEntryModal
					open={deleting !== null}
					entry={deleting}
					timeZone={tz}
					onClose={() => setDeleting(null)}
					zIndex={ACTION_DIALOG_Z}
				/>
			)}
			{onChangeFor ? null : (
				<ChangeForDialog
					open={changingFor !== null}
					entries={changingFor ? [changingFor] : []}
					timesheets={timesheets}
					timeZone={tz}
					projectWorkspaceName={projectWorkspaceName}
					onClose={() => setChangingFor(null)}
					zIndex={ACTION_DIALOG_Z}
				/>
			)}
		</div>
	);
}

function DayCell({
	date,
	entries,
	inMonth,
	isToday,
	native,
	nowMs,
	onOpenDay,
}: {
	date: string;
	entries: TimeEntryView[];
	inMonth: boolean;
	isToday: boolean;
	native: boolean;
	nowMs: number;
	onOpenDay: (date: string, highlight?: string | null) => void;
}) {
	const total = entries.reduce(
		(sum, entry) => sum + entryWorkSeconds(entry, nowMs),
		0,
	);
	const longDay = total > DAY_WARNING_SECONDS;
	const dayNumber = Number(date.slice(8, 10));
	// The button's name carries everything the cell shows (its header is
	// hidden from assistive tech so it isn't read twice).
	const label = [
		formatLocalDay(date, { weekday: true }),
		entryCountText(entries.length),
		entries.length ? formatDurationText(total) : null,
		longDay ? DAY_ENTRIES_COPY.longDay : null,
	]
		.filter(Boolean)
		.join(", ");

	return (
		// The day is a real button stretched over the cell, and the entry chips
		// are its siblings above it: no button inside a button (assistive tech
		// can't reach the children of role="button"), and the whole cell still
		// opens the day.
		<div
			data-date={date}
			className={cn(
				"relative min-h-16 border-b border-r border-border p-1 sm:min-h-24 sm:p-1.5",
				inMonth ? "bg-card" : "bg-muted/40",
			)}
		>
			<button
				type="button"
				aria-label={label}
				data-day-button=""
				onClick={() => onOpenDay(date)}
				className="absolute inset-0 h-full w-full cursor-pointer transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
			/>
			<div
				aria-hidden="true"
				className="pointer-events-none relative mb-1 flex items-center justify-between gap-1"
			>
				<span
					className={cn(
						"flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
						isToday
							? "bg-primary font-semibold text-primary-foreground"
							: inMonth
								? "text-foreground"
								: "text-muted-foreground",
					)}
				>
					{dayNumber}
				</span>
				{entries.length > 0 ? (
					<span
						className={cn(
							"inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums",
							longDay ? "text-warning-foreground" : "text-muted-foreground",
						)}
						data-testid="day-total"
					>
						{formatClock(total, "0:00")}
						{longDay ? (
							<AlertTriangle
								className="h-3 w-3"
								aria-label={DAY_ENTRIES_COPY.longDay}
							/>
						) : null}
					</span>
				) : null}
			</div>
			{entries.length > 0 ? (
				<span
					className="pointer-events-none relative mx-auto block h-1.5 w-1.5 rounded-full bg-primary sm:hidden"
					aria-hidden="true"
				/>
			) : null}
			<div className="pointer-events-none relative hidden space-y-0.5 sm:block">
				{entries.slice(0, MAX_CHIPS).map((entry) => (
					<EntryChip
						key={entry.id}
						entry={entry}
						native={native}
						onSelect={() => onOpenDay(date, entry.id)}
					/>
				))}
				{entries.length > MAX_CHIPS ? (
					<div className="px-1.5 text-[10px] font-medium text-muted-foreground">
						{MONTH_VIEW_COPY.more(entries.length - MAX_CHIPS)}
					</div>
				) : null}
			</div>
		</div>
	);
}

function EntryChip({
	entry,
	native,
	onSelect,
}: {
	entry: TimeEntryView;
	native: boolean;
	onSelect: () => void;
}) {
	const tone = entryTone(entry);
	const label = nativeSafe(entryWorkLabel(entry), { native });
	const preset = entry.work_item !== "task" && !entry.task;
	return (
		<button
			type="button"
			onClick={(event) => {
				event.stopPropagation();
				onSelect();
			}}
			title={label}
			data-tone={tone}
			className={cn(
				"pointer-events-auto flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium hover:brightness-95",
				TONE_CLASS[tone],
			)}
		>
			{preset ? <span aria-hidden="true">◦</span> : null}
			<span className="truncate">{label}</span>
		</button>
	);
}

/**
 * Jump to any month: the year steps with arrows, the months are a 3 × 4
 * grid, and a pick anchors the view on that month's 1st.
 */
function MonthYearPicker({
	anchor,
	today,
	onPick,
	onClose,
}: {
	anchor: string;
	today: string;
	onPick: (date: string) => void;
	onClose: () => void;
}) {
	const selYear = Number(anchor.slice(0, 4));
	const selMonth = Number(anchor.slice(5, 7));
	const nowYear = Number(today.slice(0, 4));
	const nowMonth = Number(today.slice(5, 7));
	const [year, setYear] = useState(selYear);
	// Escape closes the picker, like every other popover on the page.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onClose]);
	return (
		<>
			<button
				type="button"
				aria-label={MONTH_VIEW_COPY.closePicker}
				onClick={onClose}
				className="fixed inset-0 z-40 cursor-default"
			/>
			<div
				role="dialog"
				aria-label={MONTH_VIEW_COPY.jump}
				className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-xl"
			>
				<div className="mb-1.5 flex items-center justify-between">
					<button
						type="button"
						onClick={() => setYear((y) => y - 1)}
						className="rounded p-1 text-muted-foreground hover:bg-muted"
						aria-label={MONTH_VIEW_COPY.previousYear}
					>
						<ChevronLeft className="h-4 w-4" aria-hidden="true" />
					</button>
					<span className="text-sm font-semibold tabular-nums text-foreground">
						{year}
					</span>
					<button
						type="button"
						onClick={() => setYear((y) => y + 1)}
						className="rounded p-1 text-muted-foreground hover:bg-muted"
						aria-label={MONTH_VIEW_COPY.nextYear}
					>
						<ChevronRight className="h-4 w-4" aria-hidden="true" />
					</button>
				</div>
				<div className="grid grid-cols-3 gap-1">
					{MONTH_NAMES.map((name, index) => {
						const m = index + 1;
						const active = m === selMonth && year === selYear;
						const current = m === nowMonth && year === nowYear;
						return (
							<button
								key={name}
								type="button"
								aria-pressed={active}
								onClick={() =>
									onPick(`${year}-${String(m).padStart(2, "0")}-01`)
								}
								className={cn(
									"rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
									active
										? "bg-primary text-primary-foreground"
										: current
											? "text-primary ring-1 ring-inset ring-primary/40 hover:bg-primary/5"
											: "text-foreground hover:bg-muted",
								)}
							>
								{name.slice(0, 3)}
							</button>
						);
					})}
				</div>
			</div>
		</>
	);
}
