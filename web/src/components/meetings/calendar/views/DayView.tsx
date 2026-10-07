import type { GoogleCalendarEvent, Meeting } from "@/services/meetings.service";
import { TimeGrid } from "../TimeGrid";

interface DayViewProps {
	anchor: Date;
	meetings: Meeting[];
	now: Date;
	onSelectMeeting?: (meeting: Meeting) => void;
	onCreateAt?: (at: Date) => void;
	/** Read-only events from the user's Google Calendar (overlay). */
	googleEvents?: GoogleCalendarEvent[];
	onSelectGoogleEvent?: (event: GoogleCalendarEvent) => void;
}

export function DayView({
	anchor,
	meetings,
	now,
	onSelectMeeting,
	onCreateAt,
	googleEvents,
	onSelectGoogleEvent,
}: DayViewProps) {
	return (
		<TimeGrid
			days={[anchor]}
			meetings={meetings}
			now={now}
			onSelectMeeting={onSelectMeeting}
			onCreateAt={onCreateAt}
			googleEvents={googleEvents}
			onSelectGoogleEvent={onSelectGoogleEvent}
		/>
	);
}
