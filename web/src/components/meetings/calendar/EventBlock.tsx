/**
 * A positioned event block for the Day/Week time grid. Geometry (top/height/
 * left/width) comes from the overlap layout as percentages of its day column.
 */
import { format } from "date-fns";
import { Video } from "lucide-react";
import type { Meeting } from "@/services/meetings.service";
import type { LayoutBox } from "./overlap/layout";

interface EventBlockProps {
	meeting: Meeting;
	box: LayoutBox;
	onClick?: (meeting: Meeting) => void;
}

export function EventBlock({ meeting, box, onClick }: EventBlockProps) {
	const start = new Date(meeting.scheduled_at);
	// A 1px inter-column gutter keeps side-by-side blocks visually distinct.
	return (
		<button
			type="button"
			onClick={() => onClick?.(meeting)}
			title={meeting.title}
			style={{
				top: `${box.topPct}%`,
				height: `max(1.1rem, ${box.heightPct}%)`,
				left: `calc(${box.leftPct}% + 1px)`,
				width: `calc(${box.widthPct}% - 2px)`,
			}}
			className="absolute z-10 flex flex-col overflow-hidden rounded-md bg-primary px-1.5 py-0.5 text-left text-white shadow-sm transition-colors hover:bg-primary-dark"
		>
			<span className="flex items-center gap-1 truncate text-[11px] font-semibold leading-tight">
				{meeting.meeting_url && <Video className="h-3 w-3 shrink-0" />}
				<span className="truncate">{meeting.title}</span>
			</span>
			<span className="truncate text-[10px] leading-tight opacity-90">
				{format(start, "p")}
			</span>
		</button>
	);
}
