/**
 * The three ways an event is drawn, Google Calendar style:
 * - TimedBlock: a filled block in the Day/Week time grid ("Title / 3 – 4pm");
 * - BarItem: an all-day / multi-day bar (week all-day row, month view);
 * - MonthLine: a "• 4pm Title" line in a month cell.
 * Free (non-blocking) Google events are outlined instead of filled.
 */
import { Repeat, Video } from "lucide-react";
import type { MouseEvent } from "react";
import { CALENDAR_STYLES } from "./calendarStyles";
import { type CalendarItem, shortTime, timeRange } from "./items";
import type { LayoutBox } from "./overlap/layout";

export type OpenItem = (item: CalendarItem, anchor: DOMRect) => void;

function open(onOpen: OpenItem | undefined, item: CalendarItem) {
	return (e: MouseEvent<HTMLElement>) => {
		e.stopPropagation();
		onOpen?.(item, e.currentTarget.getBoundingClientRect());
	};
}

function hasVideo(item: CalendarItem): boolean {
	return Boolean(item.meeting?.meeting_url || item.googleEvent?.meetUrl);
}

export function TimedBlock({
	item,
	box,
	onOpen,
}: {
	item: CalendarItem;
	box: LayoutBox;
	onOpen?: OpenItem;
}) {
	const style = CALENDAR_STYLES[item.source];
	const minutes = (item.end.getTime() - item.start.getTime()) / 60_000;
	const compact = minutes < 45;
	return (
		<button
			type="button"
			onClick={open(onOpen, item)}
			title={`${item.title}, ${timeRange(item.start, item.end)}`}
			style={{
				top: `${box.topPct}%`,
				height: `max(1.25rem, ${box.heightPct}%)`,
				left: `calc(${box.leftPct}% + 1px)`,
				width: `calc(${box.widthPct}% - 3px)`,
			}}
			className={`absolute z-10 overflow-hidden rounded-md px-2 py-0.5 text-left text-xs leading-tight shadow-sm transition ${
				item.free ? style.outline : style.solid
			} ${compact ? "flex items-center gap-1" : "flex flex-col"}`}
		>
			<span className="flex min-w-0 items-center gap-1 font-semibold">
				{item.meeting?.series_id && <Repeat className="h-3 w-3 shrink-0" />}
				<span className="truncate">
					{item.title}
					{compact && `, ${shortTime(item.start)}`}
				</span>
			</span>
			{!compact && (
				<span className="flex items-center gap-1 truncate opacity-90">
					{timeRange(item.start, item.end)}
					{hasVideo(item) && <Video className="h-3 w-3 shrink-0" />}
				</span>
			)}
		</button>
	);
}

export function BarItem({
	item,
	onOpen,
	clippedStart = false,
	clippedEnd = false,
}: {
	item: CalendarItem;
	onOpen?: OpenItem;
	clippedStart?: boolean;
	clippedEnd?: boolean;
}) {
	const style = CALENDAR_STYLES[item.source];
	return (
		<button
			type="button"
			onClick={open(onOpen, item)}
			title={item.title}
			className={`flex h-[22px] w-full items-center truncate px-2 text-left text-xs font-medium transition ${
				item.free ? style.outline : style.solid
			} ${clippedStart ? "rounded-l-none" : "rounded-l-md"} ${
				clippedEnd ? "rounded-r-none" : "rounded-r-md"
			}`}
		>
			<span className="truncate">
				{!item.allDay && !clippedStart && (
					<span className="mr-1">{shortTime(item.start)}</span>
				)}
				{item.title}
			</span>
		</button>
	);
}

export function MonthLine({
	item,
	onOpen,
}: {
	item: CalendarItem;
	onOpen?: OpenItem;
}) {
	const style = CALENDAR_STYLES[item.source];
	return (
		<button
			type="button"
			onClick={open(onOpen, item)}
			title={`${item.title}, ${shortTime(item.start)}`}
			className="flex h-[22px] w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted"
		>
			<span
				className={`h-2 w-2 shrink-0 rounded-full ${
					item.free ? style.hollowDot : style.dot
				}`}
			/>
			<span className="shrink-0 text-muted-foreground">
				{shortTime(item.start)}
			</span>
			<span className="truncate font-medium">{item.title}</span>
		</button>
	);
}
