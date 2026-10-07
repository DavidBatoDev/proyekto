/**
 * A small month grid for the Year view: day numbers with a dot on days that
 * have meetings; clicking a day opens it in the Day view.
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
import type { Meeting } from "@/services/meetings.service";
import { dayKey, groupByDay, sameLocalDay } from "./model";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface MiniMonthProps {
	month: Date;
	meetings: Meeting[];
	now: Date;
	onOpenDay: (day: Date) => void;
}

export function MiniMonth({ month, meetings, now, onOpenDay }: MiniMonthProps) {
	const cells = useMemo(
		() =>
			eachDayOfInterval({
				start: startOfWeek(startOfMonth(month)),
				end: endOfWeek(endOfMonth(month)),
			}),
		[month],
	);
	const byDay = useMemo(() => groupByDay(meetings), [meetings]);
	const monthIdx = month.getMonth();

	return (
		<div className="rounded-xl border border-border bg-card p-3">
			<p className="mb-2 text-sm font-semibold text-foreground">
				{format(month, "MMMM")}
			</p>
			<div className="grid grid-cols-7 text-center text-[9px] font-medium text-muted-foreground">
				{DOW.map((d) => (
					<div key={d}>{d[0]}</div>
				))}
			</div>
			<div className="mt-1 grid grid-cols-7 gap-y-0.5">
				{cells.map((day) => {
					const inMonth = day.getMonth() === monthIdx;
					const isToday = sameLocalDay(day, now);
					const hasMeetings = (byDay.get(dayKey(day))?.length ?? 0) > 0;
					return (
						<button
							type="button"
							key={dayKey(day)}
							onClick={() => onOpenDay(new Date(day))}
							className="flex flex-col items-center py-0.5"
						>
							<span
								className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
									isToday
										? "bg-primary font-semibold text-primary-foreground"
										: inMonth
											? "text-foreground hover:bg-muted"
											: "text-muted-foreground/50"
								}`}
							>
								{day.getDate()}
							</span>
							<span
								className={`mt-0.5 h-1 w-1 rounded-full ${
									hasMeetings && inMonth ? "bg-primary" : "bg-transparent"
								}`}
							/>
						</button>
					);
				})}
			</div>
		</div>
	);
}
