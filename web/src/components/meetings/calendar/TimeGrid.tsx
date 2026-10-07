/**
 * The hour-by-hour time grid shared by Day and Week views, laid out like Google
 * Calendar: weekday label over a large date number (today in a filled circle),
 * an all-day row whose bars span the days they cover (with the timezone in its
 * gutter), then the scrollable hours with full-width hour lines, filled event
 * blocks packed side by side by the overlap layout, click-to-create hour slots,
 * and the red current-time line on today's column.
 */
import { format } from "date-fns";
import { useEffect, useRef } from "react";
import { CurrentTimeLine } from "./CurrentTimeLine";
import { BarItem, type OpenItem, TimedBlock } from "./ItemViews";
import {
	barSegments,
	type CalendarItem,
	timedItemsOnDay,
	toLayout,
} from "./items";
import { dayKey, sameLocalDay } from "./model";
import { layoutDay } from "./overlap/layout";

const HOUR_HEIGHT = 48; // px per hour
const DAY_HEIGHT = HOUR_HEIGHT * 24;
const GUTTER = "w-16";
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MAX_BAR_LANES = 3;
// Header rows reserve the same scrollbar space as the scrolling body so the
// day columns line up exactly.
const ALIGN = "overflow-y-hidden [scrollbar-gutter:stable]";

function hourLabel(h: number): string {
	const period = h < 12 ? "AM" : "PM";
	const h12 = h % 12 === 0 ? 12 : h % 12;
	return `${h12} ${period}`;
}

interface TimeGridProps {
	days: Date[];
	items: CalendarItem[];
	now: Date;
	/** Short timezone label for the all-day gutter, e.g. "GMT+08". */
	timeZoneLabel?: string;
	onOpenItem?: OpenItem;
	onCreateAt?: (at: Date) => void;
	/** Clicking a date number opens that day. */
	onOpenDay?: (day: Date) => void;
}

export function TimeGrid({
	days,
	items,
	now,
	timeZoneLabel,
	onOpenItem,
	onCreateAt,
	onOpenDay,
}: TimeGridProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const segments = barSegments(items, days);
	const laneCount = segments.reduce((n, s) => Math.max(n, s.lane + 1), 0);
	const visibleLanes = Math.min(laneCount, MAX_BAR_LANES);
	const hiddenByDay = days.map(
		(_, col) =>
			segments.filter(
				(s) =>
					s.lane >= MAX_BAR_LANES &&
					col >= s.startCol &&
					col < s.startCol + s.span,
			).length,
	);

	// Open scrolled near the working day rather than midnight.
	useEffect(() => {
		const showsToday = days.some((d) => sameLocalDay(d, now));
		const hour = showsToday ? Math.max(0, now.getHours() - 1) : 7;
		if (scrollRef.current) scrollRef.current.scrollTop = hour * HOUR_HEIGHT;
	}, [days, now]);

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden">
			{/* Day headers */}
			<div className={`flex shrink-0 ${ALIGN}`}>
				<div className={`${GUTTER} shrink-0`} />
				{days.map((day) => {
					const isToday = sameLocalDay(day, now);
					return (
						<div
							key={dayKey(day)}
							className="flex min-w-0 flex-1 flex-col items-center pb-2 pt-1"
						>
							<span
								className={`text-[11px] font-medium uppercase tracking-wide ${
									isToday ? "text-primary" : "text-muted-foreground"
								}`}
							>
								{format(day, "EEE")}
							</span>
							<button
								type="button"
								onClick={() => onOpenDay?.(new Date(day))}
								className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-base transition-colors sm:h-11 sm:w-11 sm:text-2xl ${
									isToday
										? "bg-primary text-primary-foreground"
										: "text-foreground hover:bg-muted"
								}`}
							>
								{day.getDate()}
							</button>
						</div>
					);
				})}
			</div>

			{/* All-day row: bars span the days they cover. */}
			<div className={`flex shrink-0 border-b border-border ${ALIGN}`}>
				<div
					className={`${GUTTER} shrink-0 self-end pb-1 pr-2 text-right text-[10px] text-muted-foreground`}
				>
					{timeZoneLabel}
				</div>
				<div className="relative min-h-[14px] flex-1 border-l border-border pb-1">
					<div
						className="grid gap-y-0.5"
						style={{
							gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
						}}
					>
						{segments
							.filter((s) => s.lane < MAX_BAR_LANES)
							.map((s) => (
								<div
									key={`${s.item.key}:${s.startCol}`}
									className="px-0.5"
									style={{
										gridColumn: `${s.startCol + 1} / span ${s.span}`,
										gridRow: s.lane + 1,
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
						{hiddenByDay.map((hidden, col) =>
							hidden > 0 ? (
								<button
									key={dayKey(days[col])}
									type="button"
									onClick={() => onOpenDay?.(new Date(days[col]))}
									className="px-2 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
									style={{ gridColumn: col + 1, gridRow: visibleLanes + 1 }}
								>
									{hidden} more
								</button>
							) : null,
						)}
					</div>
				</div>
			</div>

			{/* Scrollable hours — fills the available height on desktop; capped on
			    small screens (where the page flows) so it still scrolls inside
			    itself and opens near the current time. */}
			<div
				ref={scrollRef}
				className="thin-scrollbar flex max-h-[65vh] min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] lg:max-h-none"
			>
				<div
					className={`${GUTTER} relative shrink-0`}
					style={{ height: DAY_HEIGHT }}
				>
					{HOURS.slice(1).map((h) => (
						<span
							key={h}
							className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground"
							style={{ top: h * HOUR_HEIGHT }}
						>
							{hourLabel(h)}
						</span>
					))}
				</div>

				<div className="flex flex-1">
					{days.map((day) => {
						const placements = timedItemsOnDay(items, day);
						const boxes = layoutDay(toLayout(placements));
						const boxById = new Map(boxes.map((b) => [b.id, b]));
						const isToday = sameLocalDay(day, now);
						return (
							<div
								key={dayKey(day)}
								className="relative flex-1 border-l border-border"
								style={{ height: DAY_HEIGHT }}
							>
								{HOURS.map((h) => (
									<button
										key={h}
										type="button"
										aria-label={`Create meeting at ${hourLabel(h)}`}
										onClick={() =>
											onCreateAt?.(
												new Date(
													day.getFullYear(),
													day.getMonth(),
													day.getDate(),
													h,
												),
											)
										}
										className={`block w-full transition-colors hover:bg-muted/60 ${
											h === 0 ? "" : "border-t border-border"
										}`}
										style={{ height: HOUR_HEIGHT }}
									/>
								))}
								{placements.map((p) => {
									const box = boxById.get(p.item.key);
									return box ? (
										<TimedBlock
											key={p.item.key}
											item={p.item}
											box={box}
											onOpen={onOpenItem}
										/>
									) : null;
								})}
								{isToday && <CurrentTimeLine now={now} />}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
