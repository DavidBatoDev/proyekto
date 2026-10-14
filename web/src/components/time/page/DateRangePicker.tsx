// web/src/components/time/page/DateRangePicker.tsx
//
// The My time tab's date range picker (hand-rolled: no calendar library in
// package.json, and date math stays on `YYYY-MM-DD` strings via timePeriods):
//
//   ┌───────────────────────────────────────────────┬─────────────┐
//   │   Oct 6, 2026        →        Oct 19, 2026    │ Today       │
//   ├──────────────────────┬────────────────────────┤ Yesterday   │
//   │ ‹  [Oct ▾] [2026 ▾]  │  [Nov ▾] [2026 ▾]  ›   │ This week   │
//   │ Mo Tu We Th Fr Sa Su │ Mo Tu We Th Fr Sa Su   │ …           │
//   └───────────────────────────────────────────────┴─────────────┘
//                                            [Cancel] [Apply]
//
// - The trigger reads the range ("Oct 6 – 19, 2026"), or the preset with it
//   ("This week · Oct 19 – 25").
// - The first click sets the start, the second the end (an earlier end
//   swaps); while the end is open, hovering previews the range, and days more
//   than MAX_VIEW_RANGE_DAYS from the start are disabled. Apply writes the
//   draft; Cancel, Esc or a click outside drops it. A preset applies at once.
// - Weeks are Monday-first. Days are buttons in a grid (aria-label "Monday,
//   October 6, 2026", aria-selected on the cell); arrows move a day or a
//   week, PageUp/PageDown a month, Home/End the week's ends; Enter selects.
//   Tab stays inside the picker.
// - Below 640 px (`compact`) it is a bottom sheet with one month, the presets
//   as a chip row on top and Apply pinned at the bottom.

import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import { formatPeriodRange } from "@/lib/timeFormat";
import {
	addDays,
	daysBetween,
	isoDow,
	type LocalRange,
	MAX_VIEW_RANGE_DAYS,
	monthWindow,
	shiftMonth,
	weekWindow,
} from "@/lib/timePeriods";
import type { TimeRangePreset } from "@/lib/timeSearch";
import { cn } from "@/lib/utils";

/** The presets the picker lists, in order. */
export const PICKER_PRESETS = [
	"today",
	"yesterday",
	"this_week",
	"last_week",
	"this_month",
	"last_month",
	"last_30_days",
] as const satisfies readonly TimeRangePreset[];
export type PickerPreset = (typeof PICKER_PRESETS)[number];

export const DATE_PICKER_COPY = {
	trigger: "Choose dates",
	dialog: "Date range",
	presets: "Presets",
	preset: {
		today: "Today",
		yesterday: "Yesterday",
		this_week: "This week",
		last_week: "Last week",
		this_month: "This month",
		last_month: "Last month",
		last_30_days: "Last 30 days",
	} satisfies Record<PickerPreset, string>,
	start: "Start date",
	end: "End date",
	previousMonth: "Previous month",
	nextMonth: "Next month",
	month: "Month",
	year: "Year",
	cancel: "Cancel",
	apply: "Apply",
	cap: `Ranges can be up to ${MAX_VIEW_RANGE_DAYS} days.`,
} as const;

const MONTHS = [
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
];
const WEEKDAY_HEAD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const WEEKDAY_LONG = [
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"Sunday",
];

// ── Pure helpers (exported for tests) ───────────────────────────────────────

/** "Monday, October 6, 2026". */
export function dayAriaLabel(day: string): string {
	const [y, m, d] = day.split("-").map(Number);
	return `${WEEKDAY_LONG[isoDow(day) - 1]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "Oct 6, 2026". */
export function shortDay(day: string): string {
	const [y, m, d] = day.split("-").map(Number);
	return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`;
}

/** The weeks (Monday-first) that cover the month holding `monthStart`. */
export function monthWeeks(monthStart: string): string[][] {
	const month = monthWindow(monthStart);
	const first = weekWindow(month.start, 1).start;
	const last = weekWindow(month.end, 1).end;
	const weeks: string[][] = [];
	for (let day = first; day <= last; day = addDays(day, 7)) {
		weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
	}
	return weeks;
}

/** The ordered range two picks make (an earlier second pick swaps). */
export function orderedRange(a: string, b: string): LocalRange {
	return a <= b ? { start: a, end: b } : { start: b, end: a };
}

/** While the end is open: a day too far from the start for the cap. */
export function beyondCap(
	start: string,
	day: string,
	maxDays: number = MAX_VIEW_RANGE_DAYS,
): boolean {
	return Math.abs(daysBetween(start, day)) > maxDays - 1;
}

/** The trigger's text: "This week · Oct 19 – 25", else "Oct 6 – 19, 2026". */
export function rangeTriggerLabel(
	range: LocalRange,
	preset: TimeRangePreset | null,
	today: string,
): string {
	const named =
		preset && preset !== "custom"
			? DATE_PICKER_COPY.preset[preset as PickerPreset]
			: null;
	if (!named) {
		return formatPeriodRange(range.start, range.end, {
			spaced: true,
			year: "always",
		});
	}
	const short = formatPeriodRange(range.start, range.end, {
		spaced: true,
		now: new Date(`${today}T12:00:00Z`),
	});
	return `${named} · ${short}`;
}

/** The first of the month holding `day`. */
function monthOf(day: string): string {
	return `${day.slice(0, 7)}-01`;
}

// ── Component ───────────────────────────────────────────────────────────────

export interface DateRangePickerProps {
	range: LocalRange;
	/** The preset the range is (highlighted in the list and named on the trigger). */
	preset: TimeRangePreset | null;
	today: string;
	/** Apply: the picked range. */
	onApply: (range: LocalRange) => void;
	/** A preset clicked in the list. */
	onPreset: (preset: PickerPreset) => void;
	/** Below 640 px: a bottom sheet with one month. */
	compact?: boolean;
}

export function DateRangePicker({
	range,
	preset,
	today,
	onApply,
	onPreset,
	compact = false,
}: DateRangePickerProps) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const label = rangeTriggerLabel(range, preset, today);
	const close = useCallback(() => {
		setOpen(false);
		requestAnimationFrame(() => triggerRef.current?.focus());
	}, []);
	const panel = open ? (
		<RangePanel
			range={range}
			preset={preset}
			today={today}
			compact={compact}
			onCancel={close}
			onApply={(next) => {
				onApply(next);
				close();
			}}
			onPreset={(next) => {
				onPreset(next);
				close();
			}}
		/>
	) : null;
	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-label={`${DATE_PICKER_COPY.trigger}: ${label}`}
				onClick={() => setOpen((value) => !value)}
				className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-sm font-semibold tabular-nums text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 max-sm:h-10 max-sm:flex-1 max-sm:justify-center"
				data-testid="time-range-trigger"
			>
				<Calendar
					className="h-4 w-4 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				<span
					className="truncate"
					aria-live="polite"
					data-testid="time-range-label"
				>
					{label}
				</span>
			</button>
			{compact ? (
				open && typeof document !== "undefined" ? (
					createPortal(
						<div className="fixed inset-0 z-[1100] flex flex-col justify-end">
							<button
								type="button"
								aria-label={DATE_PICKER_COPY.cancel}
								tabIndex={-1}
								className="absolute inset-0 bg-foreground/40"
								onClick={close}
							/>
							<div className="relative max-h-[90vh] overflow-y-auto rounded-t-2xl border border-border bg-popover text-popover-foreground shadow-lg">
								{panel}
							</div>
						</div>,
						document.body,
					)
				) : null
			) : (
				<AnchoredPopover
					anchorRef={triggerRef}
					open={open}
					onClose={close}
					width={720}
					maxHeight={560}
					align="left"
					ariaLabel={DATE_PICKER_COPY.dialog}
					className="overflow-auto rounded-xl border border-border bg-popover shadow-lg"
				>
					{panel}
				</AnchoredPopover>
			)}
		</>
	);
}

function RangePanel({
	range,
	preset,
	today,
	compact,
	onCancel,
	onApply,
	onPreset,
}: {
	range: LocalRange;
	preset: TimeRangePreset | null;
	today: string;
	compact: boolean;
	onCancel: () => void;
	onApply: (range: LocalRange) => void;
	onPreset: (preset: PickerPreset) => void;
}) {
	const id = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const [start, setStart] = useState<string | null>(range.start);
	const [end, setEnd] = useState<string | null>(range.end);
	const [hover, setHover] = useState<string | null>(null);
	const [view, setView] = useState(() => monthOf(range.start));
	const [focusDay, setFocusDay] = useState(range.start);
	const months = compact ? [view] : [view, shiftMonth(view, 1).start];
	const picking = Boolean(start && !end);

	// The band: the committed draft, or start → hovered day while picking.
	const band = useMemo<LocalRange | null>(() => {
		if (start && end) return orderedRange(start, end);
		if (start && hover && !beyondCap(start, hover))
			return orderedRange(start, hover);
		return start ? { start, end: start } : null;
	}, [start, end, hover]);

	const pick = (day: string) => {
		if (!start || end) {
			setStart(day);
			setEnd(null);
			setHover(null);
			return;
		}
		if (beyondCap(start, day)) return;
		const ordered = orderedRange(start, day);
		setStart(ordered.start);
		setEnd(ordered.end);
		setHover(null);
	};

	// Keep the focused day in view, and focus it after keyboard moves.
	const moveFocus = (day: string) => {
		setFocusDay(day);
		const first = months[0];
		const lastMonth = months[months.length - 1];
		if (day < first) setView(monthOf(day));
		else if (day > monthWindow(lastMonth).end)
			setView(shiftMonth(monthOf(day), -(months.length - 1)).start);
		requestAnimationFrame(() => {
			rootRef.current
				?.querySelector<HTMLButtonElement>(
					`[data-day="${day}"][data-in-month="true"]`,
				)
				?.focus();
		});
	};

	// Opening focuses the start day.
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			rootRef.current
				?.querySelector<HTMLButtonElement>(
					`[data-day="${range.start}"][data-in-month="true"]`,
				)
				?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, []);

	const onGridKey = (event: KeyboardEvent<HTMLButtonElement>, day: string) => {
		const step: Record<string, () => string> = {
			ArrowLeft: () => addDays(day, -1),
			ArrowRight: () => addDays(day, 1),
			ArrowUp: () => addDays(day, -7),
			ArrowDown: () => addDays(day, 7),
			PageUp: () => shiftDay(day, -1),
			PageDown: () => shiftDay(day, 1),
			Home: () => weekWindow(day, 1).start,
			End: () => weekWindow(day, 1).end,
		};
		const next = step[event.key];
		if (!next) return;
		event.preventDefault();
		moveFocus(next());
	};

	// Tab stays inside; Esc closes.
	const onRootKey = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			onCancel();
			return;
		}
		if (event.key !== "Tab" || !rootRef.current) return;
		const focusables = Array.from(
			rootRef.current.querySelectorAll<HTMLElement>(
				"button:not([disabled]):not([tabindex='-1']), select:not([disabled])",
			),
		);
		if (focusables.length === 0) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};

	const years = useMemo(() => {
		const now = Number(today.slice(0, 4));
		const from = Math.min(now - 5, Number(view.slice(0, 4)));
		const to = Math.max(now + 1, Number(view.slice(0, 4)) + 1);
		return Array.from({ length: to - from + 1 }, (_, i) => from + i);
	}, [today, view]);

	const presetList = (
		<ul
			aria-label={DATE_PICKER_COPY.presets}
			className={cn(
				compact
					? "flex gap-2 overflow-x-auto px-3 pb-1 pt-3"
					: "flex w-36 shrink-0 flex-col gap-0.5 border-l border-border p-2",
			)}
			data-testid="date-picker-presets"
		>
			{PICKER_PRESETS.map((item) => {
				const active = preset === item;
				return (
					<li key={item} className="shrink-0">
						<button
							type="button"
							aria-pressed={active}
							onClick={() => onPreset(item)}
							className={cn(
								"text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
								compact
									? "whitespace-nowrap rounded-full border px-3 py-1.5"
									: "w-full rounded-lg px-2.5 py-1.5 text-left",
								active
									? "border-primary bg-primary/10 font-semibold text-primary"
									: "border-border text-foreground hover:bg-muted",
							)}
							data-testid={`date-preset-${item}`}
						>
							{DATE_PICKER_COPY.preset[item]}
						</button>
					</li>
				);
			})}
		</ul>
	);

	const header = (
		<div
			className="flex items-center justify-center gap-4 border-b border-border px-4 py-3 text-sm font-semibold tabular-nums"
			data-testid="date-picker-header"
			aria-live="polite"
		>
			<span className={start ? "text-foreground" : "text-muted-foreground"}>
				{start ? shortDay(start) : DATE_PICKER_COPY.start}
			</span>
			<span aria-hidden="true" className="text-muted-foreground">
				→
			</span>
			<span className={end ? "text-foreground" : "text-muted-foreground"}>
				{end ? shortDay(end) : DATE_PICKER_COPY.end}
			</span>
		</div>
	);

	const calendars = (
		<div
			className={cn("flex", compact ? "flex-col" : "divide-x divide-border")}
		>
			{months.map((month, index) => {
				const first = index === 0;
				const lastSide = index === months.length - 1;
				const setMonth = (target: string) =>
					setView(shiftMonth(target, -index).start);
				return (
					<div key={month} className="flex-1 p-3">
						<div className="mb-2 flex items-center gap-1.5">
							{first ? (
								<NavButton
									label={DATE_PICKER_COPY.previousMonth}
									onClick={() => setView(shiftMonth(view, -1).start)}
								>
									<ChevronLeft className="h-4 w-4" aria-hidden="true" />
								</NavButton>
							) : null}
							<div className="flex flex-1 items-center justify-center gap-1.5">
								<select
									aria-label={`${DATE_PICKER_COPY.month} ${index + 1}`}
									value={Number(month.slice(5, 7))}
									onChange={(event) =>
										setMonth(
											`${month.slice(0, 4)}-${String(event.currentTarget.value).padStart(2, "0")}-01`,
										)
									}
									className="h-8 rounded-lg border border-input bg-background px-1.5 text-sm font-semibold text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
									data-testid={`date-picker-month-${index}`}
								>
									{MONTHS.map((name, m) => (
										<option key={name} value={m + 1}>
											{name.slice(0, 3)}
										</option>
									))}
								</select>
								<select
									aria-label={`${DATE_PICKER_COPY.year} ${index + 1}`}
									value={Number(month.slice(0, 4))}
									onChange={(event) =>
										setMonth(
											`${event.currentTarget.value}-${month.slice(5, 7)}-01`,
										)
									}
									className="h-8 rounded-lg border border-input bg-background px-1.5 text-sm font-semibold tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
									data-testid={`date-picker-year-${index}`}
								>
									{years.map((year) => (
										<option key={year} value={year}>
											{year}
										</option>
									))}
								</select>
							</div>
							{lastSide ? (
								<NavButton
									label={DATE_PICKER_COPY.nextMonth}
									onClick={() => setView(shiftMonth(view, 1).start)}
								>
									<ChevronRight className="h-4 w-4" aria-hidden="true" />
								</NavButton>
							) : null}
						</div>
						<MonthGrid
							labelId={`${id}-m${index}`}
							month={month}
							today={today}
							band={band}
							start={start}
							end={end}
							picking={picking}
							focusDay={focusDay}
							onPick={pick}
							onHover={setHover}
							onKey={onGridKey}
							onFocusDay={setFocusDay}
						/>
					</div>
				);
			})}
		</div>
	);

	const footer = (
		<div
			className={cn(
				"flex items-center gap-2 border-t border-border px-3 py-2.5",
				compact && "sticky bottom-0 bg-popover",
			)}
		>
			<p
				className={cn(
					"min-w-0 flex-1 text-xs text-muted-foreground",
					!picking && "invisible",
				)}
				data-testid="date-picker-cap"
			>
				{DATE_PICKER_COPY.cap}
			</p>
			<button
				type="button"
				onClick={onCancel}
				className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 max-sm:h-10"
			>
				{DATE_PICKER_COPY.cancel}
			</button>
			<button
				type="button"
				disabled={!start}
				onClick={() => {
					if (start) onApply(orderedRange(start, end ?? start));
				}}
				className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50 max-sm:h-10 max-sm:flex-1 max-sm:justify-center"
			>
				{DATE_PICKER_COPY.apply}
			</button>
		</div>
	);

	return (
		<div
			ref={rootRef}
			role="dialog"
			aria-modal="true"
			aria-label={DATE_PICKER_COPY.dialog}
			onKeyDown={onRootKey}
			className="text-sm text-popover-foreground"
			data-testid="date-range-picker"
		>
			{compact ? (
				<>
					{presetList}
					{header}
					{calendars}
					{footer}
				</>
			) : (
				<div className="flex">
					<div className="min-w-0 flex-1">
						{header}
						{calendars}
					</div>
					{presetList}
				</div>
			)}
			{compact ? null : footer}
		</div>
	);
}

/** The same day of the month `n` months on, clamped to that month's end. */
function shiftDay(day: string, n: number): string {
	const target = shiftMonth(day, n);
	const wanted = `${target.start.slice(0, 8)}${day.slice(8, 10)}`;
	return wanted > target.end ? target.end : wanted;
}

function NavButton({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			onClick={onClick}
			className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
		>
			{children}
		</button>
	);
}

function MonthGrid({
	labelId,
	month,
	today,
	band,
	start,
	end,
	picking,
	focusDay,
	onPick,
	onHover,
	onKey,
	onFocusDay,
}: {
	labelId: string;
	month: string;
	today: string;
	band: LocalRange | null;
	start: string | null;
	end: string | null;
	picking: boolean;
	focusDay: string;
	onPick: (day: string) => void;
	onHover: (day: string | null) => void;
	onKey: (event: KeyboardEvent<HTMLButtonElement>, day: string) => void;
	onFocusDay: (day: string) => void;
}) {
	const weeks = monthWeeks(month);
	const prefix = month.slice(0, 7);
	const monthName = `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
	// The roving tab stop: the focused day when it is in this month, else the 1st.
	const tabDay = focusDay.startsWith(prefix) ? focusDay : month;
	return (
		<table
			role="grid"
			aria-labelledby={labelId}
			className="w-full border-collapse"
			onMouseLeave={() => onHover(null)}
		>
			<caption id={labelId} className="sr-only">
				{monthName}
			</caption>
			<thead>
				<tr>
					{WEEKDAY_HEAD.map((name) => (
						<th
							key={name}
							scope="col"
							className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
						>
							{name}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{weeks.map((week) => (
					<tr key={week[0]}>
						{week.map((day, col) => {
							const inMonth = day.startsWith(prefix);
							const inBand = Boolean(
								band && inMonth && day >= band.start && day <= band.end,
							);
							const isStart = inMonth && day === start;
							const isEnd = inMonth && day === end;
							const endpoint =
								isStart ||
								isEnd ||
								(inMonth &&
									band !== null &&
									(day === band.start || day === band.end));
							const selected = isStart || isEnd || inBand;
							const disabled =
								picking && start !== null && beyondCap(start, day);
							const bandStart = inBand && (day === band?.start || col === 0);
							const bandEnd = inBand && (day === band?.end || col === 6);
							return (
								<td
									key={day}
									role="gridcell"
									aria-selected={inMonth ? selected : undefined}
									className="p-0 py-0.5"
								>
									<div
										className={cn(
											"flex justify-center",
											inBand && "bg-primary/10",
											bandStart && "rounded-l-full",
											bandEnd && "rounded-r-full",
										)}
										data-band={inBand || undefined}
									>
										{inMonth ? (
											<button
												type="button"
												tabIndex={day === tabDay ? 0 : -1}
												aria-label={dayAriaLabel(day)}
												aria-current={day === today ? "date" : undefined}
												disabled={disabled}
												onClick={() => onPick(day)}
												onMouseEnter={() => onHover(day)}
												onFocus={() => onFocusDay(day)}
												onKeyDown={(event) => onKey(event, day)}
												className={cn(
													"inline-flex h-9 w-9 items-center justify-center rounded-full text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-30",
													!endpoint && "text-foreground hover:bg-muted",
													endpoint &&
														"bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
													day === today && !endpoint && "ring-1 ring-primary",
												)}
												data-day={day}
												data-in-month="true"
												data-endpoint={endpoint || undefined}
											>
												{Number(day.slice(8, 10))}
											</button>
										) : (
											// Days of the next or previous month: muted, not a target
											// (the neighbouring grid owns them).
											<span
												aria-hidden="true"
												className="inline-flex h-9 w-9 items-center justify-center text-sm tabular-nums text-muted-foreground/50"
											>
												{Number(day.slice(8, 10))}
											</span>
										)}
									</div>
								</td>
							);
						})}
					</tr>
				))}
			</tbody>
		</table>
	);
}
