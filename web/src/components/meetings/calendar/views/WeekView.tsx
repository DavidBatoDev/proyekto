import { eachDayOfInterval, endOfWeek, startOfWeek } from "date-fns";
import { useMemo } from "react";
import type { Meeting } from "@/services/meetings.service";
import { TimeGrid } from "../TimeGrid";

interface WeekViewProps {
	anchor: Date;
	meetings: Meeting[];
	now: Date;
	onSelectMeeting?: (meeting: Meeting) => void;
	onCreateAt?: (at: Date) => void;
}

export function WeekView({
	anchor,
	meetings,
	now,
	onSelectMeeting,
	onCreateAt,
}: WeekViewProps) {
	const days = useMemo(
		() =>
			eachDayOfInterval({
				start: startOfWeek(anchor),
				end: endOfWeek(anchor),
			}),
		[anchor],
	);
	return (
		<TimeGrid
			days={days}
			meetings={meetings}
			now={now}
			onSelectMeeting={onSelectMeeting}
			onCreateAt={onCreateAt}
		/>
	);
}
