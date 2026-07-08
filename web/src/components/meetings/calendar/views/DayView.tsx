import type { Meeting } from "@/services/meetings.service";
import { TimeGrid } from "../TimeGrid";

interface DayViewProps {
	anchor: Date;
	meetings: Meeting[];
	now: Date;
	onSelectMeeting?: (meeting: Meeting) => void;
	onCreateAt?: (at: Date) => void;
}

export function DayView({
	anchor,
	meetings,
	now,
	onSelectMeeting,
	onCreateAt,
}: DayViewProps) {
	return (
		<TimeGrid
			days={[anchor]}
			meetings={meetings}
			now={now}
			onSelectMeeting={onSelectMeeting}
			onCreateAt={onCreateAt}
		/>
	);
}
