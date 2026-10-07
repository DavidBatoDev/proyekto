/**
 * A read-only Google Calendar event in the Day/Week time grid. Deliberately
 * quieter than a Proyekto meeting (outlined, not filled) so the user can tell
 * "my meetings" from "the rest of my calendar" at a glance. Clicking opens the
 * details dialog; there is nothing to edit here.
 */
import { format } from "date-fns";
import type { GoogleCalendarEvent } from "@/services/meetings.service";
import type { LayoutBox } from "./overlap/layout";

interface GoogleEventBlockProps {
	event: GoogleCalendarEvent;
	box: LayoutBox;
	onClick?: (event: GoogleCalendarEvent) => void;
}

export function GoogleEventBlock({
	event,
	box,
	onClick,
}: GoogleEventBlockProps) {
	return (
		<button
			type="button"
			onClick={() => onClick?.(event)}
			title={`${event.title} (Google Calendar)`}
			style={{
				top: `${box.topPct}%`,
				height: `max(1.1rem, ${box.heightPct}%)`,
				left: `calc(${box.leftPct}% + 1px)`,
				width: `calc(${box.widthPct}% - 2px)`,
			}}
			className={`absolute z-[5] flex flex-col overflow-hidden rounded-md border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-left text-gray-700 shadow-sm transition-colors hover:bg-gray-100 ${
				event.free ? "border-dashed opacity-80" : ""
			}`}
		>
			<span className="truncate text-[11px] font-semibold leading-tight">
				{event.title}
			</span>
			<span className="truncate text-[10px] leading-tight text-gray-500">
				{format(new Date(event.start), "p")}
			</span>
		</button>
	);
}

/** A compact one-line pill for month cells and the all-day strip. */
export function GoogleEventChip({
	event,
	onClick,
}: {
	event: GoogleCalendarEvent;
	onClick?: (event: GoogleCalendarEvent) => void;
}) {
	return (
		<button
			type="button"
			title={`${event.title} (Google Calendar)`}
			onClick={(e) => {
				e.stopPropagation();
				onClick?.(event);
			}}
			className={`flex w-full items-center gap-1 truncate rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-left text-[10px] text-gray-600 hover:bg-gray-100 ${
				event.free ? "border-dashed" : ""
			}`}
		>
			<span className="h-1.5 w-1.5 shrink-0 rounded-full border border-gray-400" />
			{!event.allDay && (
				<span className="truncate font-medium">
					{format(new Date(event.start), "p")}
				</span>
			)}
			<span className="truncate">{event.title}</span>
		</button>
	);
}
