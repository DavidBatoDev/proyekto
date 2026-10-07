/**
 * The hour-by-hour time grid shared by Day and Week views: a left time gutter,
 * a day-header row, and one relative column per day holding absolutely-
 * positioned event blocks (packed by the overlap layout), hour slots that
 * create a meeting on click, and a red current-time line on today's column.
 * The optional Google Calendar overlay shares the overlap layout with meetings
 * (so nothing is drawn on top of anything else) and adds an all-day strip.
 */
import { format } from "date-fns";
import { useEffect, useRef } from "react";
import type { GoogleCalendarEvent, Meeting } from "@/services/meetings.service";
import { CurrentTimeLine } from "./CurrentTimeLine";
import { EventBlock } from "./EventBlock";
import { GoogleEventBlock, GoogleEventChip } from "./GoogleEventBlock";
import {
	allDayGoogleEventsOnDay,
	googleLayoutId,
	googleToLayoutEvents,
	timedGoogleEventsOnDay,
} from "./googleEvents";
import {
	dayKey,
	sameLocalDay,
	timedMeetingsOnDay,
	toLayoutEvents,
} from "./model";
import { layoutDay } from "./overlap/layout";

const HOUR_HEIGHT = 48; // px per hour
const DAY_HEIGHT = HOUR_HEIGHT * 24;
const GUTTER = "w-16";
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function hourLabel(h: number): string {
	const period = h < 12 ? "AM" : "PM";
	const h12 = h % 12 === 0 ? 12 : h % 12;
	return `${h12} ${period}`;
}

const NO_GOOGLE_EVENTS: GoogleCalendarEvent[] = [];

interface TimeGridProps {
	days: Date[];
	meetings: Meeting[];
	now: Date;
	onSelectMeeting?: (meeting: Meeting) => void;
	onCreateAt?: (at: Date) => void;
	/** Read-only events from the user's Google Calendar (overlay). */
	googleEvents?: GoogleCalendarEvent[];
	onSelectGoogleEvent?: (event: GoogleCalendarEvent) => void;
}

export function TimeGrid({
	days,
	meetings,
	now,
	onSelectMeeting,
	onCreateAt,
	googleEvents = NO_GOOGLE_EVENTS,
	onSelectGoogleEvent,
}: TimeGridProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const allDayByDay = days.map((day) =>
		allDayGoogleEventsOnDay(googleEvents, day),
	);
	const hasAllDay = allDayByDay.some((list) => list.length > 0);

	// Open scrolled near the working day rather than midnight.
	useEffect(() => {
		const showsToday = days.some((d) => sameLocalDay(d, now));
		const hour = showsToday ? Math.max(0, now.getHours() - 1) : 7;
		if (scrollRef.current) scrollRef.current.scrollTop = hour * HOUR_HEIGHT;
	}, [days, now]);

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white">
			{/* Day headers */}
			<div className="flex shrink-0 border-b border-gray-100">
				<div className={`${GUTTER} shrink-0`} />
				{days.map((day) => {
					const isToday = sameLocalDay(day, now);
					return (
						<div
							key={dayKey(day)}
							className="flex flex-1 flex-col items-center gap-0.5 border-l border-gray-100 py-2"
						>
							<span className="text-[11px] font-medium uppercase text-gray-400">
								{format(day, "EEE")}
							</span>
							<span
								className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${
									isToday
										? "bg-primary font-semibold text-white"
										: "text-gray-800"
								}`}
							>
								{day.getDate()}
							</span>
						</div>
					);
				})}
			</div>

			{/* All-day Google events, one stack per day column. */}
			{hasAllDay && (
				<div className="flex shrink-0 border-b border-gray-100">
					<div
						className={`${GUTTER} shrink-0 py-1 pr-2 text-right text-[10px] text-gray-400`}
					>
						All day
					</div>
					{days.map((day, i) => (
						<div
							key={dayKey(day)}
							className="thin-scrollbar max-h-20 flex-1 space-y-0.5 overflow-y-auto border-l border-gray-100 p-1"
						>
							{allDayByDay[i].map((event) => (
								<GoogleEventChip
									key={event.id}
									event={event}
									onClick={onSelectGoogleEvent}
								/>
							))}
						</div>
					))}
				</div>
			)}

			{/* Scrollable grid body — fills the available height (desktop) with a
			    viewport-height floor so it stays usable when the page flows (mobile). */}
			<div
				ref={scrollRef}
				className="thin-scrollbar flex min-h-[60vh] flex-1 overflow-y-auto lg:min-h-0"
			>
				<div className={`${GUTTER} shrink-0`}>
					{HOURS.map((h) => (
						<div
							key={h}
							className="relative border-t border-transparent pr-2 text-right text-[10px] text-gray-400"
							style={{ height: HOUR_HEIGHT }}
						>
							<span className="absolute -top-1.5 right-2">
								{h === 0 ? "" : hourLabel(h)}
							</span>
						</div>
					))}
				</div>

				<div className="flex flex-1">
					{days.map((day) => {
						const timed = timedMeetingsOnDay(meetings, day);
						const timedGoogle = timedGoogleEventsOnDay(googleEvents, day);
						const boxes = layoutDay([
							...toLayoutEvents(timed),
							...googleToLayoutEvents(timedGoogle),
						]);
						const boxById = new Map(boxes.map((b) => [b.id, b]));
						const isToday = sameLocalDay(day, now);
						return (
							<div
								key={dayKey(day)}
								className="relative flex-1 border-l border-gray-100"
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
										className="block w-full border-t border-gray-100 transition-colors hover:bg-primary/5"
										style={{ height: HOUR_HEIGHT }}
									/>
								))}
								{timed.map((t) => {
									const box = boxById.get(t.meeting.id);
									return box ? (
										<EventBlock
											key={t.meeting.id}
											meeting={t.meeting}
											box={box}
											onClick={onSelectMeeting}
										/>
									) : null;
								})}
								{timedGoogle.map((t) => {
									const box = boxById.get(googleLayoutId(t.event));
									return box ? (
										<GoogleEventBlock
											key={googleLayoutId(t.event)}
											event={t.event}
											box={box}
											onClick={onSelectGoogleEvent}
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
