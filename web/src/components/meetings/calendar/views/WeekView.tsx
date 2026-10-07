import { eachDayOfInterval, endOfWeek, startOfWeek } from "date-fns";
import { useMemo } from "react";
import type { OpenItem } from "../ItemViews";
import type { CalendarItem } from "../items";
import { TimeGrid } from "../TimeGrid";

interface WeekViewProps {
	anchor: Date;
	items: CalendarItem[];
	now: Date;
	timeZoneLabel?: string;
	onOpenItem?: OpenItem;
	onCreateAt?: (at: Date) => void;
	onOpenDay?: (day: Date) => void;
}

export function WeekView({ anchor, ...rest }: WeekViewProps) {
	const days = useMemo(
		() =>
			eachDayOfInterval({
				start: startOfWeek(anchor),
				end: endOfWeek(anchor),
			}),
		[anchor],
	);
	return <TimeGrid days={days} {...rest} />;
}
