/**
 * Month grid — a refactor of the original MeetingsCalendar's left column. Each
 * cell shows the day number (today highlighted) and up to two event chips with
 * a "+N more" overflow. Clicking a day selects it (drives the agenda panel);
 * clicking a chip opens that meeting.
 */
import {
	eachDayOfInterval,
	endOfMonth,
	endOfWeek,
	startOfMonth,
	startOfWeek,
} from "date-fns";
import { useMemo } from "react";
import type { Meeting } from "@/services/meetings.service";
import { EventChip } from "../EventChip";
import { dayKey, groupByDay, sameLocalDay } from "../model";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface MonthViewProps {
	anchor: Date;
	meetings: Meeting[];
	now: Date;
	selectedDay: Date;
	onSelectDay: (day: Date) => void;
	onSelectMeeting?: (meeting: Meeting) => void;
}

export function MonthView({
	anchor,
	meetings,
	now,
	selectedDay,
	onSelectDay,
	onSelectMeeting,
}: MonthViewProps) {
	const cells = useMemo(
		() =>
			eachDayOfInterval({
				start: startOfWeek(startOfMonth(anchor)),
				end: endOfWeek(endOfMonth(anchor)),
			}),
		[anchor],
	);
	const byDay = useMemo(() => groupByDay(meetings), [meetings]);
	const monthIdx = anchor.getMonth();

	return (
		<div className="flex h-full min-h-0 flex-col rounded-2xl border border-gray-200 bg-white p-4">
			<div className="mb-1 grid shrink-0 grid-cols-7 text-center text-xs font-medium text-gray-400">
				{WEEKDAYS.map((d) => (
					<div key={d} className="py-1">
						{d}
					</div>
				))}
			</div>
			<div className="thin-scrollbar grid min-h-0 flex-1 auto-rows-fr grid-cols-7 gap-1 overflow-y-auto">
				{cells.map((day) => {
					const inMonth = day.getMonth() === monthIdx;
					const isToday = sameLocalDay(day, now);
					const isSelected = sameLocalDay(day, selectedDay);
					const dayMeetings = byDay.get(dayKey(day)) ?? [];
					return (
						<button
							type="button"
							key={dayKey(day)}
							onClick={() => onSelectDay(new Date(day))}
							className={`flex min-h-[72px] flex-col overflow-hidden rounded-lg border p-1.5 text-left transition-colors ${
								isSelected
									? "border-primary bg-primary/5"
									: "border-gray-100 hover:bg-gray-50"
							} ${inMonth ? "" : "opacity-40"}`}
						>
							<span
								className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
									isToday
										? "bg-primary font-semibold text-white"
										: "text-gray-700"
								}`}
							>
								{day.getDate()}
							</span>
							<div className="mt-1 space-y-0.5">
								{dayMeetings.slice(0, 2).map((m) => (
									<EventChip key={m.id} meeting={m} onClick={onSelectMeeting} />
								))}
								{dayMeetings.length > 2 && (
									<div className="px-1 text-[10px] text-gray-400">
										+{dayMeetings.length - 2} more
									</div>
								)}
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}
