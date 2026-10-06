// web/src/components/time/page/DayStrip.tsx
//
// The day strip (ux.md › Day strip and view week, L29):
//
//    Mon    Tue    Wed    Thu      Fri    Sat   Sun      Week
//    6:30   8:10   7:45   9:20 ⚠   3:00   –     –       34:45
//
// - Days are cut in the view zone (the context's, or the person's own).
// - A day over 8 h shows ⚠, the same rule as the live day total; a running
//   timer counts live (this component owns the 1 Hz tick, so the page around
//   it never re-renders every second).
// - Clicking a day filters the list to it; clicking it again shows the week.
// - Below 640 px the days are 7 horizontally scrolling chips, with the week
//   total and the timezone label underneath.
// - There is no hours-per-cell grid: entries are intervals.

import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";
import { useLiveNowMs } from "@/components/time/timer/liveDuration";
import {
	formatClock,
	formatDurationText,
	formatLocalDay,
	weekdayShort,
} from "@/lib/timeFormat";
import { isoDow, type LocalRange } from "@/lib/timePeriods";
import { cn } from "@/lib/utils";
import type { TimeEntryView } from "@/services/time.types";
import { dayTotals } from "./useTimePageData";
import { ZoneLabel } from "./WeekNavigator";

export const DAY_STRIP_COPY = {
	region: "Days in this week",
	week: "Week",
	noTime: "no time",
	over: "over 8 hours",
	today: "today",
	showingDay: "Showing this day only",
} as const;

export interface DayStripProps {
	entries: readonly TimeEntryView[];
	week: LocalRange;
	timeZone: string;
	today: string;
	selectedDay: string | null;
	onSelectDay: (day: string | null) => void;
	loading?: boolean;
	/** The zone label, repeated under the strip on phones. */
	zoneText?: string | null;
	/** Tests: a fixed clock instead of the live tick. */
	nowMs?: number;
	className?: string;
}

/** "Thu Oct 2, 9h 20m, over 8 hours, today". */
export function dayButtonLabel(day: {
	date: string;
	seconds: number;
	over: boolean;
	isToday: boolean;
}): string {
	return [
		formatLocalDay(day.date, { weekday: true }),
		day.seconds > 0 ? formatDurationText(day.seconds) : DAY_STRIP_COPY.noTime,
		day.over ? DAY_STRIP_COPY.over : null,
		day.isToday ? DAY_STRIP_COPY.today : null,
	]
		.filter(Boolean)
		.join(", ");
}

export function DayStrip({
	entries,
	week,
	timeZone,
	today,
	selectedDay,
	onSelectDay,
	loading = false,
	zoneText,
	nowMs: fixedNowMs,
	className,
}: DayStripProps) {
	const running = fixedNowMs === undefined && entries.some((e) => !e.ended_at);
	const liveNowMs = useLiveNowMs(running);
	const nowMs = fixedNowMs ?? liveNowMs;
	const { days, weekSeconds } = useMemo(
		() => dayTotals(entries, week, { timeZone, today, nowMs }),
		[entries, week, timeZone, today, nowMs],
	);

	return (
		<section
			aria-label={DAY_STRIP_COPY.region}
			aria-busy={loading || undefined}
			className={cn("space-y-2", className)}
			data-testid="day-strip"
		>
			<div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-8 sm:overflow-visible sm:px-0 sm:pb-0">
				{days.map((day) => {
					const selected = selectedDay === day.date;
					return (
						<button
							key={day.date}
							type="button"
							aria-pressed={selected}
							aria-label={dayButtonLabel(day)}
							onClick={() => onSelectDay(selected ? null : day.date)}
							data-date={day.date}
							className={cn(
								"flex min-w-[4.25rem] shrink-0 flex-col items-center gap-0.5 rounded-xl border px-2 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:min-w-0",
								selected
									? "border-primary bg-primary/10"
									: "border-border bg-card hover:bg-muted",
								day.isToday && !selected && "border-primary/40",
							)}
						>
							<span
								className={cn(
									"text-[11px] font-semibold uppercase tracking-wide",
									day.isToday ? "text-primary" : "text-muted-foreground",
								)}
							>
								{weekdayShort(isoDow(day.date))}
							</span>
							<span className="text-[11px] text-muted-foreground">
								{formatLocalDay(day.date)}
							</span>
							<span
								className={cn(
									"inline-flex items-center gap-1 text-sm font-semibold tabular-nums",
									day.over ? "text-warning-foreground" : "text-foreground",
									loading && "opacity-50",
								)}
								data-testid="day-total"
							>
								{formatClock(day.seconds > 0 ? day.seconds : null, "–")}
								{day.over ? (
									<AlertTriangle
										className="h-3.5 w-3.5 text-warning"
										aria-hidden="true"
									/>
								) : null}
							</span>
						</button>
					);
				})}
				<div
					className="hidden flex-col items-center justify-center gap-0.5 rounded-xl bg-muted/60 px-2 py-2 text-center sm:flex"
					data-testid="week-total"
				>
					<span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
						{DAY_STRIP_COPY.week}
					</span>
					<span className="text-sm font-bold tabular-nums text-foreground">
						{formatClock(weekSeconds, "0:00")}
					</span>
				</div>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:hidden">
				<span className="text-muted-foreground">
					{DAY_STRIP_COPY.week}{" "}
					<span className="font-semibold tabular-nums text-foreground">
						{formatClock(weekSeconds, "0:00")}
					</span>
				</span>
				{zoneText ? <ZoneLabel text={zoneText} /> : null}
			</div>
		</section>
	);
}
