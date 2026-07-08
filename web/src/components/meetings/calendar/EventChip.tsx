/**
 * A compact one-line event pill for the Month grid (and other dense contexts).
 */
import { format } from "date-fns";
import type { Meeting } from "@/services/meetings.service";

interface EventChipProps {
	meeting: Meeting;
	onClick?: (meeting: Meeting) => void;
}

export function EventChip({ meeting, onClick }: EventChipProps) {
	return (
		<button
			type="button"
			title={meeting.title}
			onClick={(e) => {
				e.stopPropagation();
				onClick?.(meeting);
			}}
			className="flex w-full items-center gap-1 truncate rounded bg-primary/10 px-1 py-0.5 text-left text-[10px] text-primary hover:bg-primary/20"
		>
			<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
			<span className="truncate font-medium">
				{format(new Date(meeting.scheduled_at), "p")}
			</span>
			<span className="truncate">{meeting.title}</span>
		</button>
	);
}
