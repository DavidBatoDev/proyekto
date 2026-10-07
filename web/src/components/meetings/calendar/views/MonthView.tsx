/**
 * Month grid, Google Calendar style: an evenly divided grid of day cells with
 * the date centered at the top (today in a filled circle, "Oct 1" on the first
 * of a month), multi-day / all-day events as bars spanning the days they cover
 * within each week, timed events as "• 4pm Title" lines, and "N more" when a
 * day overflows. Clicking a cell's empty space creates a meeting that day;
 * clicking the date opens the day.
 */
import {
	eachDayOfInterval,
	endOfMonth,
	endOfWeek,
	format,
	startOfMonth,
	startOfWeek,
} from "date-fns";
import { useMemo } from "react";
import { BarItem, MonthLine, type OpenItem } from "../ItemViews";
import { barSegments, type CalendarItem, timedItemsStartingOn } from "../items";
import { dayKey, sameLocalDay } from "../model";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Event lines (bars + timed) shown per day before "N more".
const MAX_LINES = 4;

interface MonthViewProps {
	anchor: Date;
	items: CalendarItem[];
	now: Date;
	onOpenItem?: OpenItem;
	onOpenDay?: (day: Date) => void;
	onCreateAt?: (at: Date) => void;
	/** Unused here (no time gutter); accepted so all views share props. */
	timeZoneLabel?: string;
}

export function MonthView({
	anchor,
	items,
	now,
	onOpenItem,
	onOpenDay,
	onCreateAt,
}: MonthViewProps) {
	const weeks = useMemo(() => {
		const days = eachDayOfInterval({
			start: startOfWeek(startOfMonth(anchor)),
			end: endOfWeek(endOfMonth(anchor)),
		});
		const rows: Date[][] = [];
		for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
		return rows;
	}, [anchor]);
	const monthIdx = anchor.getMonth();

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="grid shrink-0 grid-cols-7 border-b border-border">
				{WEEKDAYS.map((d) => (
					<div
						key={d}
						className="py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
					>
						{d}
					</div>
				))}
			</div>
			<div
				className="grid min-h-[70vh] flex-1 lg:min-h-0"
				style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
			>
				{weeks.map((week) => (
					<WeekRow
						key={dayKey(week[0])}
						days={week}
						items={items}
						now={now}
						monthIdx={monthIdx}
						onOpenItem={onOpenItem}
						onOpenDay={onOpenDay}
						onCreateAt={onCreateAt}
					/>
				))}
			</div>
		</div>
	);
}

function WeekRow({
	days,
	items,
	now,
	monthIdx,
	onOpenItem,
	onOpenDay,
	onCreateAt,
}: {
	days: Date[];
	items: CalendarItem[];
	now: Date;
	monthIdx: number;
	onOpenItem?: OpenItem;
	onOpenDay?: (day: Date) => void;
	onCreateAt?: (at: Date) => void;
}) {
	const segments = barSegments(items, days);
	const laneCount = segments.reduce((n, s) => Math.max(n, s.lane + 1), 0);
	const visibleLanes = Math.min(laneCount, MAX_LINES);
	const timedSlots = Math.max(0, MAX_LINES - visibleLanes);

	return (
		<div className="relative min-h-0 overflow-hidden border-b border-border last:border-b-0">
			{/* Background cells: borders + click-to-create. */}
			<div className="absolute inset-0 grid grid-cols-7">
				{days.map((day, col) => (
					<button
						key={dayKey(day)}
						type="button"
						aria-label={`Create meeting on ${format(day, "MMMM d")}`}
						onClick={() =>
							onCreateAt?.(
								new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9),
							)
						}
						className={`h-full transition-colors hover:bg-muted/40 ${
							col === 0 ? "" : "border-l border-border"
						}`}
					/>
				))}
			</div>

			{/* Content: dates, bars, timed lines. */}
			<div className="pointer-events-none relative grid grid-cols-7 gap-y-px pb-1">
				{days.map((day, col) => {
					const isToday = sameLocalDay(day, now);
					const inMonth = day.getMonth() === monthIdx;
					const label =
						day.getDate() === 1 ? format(day, "MMM d") : String(day.getDate());
					return (
						<div
							key={dayKey(day)}
							className="flex justify-center pt-1.5 pb-0.5"
							style={{ gridColumn: col + 1, gridRow: 1 }}
						>
							<button
								type="button"
								onClick={() => onOpenDay?.(new Date(day))}
								className={`pointer-events-auto flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-medium transition-colors ${
									isToday
										? "bg-primary text-primary-foreground"
										: inMonth
											? "text-foreground hover:bg-muted"
											: "text-muted-foreground hover:bg-muted"
								}`}
							>
								{label}
							</button>
						</div>
					);
				})}

				{segments
					.filter((s) => s.lane < visibleLanes)
					.map((s) => (
						<div
							key={`${s.item.key}:${s.startCol}`}
							className="pointer-events-auto px-1"
							style={{
								gridColumn: `${s.startCol + 1} / span ${s.span}`,
								gridRow: s.lane + 2,
							}}
						>
							<BarItem
								item={s.item}
								onOpen={onOpenItem}
								clippedStart={s.clippedStart}
								clippedEnd={s.clippedEnd}
							/>
						</div>
					))}

				{days.map((day, col) => {
					const timed = timedItemsStartingOn(items, day);
					const hiddenBars = segments.filter(
						(s) =>
							s.lane >= visibleLanes &&
							col >= s.startCol &&
							col < s.startCol + s.span,
					).length;
					const shown = timed.slice(0, timedSlots);
					const hidden = hiddenBars + Math.max(0, timed.length - timedSlots);
					return (
						<div
							key={dayKey(day)}
							className="min-w-0 space-y-px px-1"
							style={{ gridColumn: col + 1, gridRow: visibleLanes + 2 }}
						>
							{shown.map((item) => (
								<div key={item.key} className="pointer-events-auto">
									<MonthLine item={item} onOpen={onOpenItem} />
								</div>
							))}
							{hidden > 0 && (
								<button
									type="button"
									onClick={() => onOpenDay?.(new Date(day))}
									className="pointer-events-auto w-full rounded-md px-1.5 py-0.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
								>
									{hidden} more
								</button>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
